// Singleton WebGL2 renderer for Gradient Studio. One GL context app-wide; callers
// drawImage() the returned canvas (preview) or toBlob() it (export). A single
// fragment shader synthesizes the whole image from a GradientConfig.

import { buildField } from './field'
import { MESH_MAX_POINTS, buildMeshPoints, driftedMeshPositions, meshColorRgb } from './mesh'
import { applyMotion } from './motion'
import { buildRampLut } from './ramp'
import { hexToRgb } from './ramp'
import { BLUR_FS, GRADIENT_FS, GRADIENT_VS } from './shaders'
import { aspectRatio, canvasCenter, flowConfig, lightVector, reliefLight, LAYER_MAX,
  type Direction, type FocusConfig, type GradientConfig,
  type LayoutKind, type MappingKind } from './types'
import { BLEND_IDX } from '~/lib/studio/blend'

const FOCUS_IDX: Record<FocusConfig['shape'], number> = { off: 0, radial: 1, linear: 2 }
/** Blur amount 0..1 → max kernel radius as a fraction of the min canvas dimension. */
const MAX_BLUR_FRAC = 0.12

const DIR_IDX: Record<Direction, number> = { up: 0, right: 1, down: 2, left: 3 }
const MAP_IDX: Record<MappingKind, number> = { across: 0, perbar: 1, field: 2 }
const LAYOUT_IDX: Record<LayoutKind, number> = { linear: 0, radial: 1, orbit: 2, stack: 3, liquid: 4, mesh: 5 }

class GradientFxRenderer {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private prog: WebGLProgram | null = null
  private blurProg: WebGLProgram | null = null
  // Per-layer fields/ramps as 2D array textures (one array layer per gradient layer),
  // sized 256 × 1 × LAYER_MAX. GLSL ES can't index a sampler[] by a loop variable, so
  // the composite loop reads them as sampler2DArray.
  private fieldArrayTex: WebGLTexture | null = null
  private rampArrayTex: WebGLTexture | null = null
  // Offscreen target for the soft-focus post pass (allocated on first blur; resized with the canvas).
  private fbo: WebGLFramebuffer | null = null
  private sceneTex: WebGLTexture | null = null
  private fboW = 0
  private fboH = 0

