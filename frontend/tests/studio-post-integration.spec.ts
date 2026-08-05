import { test, expect } from '@playwright/test'
import { POST_EFFECTS } from '../app/lib/studio/post/manifest'
import type { PostSettings } from '../app/lib/studio/post/settings'

declare global {
  interface Window {
    __sailorPostAlphaProbe: (opts: { effects: string[] }) => Promise<{
      transparentMaxAlpha: number
      transparentMaxLuma: number
      opaqueMinAlpha: number
    }>
    __sailorPostGrainGateProbe: () => Promise<{
      opaqueDev: number
      halfDev: number
      transparentDev: number
    }>
    __sailorPostChangesPixels: (effectId: string) => Promise<boolean>
  }
}

test('post preserves alpha and keeps grain off transparent pixels', async ({ page }) => {
  await page.goto('/dev/shaderfx-harness')
  await page.waitForFunction(() => typeof (window as any).__sailorPostAlphaProbe === 'function')
  const r = await page.evaluate(async () => {
    // A frame that is opaque on the left half, fully transparent on the right.
    return await window.__sailorPostAlphaProbe({ effects: ['grain', 'bloom', 'vignette'] })
  })
  // Transparent stays transparent — no pass may fill the background in.
  expect(r.transparentMaxAlpha).toBe(0)
  // And nothing was painted there either, so a matte export stays clean.
  expect(r.transparentMaxLuma).toBe(0)
  // The opaque half is untouched in alpha.
  expect(r.opaqueMinAlpha).toBe(255)
})

// Finding 5 (Task 4 fix pass): the alpha probe above draws through a 2D
// canvas, whose premultiplied backing store destroys RGB once alpha hits 0 —
// so `transparentMaxLuma` there proves nothing about the grain gate that
// `transparentMaxAlpha` doesn't already prove on its own. This test instead
// reads straight pixels off the WebGL canvas via gl.readPixels and checks the
// gate's actual job: grain amplitude (measured as each band's OWN local
// pixel-to-pixel stddev, not deviation from an assumed baseline — see the
// harness probe's comment for why) scaling with alpha, including the partial
// (antialiased-edge) case a hard 0/1 check can't see.
test('grain amplitude scales with the pixel\'s own alpha, not just on/off', async ({ page }) => {
  await page.goto('/dev/shaderfx-harness')
  await page.waitForFunction(() => typeof (window as any).__sailorPostGrainGateProbe === 'function')
  const r = await page.evaluate(async () => window.__sailorPostGrainGateProbe())
  // Opaque band: full-strength grain, clearly visible as noise.
  expect(r.opaqueDev).toBeGreaterThan(2)
  // Half-alpha band: grain scaled down, but not to zero.
  expect(r.halfDev).toBeGreaterThan(1)
  expect(r.halfDev).toBeLessThan(r.opaqueDev)
  // Roughly half the opaque amplitude (loose bound — hash noise, not exact).
  expect(r.halfDev).toBeGreaterThan(r.opaqueDev * 0.25)
  expect(r.halfDev).toBeLessThan(r.opaqueDev * 0.75)
  // Fully transparent band: no grain noise at all, regardless of what the
  // (premultiply-destroyed) base colour there happens to be.
  expect(r.transparentDev).toBeLessThan(1)
})

// Critical 1 regression guard: an effect with no Sailor-mapped params (glitch
// has `params: []`) must still render the catalog's own look, not sit at
// GL's implicit 0 for every uniform chain.ts doesn't set.
test('glitch (no Sailor-mapped params) is not a no-op', async ({ page }) => {
  await page.goto('/dev/shaderfx-harness')
  await page.waitForFunction(() => typeof (window as any).__sailorPostChangesPixels === 'function')
  const changed = await page.evaluate(() => window.__sailorPostChangesPixels('glitch'))
  expect(changed).toBe(true)
})

