// Singleton WebGL2 renderer for ShaderEffect previews.
// One GL context app-wide (browsers cap ~8-16); callers drawImage() the returned canvas.

import { BLEND_LAYERS_GLSL } from '~/lib/studio/blend'

export type Uniforms = Record<string, number>

export interface ShaderPass {
  /** Program cache key — use the effect id. */
  id: string
  /** Full GLSL ES 3.00 fragment source from the catalog. */
  source: string
  uniforms: Uniforms
  textures?: Record<string, TexImageSource>
  /** Copy the current accumulated image into the hold buffer BEFORE this pass runs. */
  snapshot?: boolean
  /** Composite this pass's output over the held image via blendLayers. */
  composite?: { blendIdx: number; opacity: number }
}

/** Expand one effect into N ping-pong passes (u_pass / u_passCount set per pass). */
export function expandPasses(
  id: string,
  source: string,
  uniforms: Uniforms,
  textures: Record<string, TexImageSource> | undefined,
  passCount: number,
): ShaderPass[] {
  const n = Math.max(1, Math.floor(passCount))
  const out: ShaderPass[] = []
  for (let k = 0; k < n; k++) {
    out.push({ id, source, uniforms: { ...uniforms, u_pass: k, u_passCount: n }, textures })
  }
  return out
}

const VS = `#version 300 es
out vec2 v_texCoord;
void main() {
  vec2 verts[3] = vec2[](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
  v_texCoord = verts[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(verts[gl_VertexID], 0., 1.);
}`

// NOTE: no Y-flip here. Internal textures are GL y-up (flipped upload), and the
// browser presents the WebGL drawing buffer y-up too (toDataURL/drawImage read
// row height-1 as the image top), so a direct blit already lands in image
// orientation. Flipping here double-flips — caught by the parity harness
// (tests/shaderfx-golden.spec.ts): every effect diffed ~69/255 vs server
// goldens direct, ~0.03/255 flipped.
const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_image0;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() { fragColor0 = texture(u_image0, v_texCoord); }`

// Composite pass: blend this layer's output (u_image0) over the held input
// (u_below) via the shared blendLayers vocabulary, then mix by opacity.
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_texCoord; out vec4 fragColor;
uniform sampler2D u_image0; uniform sampler2D u_below;
uniform float u_blend; uniform float u_opacity;
${BLEND_LAYERS_GLSL}
void main() {
  vec3 below = texture(u_below, v_texCoord).rgb;
  vec3 above = texture(u_image0, v_texCoord).rgb;
  vec3 b = blendLayers(below, above, u_blend);
  fragColor = vec4(mix(below, b, clamp(u_opacity, 0.0, 1.0)), 1.0);
}`

class ShaderFxRenderer {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private programs = new Map<string, { source: string; prog: WebGLProgram }>()
  private blit: WebGLProgram | null = null
  private composite: WebGLProgram | null = null
  private fboTex: (WebGLTexture | null)[] = [null, null]
  private fbos: (WebGLFramebuffer | null)[] = [null, null]
  // Third off-band buffer: holds the snapshot of a layer's input so a composite
  // pass can blend the layer's output back over what was beneath it.
  private holdTex: WebGLTexture | null = null
  private holdFbo: WebGLFramebuffer | null = null
  private fboSize = [0, 0]
  private baseTex: WebGLTexture | null = null
  private baseSize = [0, 0]
  // Contract: pass.textures values must be STABLE, immutable objects (e.g. the
  // module-cached glyph-atlas Images) — entries are uploaded once and reused.
  // Bounded so a misbehaving caller leaks at most MAX_EXTRA_TEXTURES GL textures.
  private extraTexCache = new Map<TexImageSource, WebGLTexture>()
  private static readonly MAX_EXTRA_TEXTURES = 32

