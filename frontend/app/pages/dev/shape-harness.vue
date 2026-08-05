<template>
  <div style="padding: 8px; font: 12px monospace">shape harness ready</div>
</template>

<script setup lang="ts">
// Headless probe for Shape Studio's post-stage adoption (Task 7). Mirrors
// /dev/gradient-harness's shape (Task 5) and /dev/texture-harness's (Task 6): a
// near-blank page whose script exposes window functions a Playwright test
// drives (see tests/studio-post-integration.spec.ts).
//
// Unlike Gradient/Texture (each own a persistent renderer singleton with an
// internal canvas), ShapeEngine is constructed against a caller-supplied
// <canvas> — see ShapeStudioNode.vue's bakeOutput for the same "fresh canvas +
// new ShapeEngine + setConfig + render(orbit)" one-shot pattern this probe
// reuses per render (a THREE.WebGLRenderer per call is the throwaway-engine
// posture every other Shape one-shot render already follows, not a new one
// invented for this harness).
import { ShapeEngine } from '~/lib/shapefx/engine'
import { DEFAULT_CONFIG, mergeConfig, type ShapeConfig } from '~/lib/shapefx/config'
import { DEFAULT_POST, type PostSettings } from '~/lib/studio/post/settings'
import { POST_EFFECTS } from '~/lib/studio/post/manifest'

// Same camera the studio surface/node default to (ShapeStudioNode.vue's
// DEFAULT_ORBIT) — a 3/4 view so every facet of the default cube actually
// shows, rather than the flat face-on look yaw=pitch=0 would give.
const ORBIT = { yaw: 0.6, pitch: 0.32, zoom: 1 }

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

