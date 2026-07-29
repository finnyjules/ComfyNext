import { test, expect } from '@playwright/test'

const T = 0.37   // arbitrary non-zero, non-half position — a t both sides must agree on

async function studioFrame(page: any): Promise<string> {
  return await page.evaluate(async (t: number) => {
    const H = (window as any).__embedHarness
    const h = await H.mount('a')
    h.setSize(512, 512)
    h.setTime(t)
    const png = H.snapshot('a')
    h.destroy()
    return png
  }, T)
}

async function embedFrame(context: any, html: string): Promise<string> {
  // Runs before any page script, so the runtime sees the flag at startup and
  // renders exactly this frame instead of starting its clock. No debug global
  // is shipped in the export itself.
  //
  // Must be context.addInitScript, not page.addInitScript: Playwright only
  // replays page-level init scripts on real navigations, and page.setContent()
  // (used below to load the exported HTML as a standalone document) does not
  // count as one — a page.addInitScript here silently never runs, and
  // window.__SAILOR_FREEZE_T01__ reads back `undefined` inside the exported
  // runtime. Registering it on the context instead injects it for every
  // document the context's pages load, setContent() included. Confirmed via a
  // minimal repro against Playwright 1.60 (this repo's pinned version) —
  // do not revert to page.addInitScript to "simplify" this.
  await context.addInitScript((t: number) => { (window as any).__SAILOR_FREEZE_T01__ = t }, T)
  const p = await context.newPage()
  // The exported runtime sizes its canvas from #sailor-embed's box, which is
  // CSS 100vw/100vh — i.e. the page viewport, not the 512x512 studioFrame
  // explicitly requests via setSize. Without pinning this to match, the two
  // canvases come out different dimensions and toDataURL diverges on size
  // alone before a single pixel is compared. This project's default viewport
  // (playwright.config.ts) is 1600x1000, not 512x512, so it must be set here.
  await p.setViewportSize({ width: 512, height: 512 })
  await p.setContent(html)
  await p.waitForFunction(() => {
    const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
    return !!c && c.width > 1
  }, undefined, { timeout: 15_000 })

  // Assert the LIVE path ran. Without this, an export that silently fell back to
  // its poster would sail through the diff and look like a pass.
  expect(await p.locator('#sailor-poster').isHidden()).toBe(true)

  const png = await p.evaluate(() =>
    (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
  await p.close()
  return png
}

test.describe('embed parity with the studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessReady === true)
  })

  // Layer 1 — the adapter must match the STUDIO render path, not just itself.
  // This is the test that catches drift between composePasses-via-adapter and
  // composePasses-via-studio.
  test('adapter matches the studio path at the same t01', async ({ page }) => {
    const studio = await page.evaluate((t: number) =>
      (window as any).__embedHarness.studioRef(t), T)
    const adapter = await studioFrame(page)
    expect(adapter).toBe(studio)
  })

  // Layer 2 — the exported file must match the adapter. This is what the
  // bundling and serialization path can break.
  test('exported file matches the adapter at the same t01', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtml())
    const adapter = await studioFrame(page)
    const exported = await embedFrame(context, html)
    expect(exported).toBe(adapter)
  })

  // Layer 3 — the gate on the gates. If this passes, the two tests above prove
  // nothing, because the comparison would accept a broken render.
  test('the parity check fails when the config is deliberately broken', async ({ page, context }) => {
    const before = await studioFrame(page)
    await page.evaluate(() => (window as any).__embedHarness.corrupt())
    const html = await page.evaluate(() => (window as any).__embedHarness.exportHtml())
    const after = await embedFrame(context, html)
    expect(after).not.toBe(before)
  })
})
