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
import { DEFAULT_POST } from '~/lib/studio/post/settings'
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
 */
async function sailorPostProbe(opts: { effect: string; size: number }): Promise<{ meanAbsDiff: number; corr: number }> {
  const { effect, size } = opts
  const def = POST_EFFECTS.find(e => e.id === effect)
  if (!def) throw new Error(`gradient harness: unknown post effect "${effect}"`)

  const base = ensureConfigDefaults(defaultConfig(HARNESS_SEED) as GradientConfig)

  const offCfg = cloneConfig(base)
  offCfg.post = { ...DEFAULT_POST }
  const offLuma = luma(renderer.render(offCfg, size, size, 0), size, size)

  const onCfg = cloneConfig(base)
  onCfg.post = { ...DEFAULT_POST, [def.enableKey]: true } as typeof DEFAULT_POST
  const onLuma = luma(renderer.render(onCfg, size, size, 0), size, size)

  const n = offLuma.length
  let sumAbs = 0
  for (let i = 0; i < n; i++) sumAbs += Math.abs(onLuma[i]! - offLuma[i]!)
  const meanAbsDiff = sumAbs / n / 255

  let sumA = 0, sumB = 0
  for (let i = 0; i < n; i++) { sumA += offLuma[i]!; sumB += onLuma[i]! }
  const meanA = sumA / n, meanB = sumB / n
  let cov = 0, varA = 0, varB = 0
  for (let i = 0; i < n; i++) {
    const da = offLuma[i]! - meanA
    const db = onLuma[i]! - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  const corr = cov / (Math.sqrt(varA * varB) || 1)

  return { meanAbsDiff, corr }
}

if (import.meta.client) {
  ;(window as any).__sailorPostProbe = sailorPostProbe
}
</script>
