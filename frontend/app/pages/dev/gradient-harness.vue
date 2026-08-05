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

if (import.meta.client) {
  ;(window as any).__sailorPostProbe = sailorPostProbe
  ;(window as any).__sailorPostOrientationProbe = sailorPostOrientationProbe
}
</script>
