<template>
  <div style="padding: 8px; font: 12px monospace">gradient harness ready</div>
</template>

<script setup lang="ts">
// Headless probe for Gradient Studio's post-stage adoption (Task 5). Mirrors
// /dev/shaderfx-harness's shape: a near-blank page whose script exposes a
// window function that a Playwright test drives (see
// tests/studio-post-integration.spec.ts).
import { GradientFxRenderer } from '~/lib/gradientfx/renderer'
import { defaultConfig } from '~/lib/gradientfx/randomize'
import { cloneConfig, ensureConfigDefaults, type GradientConfig } from '~/lib/gradientfx/types'
import { DEFAULT_POST, type PostSettings } from '~/lib/studio/post/settings'
import { POST_EFFECTS } from '~/lib/studio/post/manifest'

// Own instance rather than the app-wide `gradientFx` singleton — this page never
// shares a tab with a real studio, but a private context keeps the probe fully
// self-contained regardless.
const renderer = new GradientFxRenderer()

// Fixed seed: the probe compares post ON vs OFF at the SAME structure/colours, so
// determinism (not variety) is what matters here.
const HARNESS_SEED = '#postharness'

function luma(src: TexImageSource, w: number, h: number): Float64Array {
  const probe = document.createElement('canvas')
  probe.width = w
  probe.height = h
  const ctx = probe.getContext('2d')!
  ctx.drawImage(src as CanvasImageSource, 0, 0)
  const data = ctx.getImageData(0, 0, w, h).data
  const out = new Float64Array(w * h)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
  }
  return out
}

function correlate(a: Float64Array, b: Float64Array): { meanAbsDiff: number; corr: number } {
  const n = a.length
  let sumAbs = 0
  for (let i = 0; i < n; i++) sumAbs += Math.abs(b[i]! - a[i]!)
  const meanAbsDiff = sumAbs / n / 255

  let sumA = 0, sumB = 0
  for (let i = 0; i < n; i++) { sumA += a[i]!; sumB += b[i]! }
  const meanA = sumA / n, meanB = sumB / n
  let cov = 0, varA = 0, varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA
    const db = b[i]! - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  const corr = cov / (Math.sqrt(varA * varB) || 1)
  return { meanAbsDiff, corr }
}

/**
 * Renders the default gradient at `size` with `effect` OFF, then again with it
 * ON (every other post effect stays off), and reports two numbers over the
 * luma channel:
 *  - meanAbsDiff: mean per-pixel |on - off|, normalized to 0..1 — near 0 means
 *    the post stage didn't run (a no-op chain, or applyPost never called).
 *  - corr: Pearson correlation of the two luma arrays — near 0 means the ON
 *    frame no longer resembles the OFF frame at all (e.g. a broken effect that
 *    flattens the whole frame to a wash). A diff-only check can't see this: a
 *    flat wash also diffs from the original, which is exactly the gap the
 *    2026-08-04 risograph bug slipped through — see
 *    tests/studio-post-integration.spec.ts's header comment.
 *
 * `overrides` merges onto the ON config's post settings (on top of the
 * enable flag), for effects whose DEFAULT_POST values are neutral/no-op at
 * rest — e.g. Color's exposure/contrast/saturation all default to 1 and hue
 * to 0, which is the identity transform, so enabling it alone changes
 * nothing; the test supplies a non-default value to actually exercise it.
 */
async function sailorPostProbe(opts: { effect: string; size: number; overrides?: Partial<PostSettings> }): Promise<{ meanAbsDiff: number; corr: number }> {
  const { effect, size, overrides } = opts
  const def = POST_EFFECTS.find(e => e.id === effect)
  if (!def) throw new Error(`gradient harness: unknown post effect "${effect}"`)

  const base = ensureConfigDefaults(defaultConfig(HARNESS_SEED) as GradientConfig)

  const offCfg = cloneConfig(base)
  offCfg.post = { ...DEFAULT_POST }
  const offLuma = luma(renderer.render(offCfg, size, size, 0), size, size)

  const onCfg = cloneConfig(base)
  onCfg.post = { ...DEFAULT_POST, [def.enableKey]: true, ...overrides } as typeof DEFAULT_POST
  const onLuma = luma(renderer.render(onCfg, size, size, 0), size, size)

  return correlate(offLuma, onLuma)
}

