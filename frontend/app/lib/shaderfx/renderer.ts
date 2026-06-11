// Singleton WebGL2 renderer for ShaderEffect previews.
// One GL context app-wide (browsers cap ~8-16); callers drawImage() the returned canvas.

export type Uniforms = Record<string, number>

export interface ShaderPass {
  /** Program cache key — use the effect id. */
  id: string
  /** Full GLSL ES 3.00 fragment source from the catalog. */
  source: string
  uniforms: Uniforms
  textures?: Record<string, TexImageSource>
}

const VS = `#version 300 es
out vec2 v_texCoord;
void main() {
  vec2 verts[3] = vec2[](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
  v_texCoord = verts[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(verts[gl_VertexID], 0., 1.);
}`

const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_image0;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() { fragColor0 = texture(u_image0, vec2(v_texCoord.x, 1.0 - v_texCoord.y)); }`

class ShaderFxRenderer {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private programs = new Map<string, WebGLProgram>()
  private blit: WebGLProgram | null = null
  private fboTex: (WebGLTexture | null)[] = [null, null]
  private fbos: (WebGLFramebuffer | null)[] = [null, null]
  private fboSize = [0, 0]
  private baseTex: WebGLTexture | null = null
  private extraTexCache = new Map<TexImageSource, WebGLTexture>()

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
      this.fboSize = [width, height]
    }
    return gl
  }

  private program(id: string, source: string): WebGLProgram {
    const key = `${id}:${source.length}:${source.slice(0, 64)}`
    let prog = this.programs.get(key)
    if (prog) return prog
    const gl = this.gl!
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
    prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, source))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`shaderfx link (${id}): ${gl.getProgramInfoLog(prog)}`)
    this.programs.set(key, prog)
    return prog
  }

  private uploadTexture(tex: WebGLTexture, src: TexImageSource, flipY: boolean, nearest: boolean): void {
    const gl = this.gl!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
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
   * GL y-up (matches the server's flipped upload); the final blit flips back.
   */
  render(passes: ShaderPass[], base: TexImageSource, width: number, height: number): HTMLCanvasElement {
    const gl = this.ensure(width, height)

    if (!this.baseTex) this.baseTex = gl.createTexture()
    this.uploadTexture(this.baseTex!, base, true, false)

    let readTex = this.baseTex!
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i]!
      const prog = this.program(pass.id, pass.source)
      gl.useProgram(prog)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[i % 2] ?? null)
      gl.viewport(0, 0, width, height)
      gl.disable(gl.BLEND)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, readTex)
      const imgLoc = gl.getUniformLocation(prog, 'u_image0')
      if (imgLoc) gl.uniform1i(imgLoc, 0)

      let unit = 1
      for (const [name, src] of Object.entries(pass.textures ?? {})) {
        let tex = this.extraTexCache.get(src)
        gl.activeTexture(gl.TEXTURE0 + unit)
        if (!tex) {
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

    // Blit final texture to the canvas, flipping Y back to image orientation.
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
