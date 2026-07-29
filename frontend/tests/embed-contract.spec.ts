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

  // Regression for the frozen-motion bug: composePasses was fed the raw config,
  // so a keyframed track (e.g. an adjust.* param) never moved — invisible in
  // manual testing because generative effects keep animating via u_time
  // regardless. This isolates a motion track from any generative-effect
  // animation: the base effect layer has id: '' (composePasses skips it, so no
  // effect layer contributes to the pixels — see passes.ts:44's `if (!layer.id)
  // continue`), leaving `adjust.brightness` as the ONLY thing that can move the
  // output between t01=0 and t01=1. If the adapter ever again composes from the
  // raw (un-motion-applied) config, this must fail — brightness would stay at
  // its base value (0) at both times and the two snapshots would be identical.
  test('a keyframed motion track actually animates the render', async ({ page }) => {
    const [p0, p1] = await page.evaluate(async () => {
      const H = (window as any).__embedHarness
      const cfg = JSON.parse(JSON.stringify(H.config.cfg))
      cfg.effects = [{ layerId: 'L0', id: '', params: {}, enabled: true, blend: 'normal', opacity: 1 }]
      cfg.adjust = { enabled: true, exposure: 0, brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, tint: 0 }
      cfg.motion = {
        duration: 4, fps: 30,
        tracks: [{ path: 'adjust.brightness', from: -0.9, to: 0.9, easing: 'linear', loops: 1, delay: 0, hold: 0, cycleOffset: 0 }],
      }
      const embedConfig = { cfg, defs: [], duration: 30, baseDataUrl: null }
      const h = await H.mountConfig('a', embedConfig)
      h.setTime(0.0)
      const a = H.snapshot('a')
      h.setTime(1.0)
      const b = H.snapshot('a')
      return [a, b]
    })
    expect(p0).not.toBe(p1)
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

  // Regression for the leaked-WebGL-context bug: destroy() must release the
  // context (and its programs/FBOs), not just remove the canvas. Browsers cap
  // live WebGL contexts per page (Chrome logs a warning and force-loses the
  // *oldest* context past the cap, which means a naive "does the last mount
  // still work" assertion can't tell a leak apart from a fix — Chrome's own
  // recovery papers over it either way. The real signal is whether the
  // "Too many active WebGL contexts" warning fires at all: it should never
  // fire if destroy() is actually releasing contexts as it goes. 20
  // iterations comfortably exceeds Chrome's ~16-context cap if nothing is
  // released.
  test('repeated mount/destroy releases WebGL contexts (no browser context-eviction warning)', async ({ page }) => {
    const contextWarnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('Too many active WebGL contexts')) {
        contextWarnings.push(msg.text())
      }
    })

    const result = await page.evaluate(async () => {
      const H = (window as any).__embedHarness
      let prev: any = null
      for (let i = 0; i < 20; i++) {
        if (prev) prev.destroy()
        const h = await H.mount('a')
        if (!h) return { ok: false, error: `mount ${i} returned null` }
        h.setTime(0.25)
        prev = h
      }
      // Deliberately leave the last mount alive — asserting on it below is the
      // "still produces a working canvas" sanity check.
      const c = document.querySelector('#slot-a canvas') as HTMLCanvasElement | null
      const snapshot = H.snapshot('a')
      return {
        ok: true,
        canvasCount: document.querySelectorAll('#slot-a canvas').length,
        width: c?.width ?? 0,
        height: c?.height ?? 0,
        snapshotLength: snapshot.length,
      }
    })
    expect(result.ok).toBe(true)
    expect(result.canvasCount).toBe(1)
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
    expect(result.snapshotLength).toBeGreaterThan(0)
    // The teeth: without dispose(), Chrome logs this warning by iteration ~17.
    expect(contextWarnings).toEqual([])
  })
})