// Task 5: Gradient Studio adopts the shared post stack (the FIRST real host —
// Tasks 6/7 repeat this same per-studio probe for Texture/Shape). Two assertions,
// because either alone can be fooled:
//   1. post ON differs from post OFF   → proves the stage actually ran
//   2. output still correlates with input → proves it did not flatten the frame
// The risograph bug (2026-08-04) passed a parity gate at 0.01/255 while rendering
// a flat wash with the image gone. Assertion 2 is what would have caught it.
//
// Coverage fix (review of Task 5): the above proved the STAGE works, but only
// ever drove it with `bloom`. rgb_glitch shipped as a complete no-op in the
// immediately preceding task — every uniform sat at 0 — and nothing here could
// have seen it, because nothing compared a specific effect's own output to its
// own input. This block now runs the same probe over every non-3D effect in
// POST_EFFECTS (gtao is withheld — it needs depth/normal buffers no 2D harness
// has), derived from the manifest rather than hardcoded so a twelfth effect is
// covered automatically.
declare global {
  interface Window {
    __sailorPostProbe: (opts: { effect: string; size: number; overrides?: Partial<PostSettings> }) => Promise<{ meanAbsDiff: number; corr: number }>
    __sailorPostOrientationProbe: (opts: { size: number }) => Promise<{ offTop: number; offBottom: number; onTop: number; onBottom: number }>
  }
}

const GRADIENT_PROBE_SIZES = [128, 512]

// Color's DEFAULT_POST values (exposure/contrast/saturation = 1, hue = 0) are
// the identity transform, so enabling it alone is a legitimate no-op — this
// override supplies a non-default exposure so the probe actually exercises
// the shader. No other effect in POST_EFFECTS needed one: every other
// default is already non-neutral (see the per-effect table in
// .superpowers/sdd/usp-task-5-report.md's "Coverage fix" section).
const GRADIENT_PROBE_OVERRIDES: Partial<Record<string, Partial<PostSettings>>> = {
  color: { exposure: 1.6 },
}

for (const def of POST_EFFECTS.filter(e => !e.threeDOnly)) {
  test(`gradient post stage runs and preserves structure: ${def.id}`, async ({ page }) => {
    await page.goto('/dev/gradient-harness')
    await page.waitForFunction(() => typeof (window as any).__sailorPostProbe === 'function')
    for (const size of GRADIENT_PROBE_SIZES) {
      const r = await page.evaluate(
        async ({ effect, s, overrides }) => await window.__sailorPostProbe({ effect, size: s, overrides }),
        { effect: def.id, s: size, overrides: GRADIENT_PROBE_OVERRIDES[def.id] },
      )
      expect(r.meanAbsDiff, `${def.id} @ ${size}px: meanAbsDiff`).toBeGreaterThan(1 / 255)  // it ran
      expect(r.corr, `${def.id} @ ${size}px: corr`).toBeGreaterThan(0.5)                     // it did not wash out
    }
  })
}

// Reviewer note on Task 5: the corr assertion above compares post-on against
// post-off, but a frame that's vertically FLIPPED yet still correlated (e.g. a
// y-flip bug in blitBack()'s UNPACK_FLIP_Y_WEBGL upload) would slip through —
// correlation doesn't care which end is up. defaultConfig()'s gradient is
// deliberately vertically asymmetric (bottom→top pink→magenta→near-black→
// orange), so this instead compares the top quarter's mean luma against the
// bottom quarter's, for post OFF and post ON, and asserts the relationship
// (which side is brighter) is the SAME in both. A flip inverts it.
for (const size of GRADIENT_PROBE_SIZES) {
  test(`gradient post stage preserves vertical orientation: ${size}px`, async ({ page }) => {
    await page.goto('/dev/gradient-harness')
    await page.waitForFunction(() => typeof (window as any).__sailorPostOrientationProbe === 'function')
    const r = await page.evaluate(async (s) => await window.__sailorPostOrientationProbe({ size: s }), size)
    const offDelta = r.offBottom - r.offTop
    const onDelta = r.onBottom - r.onTop
    // The source gradient is asymmetric enough that this isn't a coin flip.
    expect(Math.abs(offDelta)).toBeGreaterThan(5)
    expect(Math.abs(onDelta)).toBeGreaterThan(5)
    // Same sign = same side is brighter in both frames = no flip.
    expect(Math.sign(onDelta)).toBe(Math.sign(offDelta))
  })
}

// Task 6: Texture Studio adopts the shared post stack — same seam as Task 5,
// same two-probe shape, against /dev/texture-harness instead. See that page's
// own comments for why Texture's orientation probe needs a hand-built
// asymmetric cell-gradient config rather than reusing any built-in motif:
// every built-in pattern is designed to TILE seamlessly, which makes a
// periodic-window mean invariant to phase and useless for detecting a flip.
const TEXTURE_PROBE_SIZES = [128, 512]

// Same reasoning as Gradient's override: Color's DEFAULT_POST values
// (exposure/contrast/saturation = 1, hue = 0) are the identity transform.
const TEXTURE_PROBE_OVERRIDES: Partial<Record<string, Partial<PostSettings>>> = {
  color: { exposure: 1.6 },
}

