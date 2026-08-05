import { test, expect } from '@playwright/test'

declare global {
  interface Window {
    __sailorPostAlphaProbe: (opts: { effects: string[] }) => Promise<{
      transparentMaxAlpha: number
      transparentMaxLuma: number
      opaqueMinAlpha: number
    }>
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
