import { test, expect } from '@playwright/test'

// End-to-end: build an embed on the harness page, then load the produced HTML
// in a blank page and confirm the LIVE renderer runs — not the poster.
test.describe('embed export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessReady === true)
  })

  test('produces self-contained html with no external references', async ({ page }) => {
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtml())
    expect(html).toContain('<!doctype html>')

    // Use the bundler's own detector, NOT a naive regex. A real export inlines a
    // base64 poster, and base64 contains "//" constantly — a pattern that treats
    // a bare "//" as an external reference fails on every genuine export.
    const { externalRefs } = await import('../app/lib/embed/bundle')
    expect(externalRefs(html)).toEqual([])
  })

  test('the exported file renders live, not just its poster', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtml())

    const embed = await context.newPage()
    await embed.setContent(html)
    await embed.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })

    // The poster must be hidden — if it is still showing, the live path failed
    // and a graceful fallback is masking it.
    expect(await embed.locator('#sailor-poster').isHidden()).toBe(true)

    // And it must actually animate.
    const first = await embed.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    await embed.waitForTimeout(600)
    const later = await embed.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    expect(first).not.toBe(later)
  })
})
