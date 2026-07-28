import { test, expect } from '@playwright/test'

// Contract conformance for embed adapters, exercised on /dev/embed-harness.
// Requires a dev server: PW_BASE_URL=http://127.0.0.1:3002 npx playwright test tests/embed-contract.spec.ts --project=chromium

test.describe('EmbedSurface contract — shader', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessReady === true)
  })

  test('mounts and puts a canvas in the container', async ({ page }) => {
    const n = await page.evaluate(async () => {
      const h = await (window as any).__embedHarness.mount('a')
      return h ? document.querySelectorAll('#slot-a canvas').length : -1
    })
    expect(n).toBe(1)
  })

  test('setTime changes the rendered pixels', async ({ page }) => {
    const [p0, p1] = await page.evaluate(async () => {
      const H = (window as any).__embedHarness
      const h = await H.mount('a')
      h.setTime(0.0)
      const a = H.snapshot('a')
      h.setTime(0.5)
      const b = H.snapshot('a')
      return [a, b]
    })
    expect(p0).not.toBe(p1)
  })

  test('setSize resizes the canvas', async ({ page }) => {
    const dims = await page.evaluate(async () => {
      const h = await (window as any).__embedHarness.mount('a')
      h.setSize(320, 200)
      h.setTime(0.25)
      const c = document.querySelector('#slot-a canvas') as HTMLCanvasElement
      return [c.width, c.height]
    })
    expect(dims).toEqual([320, 200])
  })

  test('destroy removes the canvas', async ({ page }) => {
    const after = await page.evaluate(async () => {
      const h = await (window as any).__embedHarness.mount('a')
      h.destroy()
      return document.querySelectorAll('#slot-a canvas').length
    })
    expect(after).toBe(0)
  })

  // The test that catches shared-state bugs. Two embeds on one page is the
  // real-world case (two pieces on one slide) and the reason ShaderFxRenderer
  // had to become instantiable.
  test('two instances on one page render independently', async ({ page }) => {
    const { aAt0, aAt0Again, bAt5 } = await page.evaluate(async () => {
      const H = (window as any).__embedHarness
      const ha = await H.mount('a')
      const hb = await H.mount('b')
      ha.setTime(0.0)
      const aAt0 = H.snapshot('a')
      hb.setTime(0.5)
      const bAt5 = H.snapshot('b')
      const aAt0Again = H.snapshot('a')
      return { aAt0, aAt0Again, bAt5 }
    })
    expect(aAt0).toBe(aAt0Again)   // b's render must not have disturbed a
    expect(aAt0).not.toBe(bAt5)
  })
})