  private ensure(width: number, height: number): WebGL2RenderingContext {
    if (!this.gl) {
      this.canvas = document.createElement('canvas')
      this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false })
      if (!this.gl) throw new Error('WebGL2 unavailable')
      this.prog = this.compile(this.gl, GRADIENT_FS)
      this.blurProg = this.compile(this.gl, BLUR_FS)
      const g = this.gl
      const mk = (internal: number) => {
        const t = g.createTexture()
        g.bindTexture(g.TEXTURE_2D_ARRAY, t)
        g.texStorage3D(g.TEXTURE_2D_ARRAY, 1, internal, 256, 1, LAYER_MAX)
        g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MIN_FILTER, g.LINEAR)
        g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MAG_FILTER, g.LINEAR)
        g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
        g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
        return t
      }
      this.fieldArrayTex = mk(g.R8)
      this.rampArrayTex = mk(g.RGBA8)
    }
    const gl = this.gl
    if (this.canvas!.width !== width || this.canvas!.height !== height) {
      this.canvas!.width = width
      this.canvas!.height = height
    }
    return gl
  }

  private compile(gl: WebGL2RenderingContext, fragmentSrc: string): WebGLProgram {
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
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fragmentSrc))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`gradientfx link: ${gl.getProgramInfoLog(prog)}`)
    return prog
  }

  /** (Re)allocate the offscreen colour target used by the soft-focus post pass.
   *  Binds on a SCRATCH unit (4) — never 0/1, which the main shader samples for its
   *  field/ramp array textures. If the scene texture were bound to unit 0 (u_fields) it
   *  would be sampled while ALSO being the FBO's colour attachment during pass 1 —
   *  a texture feedback loop that drivers render as pure black. */
  private ensureSceneTarget(gl: WebGL2RenderingContext, width: number, height: number) {
    if (!this.fbo) { this.fbo = gl.createFramebuffer(); this.sceneTex = gl.createTexture() }
    if (this.fboW !== width || this.fboH !== height) {
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex!)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex!, 0)
      this.fboW = width; this.fboH = height
    }
  }

  /** Second pass: sample the rendered scene texture with the focus-masked disc blur,
   *  then re-apply film grain on top (deferred from the main pass so blur can't
   *  average it away). */
  private blurPass(gl: WebGL2RenderingContext, width: number, height: number, foc: FocusConfig, grain: number, seed: number) {
    const prog = this.blurProg!
    gl.useProgram(prog)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex!)
    const u = (n: string) => gl.getUniformLocation(prog, n)
    gl.uniform1i(u('u_src'), 0)
    gl.uniform2f(u('u_resolution'), width, height)
    gl.uniform1f(u('u_blur'), Math.min(1, Math.max(0, foc.blur / 100)) * MAX_BLUR_FRAC)
    gl.uniform1f(u('u_focusShape'), FOCUS_IDX[foc.shape] ?? 0)
    gl.uniform2f(u('u_focusCenter'), foc.x ?? 0, foc.y ?? 0)
    gl.uniform1f(u('u_focusRadius'), foc.radius ?? 0.25)
    gl.uniform1f(u('u_focusSoft'), Math.max(0, (foc.softness ?? 40) / 100))
    gl.uniform1f(u('u_focusAngle'), (foc.angle ?? 0) * Math.PI / 180)
    gl.uniform1f(u('u_grain'), grain)
    gl.uniform1f(u('u_seed'), seed)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private uploadField(gl: WebGL2RenderingContext, layer: number, data: Float32Array) {
    // Left-aligned in the 256-wide array layer; the shader scales sample coords by
    // u_fieldW/256. Replicate the last value into one guard texel past the data (when
    // width < 256) so LINEAR filtering past the last texel centre stays flat instead of
    // interpolating into texStorage3D's zero fill — this keeps the neighbour sample that
    // clamps to x=1.0 byte-identical to the old per-slot (edge-clamped) texture.
    const w = data.length
    const padW = Math.min(w + 1, 256)
    const bytes = new Uint8Array(padW)
    for (let i = 0; i < w; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, data[i]!)) * 255)
    if (padW > w) bytes[w] = bytes[w - 1]!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fieldArrayTex!)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, padW, 1, 1, gl.RED, gl.UNSIGNED_BYTE, bytes)
  }

  private uploadRamp(gl: WebGL2RenderingContext, layer: number, lut: Uint8Array) {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.rampArrayTex!)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, lut.length / 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, lut)
  }

  /** Render `cfg` at `time` seconds into the shared canvas; returns it. */
  render(cfg: GradientConfig, width: number, height: number, time = 0): HTMLCanvasElement {
    const c = applyMotion(cfg, time)
    const gl = this.ensure(width, height)
    const prog = this.prog!
    gl.useProgram(prog)

    const layers = c.layers.slice(0, LAYER_MAX)
    const arr = (vals: number[]) => {
      const out = new Float32Array(LAYER_MAX)
      for (let i = 0; i < LAYER_MAX; i++) out[i] = vals[i] ?? vals[0] ?? 0
      return out
    }
    const u = (name: string) => gl.getUniformLocation(prog, name)

    // Per-layer textures + uniform arrays.
    const counts: number[] = [], dir: number[] = [], mirrorH: number[] = [], mirrorV: number[] = [], gradHoriz: number[] = [], gap: number[] = []
    const rounding: number[] = [], mapping: number[] = [], steps: number[] = [], hueDrift: number[] = []
    const hueRotate: number[] = [], sweep: number[] = [], scrub: number[] = [], blend: number[] = [], opacity: number[] = []
    const crisp: number[] = [], rotStep: number[] = [], pivot: number[] = [], ringScale: number[] = [], ringShape: number[] = []
    const fieldW: number[] = []
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i] ?? layers[0]!
      const s = L.shape, col = L.color
      const fieldData = buildField(s, c.seed + ':' + i)
      this.uploadField(gl, i, fieldData)
      this.uploadRamp(gl, i, buildRampLut(col.stops))
      fieldW.push(fieldData.length)
      crisp.push(s.type === 'bands' ? 1 : 0)
      counts.push(Math.max(1, Math.round(s.count)))
      dir.push(DIR_IDX[s.direction] ?? 2)
      mirrorH.push(s.mirror === 'horizontal' || s.mirror === 'both' ? 1 : 0)
      mirrorV.push(s.mirror === 'vertical' || s.mirror === 'both' ? 1 : 0)
      gradHoriz.push(col.gradientDir === 'horizontal' ? 1 : 0)
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
      rotStep.push((s.rotStep ?? 0) * Math.PI / 180)  // deg → rad
      pivot.push(s.pivot ?? 0)
      ringScale.push(s.ringScale ?? 1)
      ringShape.push(s.ringShape === 'square' ? 2 : s.ringShape === 'diamond' ? 1 : 0)
    }

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fieldArrayTex)
    gl.uniform1i(u('u_fields'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.rampArrayTex)
    gl.uniform1i(u('u_ramps'), 1)

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
    // When the soft-focus post pass is active, defer grain to it so blur can't
    // average the grain away (grain supersedes blur).
    const blurActive = !!(c.focus && c.focus.blur > 0.001)
    gl.uniform1f(u('u_grainDeferred'), blurActive ? 1 : 0)
    gl.uniform1f(u('u_relief'), c.relief.relief)
    const light = reliefLight(c.relief)
    const lv = lightVector(light.azimuth, light.elevation)
    gl.uniform3f(u('u_light'), lv[0], lv[1], lv[2])
    const ctr = canvasCenter(c.canvas)
    gl.uniform2f(u('u_center'), ctr.x, ctr.y)
    gl.uniform1f(u('u_layerCount'), layers.length)

    const fl = flowConfig(c)
    gl.uniform1f(u('u_flowAngle'), fl.angle)
    gl.uniform1f(u('u_flowScale'), Math.max(0.2, fl.noiseScale))
    gl.uniform1f(u('u_flowIntensity'), (fl.intensity / 100) * 0.6)   // 0..0.6 displacement
    gl.uniform1f(u('u_flowDistortion'), (fl.distortion / 100) * 3.0) // 0..3 iterative curl
    gl.uniform1f(u('u_flowDetail'), Math.max(1, Math.min(6, Math.round(fl.detail))))
    gl.uniform1f(u('u_flowDepth'), fl.depth / 100)
    gl.uniform1f(u('u_flowHighlights'), fl.highlights / 100)
    gl.uniform1f(u('u_flowShadows'), fl.shadows / 100)
    gl.uniform1f(u('u_flowFoldScale'), 1.0 + (fl.foldScale / 100) * 6.0) // freq 1..7
    gl.uniform1f(u('u_flowGloss'), (fl.gloss ?? 0) / 100)
    gl.uniform1f(u('u_flowVeins'), (fl.veins ?? 0) / 100)
    gl.uniform1f(u('u_flowVeinScale'), 2.0 + ((fl.veinScale ?? 35) / 100) * 10.0) // freq 2..12
    gl.uniform1f(u('u_flowRipple'), (fl.ripple ?? 0) / 100)
    gl.uniform1f(u('u_flowRefract'), (fl.refract ?? 0) / 100)
    gl.uniform1f(u('u_flowViscosity'), (fl.viscosity ?? 0) / 100)
    gl.uniform1f(u('u_flowSwirl'), ((fl.swirl ?? 0) / 100) * 1.5)

    // Living drift: a normalized 0..1 loop phase from the clip time. Two circular
    // offsets (120° apart) drive the INNER fbm layers so the warp CHURNS/morphs in
    // place (liquify) rather than translating rigidly; both loop seamlessly (phase 0
    // == phase 1) since they're cos/sin of the phase. All zero when speed is 0, so
    // the static field is unchanged.
    const dur = Math.max(0.1, c.motion?.duration ?? 4)
    const loopPhase = (((time % dur) + dur) % dur) / dur
    const speed = fl.speed ?? 0
    let a1x = 0, a1y = 0, a2x = 0, a2y = 0, animAmt = 0
    if (speed > 0) {
      // Cycle count must stay integral for the loop to close, so 1 loop per clip is
      // the hard floor — the low end is made slow by shrinking the churn amplitude
      // instead. Quadratic easing keeps 1..20 a barely-there drift while the top of
      // the range stays as energetic as before.
      const s = speed / 100
      const ease = s * s
      const cycles = Math.max(1, Math.round(speed / 34))     // 1..3 loops per clip
      const ang = loopPhase * Math.PI * 2 * cycles
      const rad = 0.02 + ease * 1.08                         // churn radius in noise space
      a1x = Math.cos(ang) * rad; a1y = Math.sin(ang) * rad
      a2x = Math.cos(ang + 2.0944) * rad; a2y = Math.sin(ang + 2.0944) * rad // +120°
      animAmt = 0.04 + ease * 1.36                           // fold-field churn strength
    }
    gl.uniform2f(u('u_flowAnim1'), a1x, a1y)
    gl.uniform2f(u('u_flowAnim2'), a2x, a2y)
    gl.uniform1f(u('u_flowAnimAmt'), animAmt)

    // Mesh points (layout 'mesh', layer 0). Fall back to derived points so a mesh
    // config that somehow lacks them still renders. Drift orbits each point per loop.
    const meshPos = new Float32Array(MESH_MAX_POINTS * 2)
    const meshCol = new Float32Array(MESH_MAX_POINTS * 3)
    let meshCount = 0, meshRadius = 0.4, meshContrast = 0, meshBlur = 0
    if (c.canvas.layout === 'mesh') {
      const L0 = layers[0]!
      const m = L0.mesh
      const pts = (m?.points && m.points.length >= 2) ? m.points : buildMeshPoints(6, L0.color.stops, c.seed)
      meshRadius = 0.18 + ((m?.softness ?? 55) / 100) * 0.55
      meshContrast = (m?.contrast ?? 0) / 100
      // Radius in mesh-field units (points live in 0..1), so 0.34 averages over a
      // third of the canvas at full blur. The field is already Gaussian-smooth, so a
      // small radius reads as no change at all — it needs to be this wide to register.
      meshBlur = ((m?.blur ?? 0) / 100) * 0.34
      const drift = (m?.drift ?? 0) / 100
      const xy = driftedMeshPositions(pts, drift, loopPhase, c.seed)
      meshCount = Math.min(MESH_MAX_POINTS, pts.length)
      for (let k = 0; k < meshCount; k++) {
        meshPos[k * 2] = xy[k]!.x; meshPos[k * 2 + 1] = xy[k]!.y
        const rgb = meshColorRgb(pts[k]!)
        meshCol[k * 3] = rgb[0]; meshCol[k * 3 + 1] = rgb[1]; meshCol[k * 3 + 2] = rgb[2]
      }
    }
    gl.uniform1f(u('u_meshCount'), meshCount)
    gl.uniform2fv(u('u_meshPos'), meshPos)
    gl.uniform3fv(u('u_meshCol'), meshCol)
    gl.uniform1f(u('u_meshRadius'), meshRadius)
    gl.uniform1f(u('u_meshContrast'), meshContrast)
    gl.uniform1f(u('u_meshBlur'), meshBlur)

    gl.uniform1fv(u('u_count'), arr(counts))
    gl.uniform1fv(u('u_dir'), arr(dir))
    gl.uniform1fv(u('u_mirrorH'), arr(mirrorH))
    gl.uniform1fv(u('u_mirrorV'), arr(mirrorV))
    gl.uniform1fv(u('u_gradHoriz'), arr(gradHoriz))
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
    gl.uniform1fv(u('u_rotStep'), arr(rotStep))
    gl.uniform1fv(u('u_pivot'), arr(pivot))
    gl.uniform1fv(u('u_ringScale'), arr(ringScale))
    gl.uniform1fv(u('u_ringShape'), arr(ringShape))
    gl.uniform1fv(u('u_fieldW'), arr(fieldW))

    gl.viewport(0, 0, width, height)
    gl.disable(gl.BLEND)

    // Soft-focus / DoF post stage. blur === 0 → the exact original single-pass path
    // (draw straight to the canvas). Otherwise render the scene to an offscreen
    // texture, then blur it into the canvas with a focus-masked disc kernel.
    const foc = c.focus
    if (blurActive && foc) {
      this.ensureSceneTarget(gl, width, height)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.blurPass(gl, width, height, foc, c.relief.grain, xmur(c.seed) % 10000)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
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

// One WebGL renderer per page. Cached on `globalThis` rather than a plain module
// const so that Vite HMR re-evaluating this module during dev cannot spin up a
// *second* GL context: two renderers drawing the shared preview canvas at different
// times is exactly what made the editor/canvas flicker after a hot update. In
// production the module evaluates once, so this is behaviour-identical. Note: editing
// the engine during dev may need a manual page reload to take visual effect, but there
// is always exactly one live context.
interface GradientFxScope { __sailorGradientFx?: GradientFxRenderer }

export function resolveGradientFx(scope: GradientFxScope): GradientFxRenderer {
  return scope.__sailorGradientFx ?? (scope.__sailorGradientFx = new GradientFxRenderer())
}

export const gradientFx = resolveGradientFx(globalThis as unknown as GradientFxScope)