for (const def of POST_EFFECTS.filter(e => !e.threeDOnly)) {
  test(`texture post stage runs and preserves structure: ${def.id}`, async ({ page }) => {
    await page.goto('/dev/texture-harness')
    await page.waitForFunction(() => typeof (window as any).__sailorPostProbe === 'function')
    for (const size of TEXTURE_PROBE_SIZES) {
      const r = await page.evaluate(
        async ({ effect, s, overrides }) => await window.__sailorPostProbe({ effect, size: s, overrides }),
        { effect: def.id, s: size, overrides: TEXTURE_PROBE_OVERRIDES[def.id] },
      )
      expect(r.meanAbsDiff, `${def.id} @ ${size}px: meanAbsDiff`).toBeGreaterThan(1 / 255)  // it ran
      expect(r.corr, `${def.id} @ ${size}px: corr`).toBeGreaterThan(0.5)                     // it did not wash out
    }
  })
}

for (const size of TEXTURE_PROBE_SIZES) {
  test(`texture post stage preserves vertical orientation: ${size}px`, async ({ page }) => {
    await page.goto('/dev/texture-harness')
    await page.waitForFunction(() => typeof (window as any).__sailorPostOrientationProbe === 'function')
    const r = await page.evaluate(async (s) => await window.__sailorPostOrientationProbe({ size: s }), size)
    const offDelta = r.offBottom - r.offTop
    const onDelta = r.onBottom - r.onTop
    // The hand-built cell-gradient config is asymmetric enough that this isn't a coin flip.
    expect(Math.abs(offDelta)).toBeGreaterThan(5)
    expect(Math.abs(onDelta)).toBeGreaterThan(5)
    // Same sign = same side is brighter in both frames = no flip.
    expect(Math.sign(onDelta)).toBe(Math.sign(offDelta))
  })
}

// Task 7: Shape Studio adopts the shared post stack — same seam as Task 5/6, same
// two-probe shape, against /dev/shape-harness instead. Shape renders through
// three.js (see lib/shapefx/engine.ts's ensureBlit/blitPostResult), so the
// harness's own render path is a throwaway ShapeEngine per call rather than a
// persistent renderer singleton — see shape-harness.vue's own comments.
const SHAPE_PROBE_SIZES = [128, 512]

// Same reasoning as Gradient/Texture's override: Color's DEFAULT_POST values
// (exposure/contrast/saturation = 1, hue = 0) are the identity transform.
const SHAPE_PROBE_OVERRIDES: Partial<Record<string, Partial<PostSettings>>> = {
  color: { exposure: 1.6 },
}

for (const def of POST_EFFECTS.filter(e => !e.threeDOnly)) {
  test(`shape post stage runs and preserves structure: ${def.id}`, async ({ page }) => {
    await page.goto('/dev/shape-harness')
    await page.waitForFunction(() => typeof (window as any).__sailorPostProbe === 'function')
    for (const size of SHAPE_PROBE_SIZES) {
      const r = await page.evaluate(
        async ({ effect, s, overrides }) => await window.__sailorPostProbe({ effect, size: s, overrides }),
        { effect: def.id, s: size, overrides: SHAPE_PROBE_OVERRIDES[def.id] },
      )
      expect(r.meanAbsDiff, `${def.id} @ ${size}px: meanAbsDiff`).toBeGreaterThan(1 / 255)  // it ran
      expect(r.corr, `${def.id} @ ${size}px: corr`).toBeGreaterThan(0.5)                     // it did not wash out
    }
  })
}

for (const size of SHAPE_PROBE_SIZES) {
  test(`shape post stage preserves vertical orientation: ${size}px`, async ({ page }) => {
    await page.goto('/dev/shape-harness')
    await page.waitForFunction(() => typeof (window as any).__sailorPostOrientationProbe === 'function')
    const r = await page.evaluate(async (s) => await window.__sailorPostOrientationProbe({ size: s }), size)
    const offDelta = r.offBottom - r.offTop
    const onDelta = r.onBottom - r.onTop
    // The smooth+vertical base config is asymmetric enough that this isn't a coin flip.
    expect(Math.abs(offDelta)).toBeGreaterThan(5)
    expect(Math.abs(onDelta)).toBeGreaterThan(5)
    // Same sign = same side is brighter in both frames = no flip.
    expect(Math.sign(onDelta)).toBe(Math.sign(offDelta))
  })
}