// Reads the luma channel BEFORE disposing the throwaway engine — engine.dispose()
// releases three's GL objects (programs/buffers/textures), and while the canvas's
// own drawing buffer (preserveDrawingBuffer: true) isn't explicitly cleared by
// dispose(), extracting the pixels first removes any doubt rather than relying on
// that not mattering.
function renderLuma(cfg: ShapeConfig, size: number): Float64Array {
  const canvas = document.createElement('canvas')
  const engine = new ShapeEngine(canvas, size, size)
  try {
    engine.setConfig(cfg)
    engine.render(ORBIT)
    return luma(engine.renderer.domElement, size, size)
  } finally {
    engine.dispose()
  }
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

// Base shape for the on/off probe: the default cube, forced to `smooth` coloring
// along the `vertical` direction so the ramp sweeps deterministically bottom→top
// — the same "make it asymmetric on purpose" move Gradient/Texture's own
// harnesses make (see texture-harness.vue's comment on why a tiling default
// pattern is useless for this), rather than relying on `prismatic`'s per-facet
// randomized spread, which is structured but not a clean top/bottom gradient.
//
// scale bumped from the default (1) to 2.6 — the ORTHO_HALF_H frustum in
// engine.ts is 2.6 and the cube geometry is a 2-unit box, so at scale=1 the
// shape only fills ~38% of the frame's vertical extent, leaving most of the
// canvas as FLAT style.background (default solid black). A first pass at this
// harness with the default scale measured both `chroma` (edge-only fringing,
// diluted by mostly-flat area) and the orientation probe's own top/bottom
// split (diluted the same way, since a small centred shape barely reaches the
// image's outer quarters at all) below their thresholds — not because either
// was broken, but because the base content under-exercised them. Filling most
// of the frame with the shape is the fix, not loosening either assertion.
function baseConfig(): ShapeConfig {
  return mergeConfig({
    ...structuredClone(DEFAULT_CONFIG),
    shape: { ...DEFAULT_CONFIG.shape, scale: 2.6 },
    palette: { ...DEFAULT_CONFIG.palette, coloring: 'smooth', direction: 'vertical' },
  })
}

// film's crt_scanlines.frag barrel-warps + scanlines the frame — Shape's own
// content (a single smooth-shaded solid, no periodic high-frequency pattern
// like Texture's checkerboard) doesn't have the same decorrelation risk Task 6
// hit, so no BASE_OVERRIDES hatch is needed here; verified below by running the
// probe and checking film's own corr/meanAbsDiff rather than assuming it.
//
// blur/chroma (Task 8 review — mirrors texture-harness.vue's own BASE_OVERRIDES
// pattern, added for the identical reason): DEFAULT_CONFIG's style.grain used to
// unconditionally bake grain noise into every Shape render (including this
// probe's baseline) via ./post.ts's own pass. Task 8 moved grain's actual pixels
// into the shared stack, applied only when post.grain is explicitly on — this
// probe's off/on configs both reset `post` to a fresh DEFAULT_POST (below), so
// grain is off in both, and the smooth-coloured baseline lost the incidental
// high-frequency texture that made a subtle blur/chromatic-fringe visibly
// register. `scatter` coloring (random discrete swatch per facet — the low-poly
// confetti look) restores comparable per-pixel contrast for these two effects
// specifically, without changing what every OTHER effect's test renders.
const BASE_OVERRIDES: Partial<Record<string, Record<string, unknown>>> = {
  // 'gem' mode's scattered-point hull carries far more facets than any primitive
  // (up to 40 vertices' worth of hull faces — a cube is fixed at 6, and `density`
  // doesn't subdivide one further), giving `scatter` coloring's per-facet swatches
  // enough granularity to make blur/chromatic fringing register above the "it
  // ran" threshold at both probe sizes.
  blur: { palette: { coloring: 'scatter' }, shape: { mode: 'gem', vertices: 40, depth: 1, spread: 0.8 } },
  chroma: { palette: { coloring: 'scatter' }, shape: { mode: 'gem', vertices: 40, depth: 1, spread: 0.8 } },
}

/**
 * Renders the base shape at `size` with `effect` OFF, then again with it ON
 * (every other post effect stays off), and reports two numbers over the luma
 * channel — see gradient-harness.vue's identical function for the full
 * rationale (meanAbsDiff: did it run; corr: did it wash out the frame).
 */
async function sailorPostProbe(opts: { effect: string; size: number; overrides?: Partial<PostSettings> }): Promise<{ meanAbsDiff: number; corr: number }> {
  const { effect, size, overrides } = opts
  const def = POST_EFFECTS.find(e => e.id === effect)
  if (!def) throw new Error(`shape harness: unknown post effect "${effect}"`)

  const base = baseConfig()
  const baseOverride = BASE_OVERRIDES[effect]
  if (baseOverride?.palette) Object.assign(base.palette, baseOverride.palette as Partial<ShapeConfig['palette']>)
  if (baseOverride?.shape) Object.assign(base.shape, baseOverride.shape as Partial<ShapeConfig['shape']>)

  const offCfg: ShapeConfig = { ...base, post: { ...DEFAULT_POST } }
  const offLuma = renderLuma(offCfg, size)

  const onCfg: ShapeConfig = { ...base, post: { ...DEFAULT_POST, [def.enableKey]: true, ...overrides } as PostSettings }
  const onLuma = renderLuma(onCfg, size)

  return correlate(offLuma, onLuma)
}

/**
 * Orientation guard (mirrors Task 5/6's own review-round addition) — see
 * gradient-harness.vue's identical function for the full rationale. The
 * `smooth`+`vertical` base config above is deliberately asymmetric top-to-
 * bottom for exactly this check.
 */
async function sailorPostOrientationProbe(opts: { size: number }): Promise<{ offTop: number; offBottom: number; onTop: number; onBottom: number }> {
  const { size } = opts
  const base = baseConfig()

  const offCfg: ShapeConfig = { ...base, post: { ...DEFAULT_POST } }
  const offLuma = renderLuma(offCfg, size)

  const onCfg: ShapeConfig = { ...base, post: { ...DEFAULT_POST, bloom: true } }
  const onLuma = renderLuma(onCfg, size)

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

if (import.meta.client) {
  ;(window as any).__sailorPostProbe = sailorPostProbe
  ;(window as any).__sailorPostOrientationProbe = sailorPostOrientationProbe
}
</script>