  private ensure(width: number, height: number): WebGL2RenderingContext {
    if (!this.gl) {
      this.canvas = document.createElement('canvas')
      // preserveDrawingBuffer so toDataURL/drawImage after render is always safe
      this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false })
      if (!this.gl) throw new Error('WebGL2 unavailable')
    }
    const gl = this.gl
    if (this.canvas!.width !== width || this.canvas!.height !== height) {
      this.canvas!.width = width
      this.canvas!.height = height
    }
    if (this.fboSize[0] !== width || this.fboSize[1] !== height) {
      for (let i = 0; i < 2; i++) {
        if (this.fboTex[i]) gl.deleteTexture(this.fboTex[i] ?? null)
        if (this.fbos[i]) gl.deleteFramebuffer(this.fbos[i] ?? null)
        const tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        const fbo = gl.createFramebuffer()
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
        this.fboTex[i] = tex
        this.fbos[i] = fbo
      }
      // Hold buffer (same storage as the ping-pong pair) for composite snapshots.
      if (this.holdTex) gl.deleteTexture(this.holdTex)
      if (this.holdFbo) gl.deleteFramebuffer(this.holdFbo)
      {
        const tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        const fbo = gl.createFramebuffer()
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
        this.holdTex = tex
        this.holdFbo = fbo
      }
      this.fboSize = [width, height]
    }
    return gl
  }

  private program(id: string, source: string): WebGLProgram {
    const gl = this.gl!
    // Key by id, validate by full source: the catalog re-reads .frag files from
    // disk per request to support live shader editing, so a stale cached program
    // must be detected and recompiled (and the old one freed).
    const cached = this.programs.get(id)
    if (cached) {
      if (cached.source === source) return cached.prog
      gl.deleteProgram(cached.prog)
      this.programs.delete(id)
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s)
        gl.deleteShader(s)
        throw new Error(`shaderfx compile (${id}): ${log}`)
      }
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, source))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`shaderfx link (${id}): ${gl.getProgramInfoLog(prog)}`)
    this.programs.set(id, { source, prog })
    return prog
  }

  private uploadTexture(tex: WebGLTexture, src: TexImageSource, flipY: boolean, nearest: boolean, subRect?: [number, number]): void {
    const gl = this.gl!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY)
    if (subRect) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, subRect[0], subRect[1], gl.RGBA, gl.UNSIGNED_BYTE, src as any)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    const filter = nearest ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /**
   * Run `passes` over `base`, return the canvas (valid until the next render call).
   * Pass 0 reads base; pass N reads pass N-1's output. Internal orientation is
   * GL y-up (matches the server's flipped upload); the final blit samples
   * directly — browser canvas readout (toDataURL/drawImage) is already
   * top-row-last in GL terms, so no flip is needed (see BLIT_FS note).
   */
  get outputCanvas(): HTMLCanvasElement | null { return this.canvas }

  render(passes: ShaderPass[], base: TexImageSource, width: number, height: number): HTMLCanvasElement {
    const gl = this.ensure(width, height)

    if (!this.baseTex) this.baseTex = gl.createTexture()
    const bw = (base as any).width ?? 0
    const bh = (base as any).height ?? 0
    const sameSize = this.baseSize[0] === bw && this.baseSize[1] === bh && bw > 0
    // Same-size animated re-renders update in place instead of reallocating storage.
    this.uploadTexture(this.baseTex!, base, true, false, sameSize ? [bw, bh] : undefined)
    this.baseSize = [bw, bh]

    let readTex = this.baseTex!
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i]!

      // Snapshot the current accumulated image into the hold buffer BEFORE this
      // pass runs, so a later composite pass can blend over the layer's input.
      if (pass.snapshot) {
        if (!this.blit) this.blit = this.program('__blit__', BLIT_FS)
        gl.useProgram(this.blit)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.holdFbo ?? null)
        gl.viewport(0, 0, width, height)
        gl.disable(gl.BLEND)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, readTex)
        const hloc = gl.getUniformLocation(this.blit, 'u_image0')
        if (hloc) gl.uniform1i(hloc, 0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }

      // Composite pass: blend this pass's input (readTex = the layer output) over
      // the held image via the composite program. Its `source` is ignored.
      if (pass.composite) {
        if (!this.composite) this.composite = this.program('__composite__', COMPOSITE_FS)
        gl.useProgram(this.composite)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[i % 2] ?? null)
        gl.viewport(0, 0, width, height)
        gl.disable(gl.BLEND)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, readTex)
        const aLoc = gl.getUniformLocation(this.composite, 'u_image0')
        if (aLoc) gl.uniform1i(aLoc, 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.holdTex)
        const bLoc = gl.getUniformLocation(this.composite, 'u_below')
        if (bLoc) gl.uniform1i(bLoc, 1)
        const blLoc = gl.getUniformLocation(this.composite, 'u_blend')
        if (blLoc) gl.uniform1f(blLoc, pass.composite.blendIdx)
        const opLoc = gl.getUniformLocation(this.composite, 'u_opacity')
        if (opLoc) gl.uniform1f(opLoc, pass.composite.opacity)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        readTex = this.fboTex[i % 2]!
        continue
      }

      const prog = this.program(pass.id, pass.source)
      gl.useProgram(prog)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[i % 2] ?? null)
      gl.viewport(0, 0, width, height)
      gl.disable(gl.BLEND)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, readTex)
      const imgLoc = gl.getUniformLocation(prog, 'u_image0')
      if (imgLoc) gl.uniform1i(imgLoc, 0)

      // u_source = the original input, available to every pass (e.g. bloom composite)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.baseTex!)
      const srcLoc = gl.getUniformLocation(prog, 'u_source')
      if (srcLoc) gl.uniform1i(srcLoc, 1)

      let unit = 2
      for (const [name, src] of Object.entries(pass.textures ?? {})) {
        let tex = this.extraTexCache.get(src)
        gl.activeTexture(gl.TEXTURE0 + unit)
        if (!tex) {
          if (this.extraTexCache.size >= ShaderFxRenderer.MAX_EXTRA_TEXTURES) {
            const [oldSrc, oldTex] = this.extraTexCache.entries().next().value!
            gl.deleteTexture(oldTex)
            this.extraTexCache.delete(oldSrc)
          }
          tex = gl.createTexture()!
          this.uploadTexture(tex, src, true, true) // NEAREST — glyph atlases sampled exactly
          this.extraTexCache.set(src, tex)
        } else {
          gl.bindTexture(gl.TEXTURE_2D, tex)
        }
        const loc = gl.getUniformLocation(prog, name)
        if (loc) gl.uniform1i(loc, unit)
        unit++
      }

      const resLoc = gl.getUniformLocation(prog, 'u_resolution')
      if (resLoc) gl.uniform2f(resLoc, width, height)
      for (const [name, value] of Object.entries(pass.uniforms)) {
        const loc = gl.getUniformLocation(prog, name)
        if (loc) gl.uniform1f(loc, value)
      }

      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      readTex = this.fboTex[i % 2]!
    }

    // Blit final texture to the canvas (no flip — see BLIT_FS note).
    if (!this.blit) this.blit = this.program('__blit__', BLIT_FS)
    gl.useProgram(this.blit)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, readTex)
    const loc = gl.getUniformLocation(this.blit, 'u_image0')
    if (loc) gl.uniform1i(loc, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas!
  }
}

export const shaderFx = new ShaderFxRenderer()
