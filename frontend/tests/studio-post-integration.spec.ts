import { test, expect } from '@playwright/test'

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
declare global {
  interface Window {
    __sailorPostProbe: (opts: { effect: string; size: number }) => Promise<{ meanAbsDiff: number; corr: number }>
  }
}

const GRADIENT_PROBE_SIZES = [128, 512]

test('gradient post stage runs and preserves structure', async ({ page }) => {
  await page.goto('/dev/gradient-harness')
  await page.waitForFunction(() => typeof (window as any).__sailorPostProbe === 'function')
  for (const size of GRADIENT_PROBE_SIZES) {
    const r = await page.evaluate(async (s) => await window.__sailorPostProbe({ effect: 'bloom', size: s }), size)
    expect(r.meanAbsDiff).toBeGreaterThan(1 / 255)      // it ran
    expect(r.corr).toBeGreaterThan(0.5)                  // it did not wash out
  }
})
