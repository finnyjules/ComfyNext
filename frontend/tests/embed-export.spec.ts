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

  // I6 regression. Ten embeds on one page is ten live WebGL contexts; past
  // Chrome's ~16 cap the browser force-loses the oldest, and the page used to
  // freeze on a stale frame with the poster already hidden. The runtime must
  // notice and put the still frame back — silently, in someone else's page.
  test('a lost WebGL context falls back to the poster without console noise', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtml())

    const embed = await context.newPage()
    const noise: string[] = []
    embed.on('console', m => { if (m.type() === 'error') noise.push(m.text()) })
    await embed.setContent(html)
    await embed.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })
    expect(await embed.locator('#sailor-poster').isHidden()).toBe(true)

    await embed.evaluate(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement
      c.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    })

    await expect(embed.locator('#sailor-poster')).toBeVisible()
    // And the loop must be stopped, not merely hidden behind the poster.
    const stopped = await embed.evaluate(async () => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement
      const a = c.toDataURL()
      await new Promise(r => setTimeout(r, 400))
      return c.toDataURL() === a
    })
    expect(stopped).toBe(true)
    expect(noise).toEqual([])
  })

  // C1 regression. The renderers draw a fullscreen triangle with no aspect
  // correction, and the runtime used to hand them #sailor-embed's raw
  // 100vw x 100vh box — so a 1536x1536 piece opened in a 1512x760 window
  // snapped to a 2:1 squash the instant the poster hid. snapshot.width/height
  // were carried but only ever used as a fallback for a clientWidth that is
  // never 0, i.e. vestigial.
  //
  // Deliberately NOT a square export in a square viewport (that is what the
  // parity spec pins, and it cannot see this bug): 512x256 exported, loaded in
  // an 800x800 window. Distortion and correctness disagree by 2x here.
  test('keeps the exported aspect ratio in a differently-shaped window', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtmlAt(512, 256))

    const embed = await context.newPage()
    await embed.setViewportSize({ width: 800, height: 800 })
    await embed.setContent(html)
    await embed.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })

    // The live path must be what we are measuring, not the poster.
    expect(await embed.locator('#sailor-poster').isHidden()).toBe(true)

    const box = await embed.evaluate(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement
      const r = c.getBoundingClientRect()
      return { w: r.width, h: r.height, bw: c.width, bh: c.height }
    })

    // Rendered (CSS) box keeps 2:1 — letterboxed, not stretched to 800x800.
    expect(box.w / box.h).toBeCloseTo(512 / 256, 2)
    // Contain, so the piece is as wide as the window and short of its height:
    // real letterbox bars above and below.
    expect(box.w).toBeCloseTo(800, 0)
    expect(box.h).toBeLessThan(800 * 0.75)
    // I1: backing store is sized in device pixels, capped at 2x.
    const dpr = await embed.evaluate(() => Math.min(2, window.devicePixelRatio || 1))
    expect(box.bw).toBeCloseTo(box.w * dpr, 0)
    expect(box.bh).toBeCloseTo(box.h * dpr, 0)
    // And the backing store itself keeps the ratio — a stretched render can
    // have a correct CSS box while drawing the wrong pixels.
    expect(box.bw / box.bh).toBeCloseTo(512 / 256, 2)
  })
})