/**
 * Orientation guard (Task 5 review): the meanAbsDiff/corr pair above compares
 * post-on against post-off, but a VERTICALLY FLIPPED-yet-correlated frame
 * (e.g. a y-flip bug in blitBack()) would pass both — flipping doesn't change
 * either the mean |diff| much for a smooth gradient, nor does it necessarily
 * break correlation for content that's roughly symmetric band-to-band.
 * defaultConfig()'s gradient is deliberately vertically ASYMMETRIC (bottom→top
 * pink→magenta→near-black→orange, see randomize.ts's own comment), so this
 * splits each frame into its top and bottom quarter and reports each side's
 * mean luma for post OFF and post ON (effect: bloom, enabled with its own
 * defaults — any effect that runs the shared blit-back path would do). The
 * test asserts the top-vs-bottom RELATIONSHIP (which side is brighter) is the
 * same in both frames; a flip would invert it.
 */
async function sailorPostOrientationProbe(opts: { size: number }): Promise<{ offTop: number; offBottom: number; onTop: number; onBottom: number }> {
  const { size } = opts
  const base = ensureConfigDefaults(defaultConfig(HARNESS_SEED) as GradientConfig)

  const offCfg = cloneConfig(base)
  offCfg.post = { ...DEFAULT_POST }
  const offLuma = luma(renderer.render(offCfg, size, size, 0), size, size)

  const onCfg = cloneConfig(base)
  onCfg.post = { ...DEFAULT_POST, bloom: true }
  const onLuma = luma(renderer.render(onCfg, size, size, 0), size, size)

  const quarter = Math.max(1, Math.floor(size / 4))
  const quarterMean = (arr: Float64Array, rowStart: number, rowEnd: number) => {
    let sum = 0, count = 0
    for (let y = rowStart; y < rowEnd; y++) {
      for (let x = 0; x < size; x++) { sum += arr[y * size + x]!; count++ }
    }
    return sum / count
  }
  return {
    offTop: quarterMean(offLuma, 0, quarter),
    offBottom: quarterMean(offLuma, size - quarter, size),
    onTop: quarterMean(onLuma, 0, quarter),
    onBottom: quarterMean(onLuma, size - quarter, size),
  }
}

/**
 * Grain's SHAPE-COVERAGE gate (Task 8 review, C3).
 *
 * The retired in-shader formula was `col += g * u_grain * 0.16 * cover * midtone`,
 * guarded by `cover > 0.001` — "Gated to shape coverage (clean background)". Every
 * fidelity measurement taken during Task 8 used `defaultConfig`, whose layout is
 * `linear` with margin 0, where `cover` is identically 1 — so the gate was invisible
 * to the measurement and could be dropped without any test noticing. This probe uses
 * a layout where coverage is genuinely below 1 (ORBIT + margin + innerRadius), which
 * is the only kind of fixture that can see it at all.
 *
 * Method: render the same config twice, grain OFF then grain ON, and classify pixels
 * by the OFF frame — a pixel that is exactly the background colour had no shape over
 * it (relief and flow are off, so nothing else can tint the background). Then report,
 * separately for background and covered pixels, how far the ON frame moved. Plus the
 * minimum alpha of the ON frame: the gate is implemented by smuggling coverage
 * through alpha (see GRADIENT_FS's u_coverAlpha), and that transport must never
 * escape the renderer — the studio's output is opaque.
 */
