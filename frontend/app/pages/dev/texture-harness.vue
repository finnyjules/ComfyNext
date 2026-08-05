<template>
  <div style="padding: 8px; font: 12px monospace">texture harness ready</div>
</template>

<script setup lang="ts">
// Headless probe for Texture Studio's post-stage adoption (Task 6). Mirrors
// /dev/gradient-harness's shape (Task 5) and /dev/shaderfx-harness's: a
// near-blank page whose script exposes window functions a Playwright test
// drives (see tests/studio-post-integration.spec.ts).
import { createTextureFx } from '~/lib/texturefx/renderer'
import { textureDefaults } from '~/lib/texturefx/controls'
import { cloneParams } from '~/lib/texturefx/types'
import type { Params } from '~/lib/spacetype/effect'
import type { PostSettings } from '~/lib/studio/post/settings'
import { POST_EFFECTS } from '~/lib/studio/post/manifest'

// Own instance rather than the app-wide `textureFx` singleton — this page never
// shares a tab with a real studio, but a private context keeps the probe fully
// self-contained regardless (same posture as createTextureFx()'s other caller,
// patternfill.ts's sub-renderer).
const renderer = createTextureFx()

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

// Fixed base params for the on/off probe: default checker (colorA #e8eef5 /
// colorB #7aa2f7, cells=8) gives real structure and colour contrast without
// depending on any post-adoption-specific fill setup — its sharp edges are
// exactly what blur/chroma need to register a visible diff.
function baseParams(): Params {
  return { ...textureDefaults() }
}

// film's CRT barrel warp + scanlines (crt_scanlines.frag's u_curvature/
// u_vignette, both non-zero catalog defaults Sailor's Film control never
// exposes) decorrelates badly against the sharp checkerboard above — checked
// visually: the checkerboard stays fully recognisable under film, just
// warped and scanlined, not washed out (meanAbsDiff ~0.3 either way) — but a
// per-pixel Pearson corr is extremely sensitive to a few pixels of geometric
// shift on high-contrast PERIODIC content, unlike a smooth continuous ramp
// (Gradient Studio's default content already has this shape, which is why
// its own film case needed no override). This gives film specifically a
// smooth, high-CONTRAST (not low-contrast — low-contrast dropped corr
// further, since the fixed-magnitude scanline/vignette noise then dominates
// the signal's own variance) diagonal ramp: both checker roles share the
// SAME tile-frame (canvas-global, not cell-local) gradient via a `link`
// fill, so the checkerboard's cell edges disappear entirely and the whole
// canvas is one smooth black→white ramp.
const BASE_OVERRIDES: Record<string, Record<string, unknown>> = {
  film: {
    fills: {
      a: { type: 'gradient', frame: 'tile', kind: 'linear', angle: 35, stops: [{ c: '#000000', p: 0 }, { c: '#ffffff', p: 1 }] },
      b: { type: 'link', to: 'a' },
    },
  },
}

/**
 * Renders the base texture at `size` with `effect` OFF, then again with it
 * ON (every other post effect stays off), and reports two numbers over the
 * luma channel:
 *  - meanAbsDiff: mean per-pixel |on - off|, normalized to 0..1 — near 0 means
 *    the post stage didn't run (a no-op chain, or applyPost never called).
 *  - corr: Pearson correlation of the two luma arrays — near 0 means the ON
 *    frame no longer resembles the OFF frame at all (e.g. a broken effect that
 *    flattens the whole frame to a wash). A diff-only check can't see this —
 *    see tests/studio-post-integration.spec.ts's header comment (Task 5's
 *    risograph bug).
 *
 * `overrides` merges onto the ON params' post.* keys (on top of the enable
 * flag), for effects whose DEFAULT_POST values are neutral/no-op at rest —
 * e.g. Color's exposure/contrast/saturation all default to 1 and hue to 0,
 * the identity transform, so enabling it alone changes nothing. Some effects
 * also swap the BASE content via BASE_OVERRIDES above (film — see its comment).
 */
async function sailorPostProbe(opts: { effect: string; size: number; overrides?: Partial<PostSettings> }): Promise<{ meanAbsDiff: number; corr: number }> {
  const { effect, size, overrides } = opts
  const def = POST_EFFECTS.find(e => e.id === effect)
  if (!def) throw new Error(`texture harness: unknown post effect "${effect}"`)

  const base = { ...baseParams(), ...(BASE_OVERRIDES[effect] ?? {}) } as Params

  const offP = cloneParams(base)
  const offLuma = luma(renderer.render(offP, size, size, 0), size, size)

  const onP = cloneParams(base)
  ;(onP as Record<string, unknown>)[`post.${def.enableKey}`] = true
  for (const [k, v] of Object.entries(overrides ?? {})) (onP as Record<string, unknown>)[`post.${k}`] = v
  const onLuma = luma(renderer.render(onP, size, size, 0), size, size)

  return correlate(offLuma, onLuma)
}

/**
 * Orientation guard (mirrors Task 5's review-round addition): the
 * meanAbsDiff/corr pair above compares post-on against post-off, but a
 * VERTICALLY FLIPPED-yet-correlated frame (e.g. a y-flip bug in
 * blitBack()'s UNPACK_FLIP_Y_WEBGL upload) would pass both.
 *
 * Texture's own patterns are all designed to TILE seamlessly, which for any
 * periodic content makes the mean over a window spanning a whole number of
 * periods invariant to the window's phase — i.e. a checkerboard or any other
 * built-in motif is naturally close to top/bottom-symmetric and useless for
 * detecting a flip. To get a genuine, deterministic top-vs-bottom asymmetry
 * this instead assigns role 'a' (checker's F0) a CELL-frame linear gradient
 * (angle 90 = vertical), which is a plain, non-mirrored ramp local to each
 * cell (see fills.ts's gradientRampCoord — 'cell' frame is NOT the mirrored
 * ramp 'tile' frame uses for seamlessness), while role 'b' (F1) stays a flat
 * solid grey. At the renderer's minimum cells=2, the two rows' own F0 cells
 * each ramp black→white across their own half of the canvas, and F1 fills
 * the other diagonal half solid — asymmetric enough that the top quarter
 * (which sits inside the row-1 F0 cell's upper half, trending toward white)
 * and the bottom quarter (inside the row-0 F0 cell's lower half, trending
 * toward black) differ by roughly 60 luma units, deterministically, at any
 * canvas size (the ramp lives in UV fractions, not pixels).
 */
async function sailorPostOrientationProbe(opts: { size: number }): Promise<{ offTop: number; offBottom: number; onTop: number; onBottom: number }> {
  const { size } = opts
  // `fills` (like the rest of the codebase's ad-hoc params.fills usage — see
  // TextureStudioSurface.vue's `(params as any).fills`) isn't a ParamValue, so
  // this stays a plain Record rather than Params until it's handed to render().
  const asymmetric: Record<string, unknown> = {
    ...textureDefaults(),
    mode: 'procedural',
    motif: 'checker',
    cells: 2,
    jitter: 0,
    fills: {
      a: { type: 'gradient', frame: 'cell', kind: 'linear', angle: 90, stops: [{ c: '#000000', p: 0 }, { c: '#ffffff', p: 1 }] },
      b: { type: 'solid', color: '#808080' },
    },
  }

  const offP = cloneParams(asymmetric)
  const offLuma = luma(renderer.render(offP as Params, size, size, 0), size, size)

  const onP = cloneParams(asymmetric)
  onP['post.bloom'] = true
  const onLuma = luma(renderer.render(onP as Params, size, size, 0), size, size)

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
