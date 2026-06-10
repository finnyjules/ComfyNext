import { VERTEX_SRC, FRAGMENT_SRC } from './shaders'
import { BLEND_MODE_INDEX } from '~~/shared/timeline/blendModes'
import type { DrawEntry } from '../compositor'

// Minimal WebGL2 executor for the timeline layer pass. One internal canvas,
// two ping-pong RGBA8 framebuffers, one program. render() leaves the result
// on the internal canvas; callers blit it wherever they need (2d drawImage —
// reading a WebGL canvas in the same task as the draw is spec-guaranteed).
//
// All textures are uploaded un-flipped and un-premultiplied; v_uv is y-down
// image space throughout, and the final present pass flips once. If goldens
// come out vertically mirrored, the bug is in exactly one place: PRESENT_FLIP.

const PRESENT_FLIP = true // flip Y once when drawing the final FBO to the canvas

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(sh)}`)
  }
  return sh
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`)
  }
  return prog
}

// Present pass: draw a texture to the default framebuffer (the canvas).
const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_flipY;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec2 uv = vec2(v_uv.x, mix(v_uv.y, 1.0 - v_uv.y, u_flipY));
  outColor = vec4(texture(u_tex, uv).rgb, 1.0);
}
`

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer }

export class GlRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private layerProg: WebGLProgram
  private presentProg: WebGLProgram
  private targets: [Target, Target]
  private srcTextures = new Map<string, { tex: WebGLTexture; version: number }>()
  private layerU!: { [k: string]: WebGLUniformLocation | null } & { u_base: WebGLUniformLocation | null; u_src: WebGLUniformLocation | null; u_canvas: WebGLUniformLocation | null; u_center: WebGLUniformLocation | null; u_size: WebGLUniformLocation | null; u_rotation: WebGLUniformLocation | null; u_alpha: WebGLUniformLocation | null; u_mode: WebGLUniformLocation | null }
  private presentU!: { [k: string]: WebGLUniformLocation | null } & { u_tex: WebGLUniformLocation | null; u_flipY: WebGLUniformLocation | null }
  private width = 0
  private height = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl

    // Fullscreen triangle.
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    this.layerProg = link(gl, VERTEX_SRC, FRAGMENT_SRC)
    this.presentProg = link(gl, VERTEX_SRC, PRESENT_FS)

    const cacheUniforms = (prog: WebGLProgram, names: string[]) =>
      Object.fromEntries(names.map(n => [n, gl.getUniformLocation(prog, n)])) as any
    this.layerU = cacheUniforms(this.layerProg, [
      'u_base', 'u_src', 'u_canvas', 'u_center', 'u_size', 'u_rotation', 'u_alpha', 'u_mode',
    ])
    this.presentU = cacheUniforms(this.presentProg, ['u_tex', 'u_flipY'])

    this.targets = [this.makeTarget(1, 1), this.makeTarget(1, 1)]
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex, fbo }
  }

  resize(w: number, h: number): void {
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.canvas.width = w
    this.canvas.height = h
    const gl = this.gl
    for (const t of this.targets) {
      gl.deleteTexture(t.tex)
      gl.deleteFramebuffer(t.fbo)
    }
    this.targets = [this.makeTarget(w, h), this.makeTarget(w, h)]
  }

  /** Upload or update the source texture for a draw key. Re-uploads only when
   *  `version` changes — static images pass a constant, animated sources pass
   *  the source frame index. LINEAR filtering (GPU analogue of PIL BILINEAR). */
  setSource(key: string, image: TexImageSource, version = 0): void {
    const gl = this.gl
    const existing = this.srcTextures.get(key)
    if (existing && existing.version === version) return
    const tex = existing?.tex ?? gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image)
    if (!existing) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    this.srcTextures.set(key, { tex, version })
  }

  /** Render the draw list over bg color; result lands on this.canvas. */
  render(entries: DrawEntry[], bg: [number, number, number], w: number, h: number): void {
    const gl = this.gl
    this.resize(w, h)
    gl.viewport(0, 0, w, h)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)

    // Seed ping with the background color.
    let read = 0
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[read]!.fbo)
    gl.clearColor(bg[0], bg[1], bg[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.layerProg)

    for (const e of entries) {
      const src = this.srcTextures.get(e.clipId)
      if (!src) continue
      const write = 1 - read
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[write]!.fbo)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.targets[read]!.tex)
      gl.uniform1i(this.layerU.u_base, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, src.tex)
      gl.uniform1i(this.layerU.u_src, 1)

      gl.uniform2f(this.layerU.u_canvas, w, h)
      gl.uniform2f(this.layerU.u_center, e.centerX, e.centerY)
      gl.uniform2f(this.layerU.u_size, e.widthPx, e.heightPx)
      gl.uniform1f(this.layerU.u_rotation, (e.rotationDeg * Math.PI) / 180)
      gl.uniform1f(this.layerU.u_alpha, e.alpha)
      gl.uniform1i(this.layerU.u_mode, BLEND_MODE_INDEX[e.blend])

      gl.drawArrays(gl.TRIANGLES, 0, 3)
      read = write
    }

    // Present to the internal canvas (default framebuffer).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.presentProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.targets[read]!.tex)
    gl.uniform1i(this.presentU.u_tex, 0)
    gl.uniform1f(this.presentU.u_flipY, PRESENT_FLIP ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  clearSources(): void {
    for (const entry of this.srcTextures.values()) this.gl.deleteTexture(entry.tex)
    this.srcTextures.clear()
  }

  dispose(): void {
    this.clearSources()
    const gl = this.gl
    for (const t of this.targets) {
      gl.deleteTexture(t.tex)
      gl.deleteFramebuffer(t.fbo)
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