async function sailorGrainCoverageProbe(opts: { size: number; blur?: number }): Promise<{
  bgPixels: number
  fgPixels: number
  bgMaxDiff: number
  bgChanged: number
  fgMaxDiff: number
  fgMeanDiff: number
  minAlpha: number
}> {
  const { size, blur = 0 } = opts
  const base = ensureConfigDefaults(defaultConfig(HARNESS_SEED) as GradientConfig)
  // Orbit rings, pulled well away from the frame edges and hollowed in the middle,
  // over a mid-dark background: lots of genuinely uncovered pixels, and a background
  // luminance where grain's midtone shaping still gives a strong signal.
  base.canvas.layout = 'orbit'
  base.canvas.margin = 0.22
  base.canvas.innerRadius = 0.4
  base.canvas.background = '#204060'
  base.relief.relief = 0
  base.flow = { ...base.flow!, intensity: 0, speed: 0 }
  // focus.blur is a 0..100 slider (see gradientfx/controls.ts), NOT 0..1 — a
  // fractional value here silently renders sharp (radius < 0.6px) and the "blur
  // path" variant would quietly test nothing.
  base.focus = { ...base.focus!, blur, shape: 'off' }

  const read = (post: typeof DEFAULT_POST) => {
    const cfg = cloneConfig(base)
    cfg.post = post
    const out = renderer.render(cfg, size, size, 0)
    const probe = document.createElement('canvas')
    probe.width = size
    probe.height = size
    const ctx = probe.getContext('2d', { willReadFrequently: true })!
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(out, 0, 0)
    return ctx.getImageData(0, 0, size, size).data
  }

  const off = read({ ...DEFAULT_POST })
  const on = read({ ...DEFAULT_POST, grain: true, grainAmount: 1, grainSize: 1 })

  const BG = [0x20, 0x40, 0x60]
  let bgPixels = 0, fgPixels = 0, bgMaxDiff = 0, bgChanged = 0, fgMaxDiff = 0, fgSum = 0
  let minAlpha = 255
  for (let i = 0; i < off.length; i += 4) {
    const d = Math.max(
      Math.abs(on[i]! - off[i]!),
      Math.abs(on[i + 1]! - off[i + 1]!),
      Math.abs(on[i + 2]! - off[i + 2]!),
    )
    minAlpha = Math.min(minAlpha, on[i + 3]!)
    const isBg = off[i] === BG[0] && off[i + 1] === BG[1] && off[i + 2] === BG[2]
    if (isBg) {
      bgPixels++
      bgMaxDiff = Math.max(bgMaxDiff, d)
      if (d > 1) bgChanged++
    } else {
      fgPixels++
      fgMaxDiff = Math.max(fgMaxDiff, d)
      fgSum += d
    }
  }
  return { bgPixels, fgPixels, bgMaxDiff, bgChanged, fgMaxDiff, fgMeanDiff: fgSum / Math.max(1, fgPixels), minAlpha }
}

/**
 * Generic layout probe (simple-gradients verification). Renders a base config with
 * `layout` + `ramp`/`color` overrides applied to layer 0, reads the RGBA back, and
 * returns spatial statistics that let a differential check assert the branch is
 * actually reached and the axis controls actually steer:
 *  - mean luma; rowVar/colVar (which axis carries the gradient — angle test)
 *  - left/right/top/bottom edge means (radial collapse + conic seam)
 *  - axisMinima: count of local minima of the mid-row luma (repeat/tile cycles)
 * Returns a compact stats object AND the mid-row samples for eyeball sanity.
 */
function gradientStats(src: TexImageSource, w: number, h: number) {
  const probe = document.createElement('canvas')
  probe.width = w; probe.height = h
  const ctx = probe.getContext('2d')!
  ctx.drawImage(src as CanvasImageSource, 0, 0)
  const d = ctx.getImageData(0, 0, w, h).data
  const L = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
  }
  let sum = 0
  const rowMean = new Float64Array(h), colMean = new Float64Array(w)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = L(x, y); sum += v; rowMean[y]! += v / w; colMean[x]! += v / h }
  const mean = sum / (w * h)
  const varOf = (a: Float64Array) => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) * (v - m); return s / a.length }
  const edge = (xs: number, xe: number, ys: number, ye: number) => { let s = 0, n = 0; for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) { s += L(x, y); n++ } return s / n }
  // mid-row samples + local-minima count (for tile/repeat)
  const my = h >> 1
  const row: number[] = []; for (let x = 0; x < w; x++) row.push(L(x, my))
  let minima = 0
  for (let x = 2; x < w - 2; x++) if (row[x]! < row[x - 2]! && row[x]! < row[x + 2]!) minima++
  // Mean up-crossings of the mid row = number of ramp cycles (clean tile-count metric).
  let upCross = 0
  for (let x = 1; x < w; x++) if (row[x - 1]! < mean && row[x]! >= mean) upCross++
  // Angular ring at mid radius: sample the luma around a circle centred in the frame.
  // maxAngularJump = the largest adjacent step = the conic seam magnitude (0..255).
  const cx = w / 2, cy = h / 2, rr = Math.min(w, h) * 0.32, N = 180
  const ring: number[] = []
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2
    const x = Math.max(0, Math.min(w - 1, Math.round(cx + Math.cos(a) * rr)))
    const y = Math.max(0, Math.min(h - 1, Math.round(cy + Math.sin(a) * rr)))
    ring.push(L(x, y))
  }
  let maxAngularJump = 0
  for (let k = 0; k < N; k++) maxAngularJump = Math.max(maxAngularJump, Math.abs(ring[(k + 1) % N]! - ring[k]!))
  return {
    mean,
    rowVar: varOf(rowMean),  // high => gradient runs vertically (varies row-to-row)
    colVar: varOf(colMean),  // high => gradient runs horizontally (varies col-to-col)
    left: edge(0, 3, 0, h), right: edge(w - 3, w, 0, h),
    top: edge(0, w, 0, 3), bottom: edge(0, w, h - 3, h),
    axisMinima: minima,
    cycles: upCross,
    maxAngularJump,
  }
}

