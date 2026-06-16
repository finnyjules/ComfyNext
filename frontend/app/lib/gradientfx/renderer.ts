// Singleton WebGL2 renderer for Gradient Studio. One GL context app-wide; callers
// drawImage() the returned canvas (preview) or toBlob() it (export). A single
// fragment shader synthesizes the whole image from a GradientConfig.

import { buildField } from './field'
import { applyMotion } from './motion'
import { buildRampLut } from './ramp'
import { hexToRgb } from './ramp'
import { GRADIENT_FS, GRADIENT_VS } from './shaders'
import {
  aspectRatio, type BlendKind, type Direction, type GradientConfig,
  type LayoutKind, type MappingKind,
} from './types'

const DIR_IDX: Record<Direction, number> = { up: 0, right: 1, down: 2, left: 3 }
const BLEND_IDX: Record<BlendKind, number> = { normal: 0, lighten: 1, screen: 2, add: 3, multiply: 4, darken: 5, overlay: 6 }
const MAP_IDX: Record<MappingKind, number> = { across: 0, perbar: 1, field: 2 }
const LAYOUT_IDX: Record<LayoutKind, number> = { linear: 0, radial: 1, orbit: 2 }

class GradientFxRenderer {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private prog: WebGLProgram | null = null
  private fieldTex: (WebGLTexture | null)[] = [null, null]
  private rampTex: (WebGLTexture | null)[] = [null, null]

  private ensure(width: number, height: number): WebGL2RenderingContext {
    if (!this.gl) {
      this.canvas = document.createElement('canvas')
      this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false })
      if (!this.gl) throw new Error('WebGL2 unavailable')
      this.prog = this.compile(this.gl)
      for (let i = 0; i < 2; i++) { this.fieldTex[i] = this.gl.createTexture(); this.rampTex[i] = this.gl.createTexture() }
    }
    const gl = this.gl
    if (this.canvas!.width !== width || this.canvas!.height !== height) {
      this.canvas!.width = width
      this.canvas!.height = height
    }
    return gl
  }

  private compile(gl: WebGL2RenderingContext): WebGLProgram {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s); gl.deleteShader(s)
        throw new Error(`gradientfx compile: ${log}`)
      }
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, GRADIENT_VS))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, GRADIENT_FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`gradientfx link: ${gl.getProgramInfoLog(prog)}`)
    return prog
  }

  private uploadField(gl: WebGL2RenderingContext, slot: number, data: Float32Array) {
    const bytes = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, data[i]!)) * 255)
    gl.activeTexture(gl.TEXTURE0 + slot)
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex[slot]!)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, data.length, 1, 0, gl.RED, gl.UNSIGNED_BYTE, bytes)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  private uploadRamp(gl: WebGL2RenderingContext, slot: number, lut: Uint8Array) {
    gl.activeTexture(gl.TEXTURE0 + 2 + slot)
    gl.bindTexture(gl.TEXTURE_2D, this.rampTex[slot]!)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lut.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /** Render `cfg` at `time` seconds into the shared canvas; returns it. */
  render(cfg: GradientConfig, width: number, height: number, time = 0): HTMLCanvasElement {
    const c = applyMotion(cfg, time)
    const gl = this.ensure(width, height)
    const prog = this.prog!
    gl.useProgram(prog)

    const layers = c.layers.slice(0, 2)
    const arr = (vals: number[]) => new Float32Array([vals[0] ?? 0, vals[1] ?? vals[0] ?? 0])
    const u = (name: string) => gl.getUniformLocation(prog, name)

    // Per-layer textures + uniform arrays.
    const counts: number[] = [], dir: number[] = [], mirror: number[] = [], gap: number[] = []
    const rounding: number[] = [], mapping: number[] = [], steps: number[] = [], hueDrift: number[] = []
    const hueRotate: number[] = [], sweep: number[] = [], scrub: number[] = [], blend: number[] = [], opacity: number[] = []
    const crisp: number[] = []
    for (let i = 0; i < 2; i++) {
      const L = layers[i] ?? layers[0]!
      const s = L.shape, col = L.color
      this.uploadField(gl, i, buildField(s, c.seed + ':' + i))
      this.uploadRamp(gl, i, buildRampLut(col.stops))
      crisp.push(s.type === 'bands' ? 1 : 0)
      counts.push(Math.max(1, Math.round(s.count)))
      dir.push(DIR_IDX[s.direction] ?? 2)
      mirror.push(s.mirror ? 1 : 0)
      gap.push(s.gap)
      rounding.push(s.rounding)
      mapping.push(MAP_IDX[col.mapping] ?? 0)
      steps.push(col.steps)
      hueDrift.push(col.hueDrift)
      hueRotate.push(col.hueRotate)
      sweep.push(Math.max(0.02, Math.min(1, (s.sweep || 360) / 360)))
      scrub.push(s.scrub)
      blend.push(BLEND_IDX[L.blend] ?? 0)
      opacity.push(L.opacity)
    }

    gl.uniform1i(u('u_field0'), 0)
    gl.uniform1i(u('u_field1'), 1)
    gl.uniform1i(u('u_ramp0'), 2)
    gl.uniform1i(u('u_ramp1'), 3)

    gl.uniform2f(u('u_resolution'), width, height)
    gl.uniform1f(u('u_aspect'), aspectRatio(c.canvas.aspect))
    gl.uniform1f(u('u_time'), time)
    gl.uniform1f(u('u_seed'), (xmur(c.seed) % 10000))
    gl.uniform1f(u('u_layout'), LAYOUT_IDX[c.canvas.layout] ?? 0)
    gl.uniform1f(u('u_margin'), c.canvas.margin)
    gl.uniform1f(u('u_innerRadius'), c.canvas.innerRadius)
    const bg = hexToRgb(c.canvas.background)
    gl.uniform3f(u('u_bg'), bg.r / 255, bg.g / 255, bg.b / 255)
    gl.uniform1f(u('u_grain'), c.relief.grain)
    gl.uniform1f(u('u_relief'), c.relief.relief)
    gl.uniform1f(u('u_layerCount'), layers.length)

    gl.uniform1fv(u('u_count'), arr(counts))
    gl.uniform1fv(u('u_dir'), arr(dir))
    gl.uniform1fv(u('u_mirror'), arr(mirror))
    gl.uniform1fv(u('u_gap'), arr(gap))
    gl.uniform1fv(u('u_rounding'), arr(rounding))
    gl.uniform1fv(u('u_mapping'), arr(mapping))
    gl.uniform1fv(u('u_steps'), arr(steps))
    gl.uniform1fv(u('u_hueDrift'), arr(hueDrift))
    gl.uniform1fv(u('u_hueRotate'), arr(hueRotate))
    gl.uniform1fv(u('u_sweep'), arr(sweep))
    gl.uniform1fv(u('u_scrub'), arr(scrub))
    gl.uniform1fv(u('u_blend'), arr(blend))
    gl.uniform1fv(u('u_opacity'), arr(opacity))
    gl.uniform1fv(u('u_crisp'), arr(crisp))

    gl.viewport(0, 0, width, height)
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas!
  }

  /** Render then export a PNG blob at the given size. */
  async renderToBlob(cfg: GradientConfig, width: number, height: number, time = 0, type = 'image/png'): Promise<Blob> {
    this.render(cfg, width, height, time)
    const canvas = this.canvas!
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, 0.95))
  }
}

// Tiny inline hash for the grain seed uniform (avoids importing rng's full API).
function xmur(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export const gradientFx = new GradientFxRenderer()