async function sailorLayoutProbe(opts: {
  size?: number
  layout: string
  ramp?: Record<string, unknown>
  color?: Record<string, unknown>
  stops?: { color: string; pos: number }[]
}) {
  const size = opts.size ?? 96
  const cfg = ensureConfigDefaults(defaultConfig(HARNESS_SEED) as GradientConfig)
  cfg.canvas.layout = opts.layout as GradientConfig['canvas']['layout']
  const L0: any = cfg.layers[0]
  if (opts.stops) L0.color.stops = opts.stops
  if (opts.color) Object.assign(L0.color, opts.color)
  L0.ramp = { ...(L0.ramp ?? {}), ...(opts.ramp ?? {}) }
  const out = renderer.render(ensureConfigDefaults(cfg), size, size, 0)
  return gradientStats(out, size, size)
}

// Visual grid: render the three new layouts + the three authored presets to
// on-page canvases so a reviewer can eyeball them. Verification-only.
async function sailorVisualGrid() {
  const { buildGradientPreset } = await import('~/lib/gradientfx/presets')
  const S = 200
  const items: { label: string; cfg: GradientConfig }[] = []
  const bw = [{ color: '#5b8def', pos: 0 }, { color: '#ef6ba0', pos: 1 }]
  const mk = (layout: string, ramp: Record<string, unknown>) => {
    const c = ensureConfigDefaults(defaultConfig(HARNESS_SEED) as GradientConfig)
    c.canvas.layout = layout as GradientConfig['canvas']['layout']
    ;(c.layers[0] as any).color.stops = bw
    ;(c.layers[0] as any).ramp = { ...(c.layers[0] as any).ramp, ...ramp }
    return ensureConfigDefaults(c)
  }
  items.push({ label: 'Linear (ramp) 45°', cfg: mk('ramp', { angle: 45 }) })
  items.push({ label: 'Radial (radialRamp)', cfg: mk('radialRamp', { radius: 1, shape: 'circle' }) })
  items.push({ label: 'Conic closeLoop', cfg: mk('conic', { sweep: 360, closeLoop: true }) })
  for (const name of ['dawn', 'halo', 'spectrum']) {
    const cfg = buildGradientPreset(name, HARNESS_SEED)
    if (cfg) items.push({ label: `preset: ${name}`, cfg })
  }
  const host = document.getElementById('visual-grid') || (() => {
    const d = document.createElement('div'); d.id = 'visual-grid'
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-wrap:wrap;align-content:flex-start;gap:8px;padding:12px;background:#111;overflow:auto'
    document.body.appendChild(d); return d
  })()
  host.innerHTML = ''
  for (const it of items) {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'color:#ddd;font:11px monospace;text-align:center'
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S
    cv.getContext('2d')!.drawImage(renderer.render(it.cfg, S, S, 0) as CanvasImageSource, 0, 0)
    wrap.appendChild(cv)
    const lbl = document.createElement('div'); lbl.textContent = it.label; wrap.appendChild(lbl)
    host.appendChild(wrap)
  }
  return items.map(i => i.label)
}

if (import.meta.client) {
  ;(window as any).__sailorPostProbe = sailorPostProbe
  ;(window as any).__sailorPostOrientationProbe = sailorPostOrientationProbe
  ;(window as any).__sailorGrainCoverageProbe = sailorGrainCoverageProbe
  ;(window as any).__sailorLayoutProbe = sailorLayoutProbe
  ;(window as any).__sailorVisualGrid = sailorVisualGrid
}
</script>
