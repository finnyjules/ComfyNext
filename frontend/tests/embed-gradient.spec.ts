import { test, expect } from '@playwright/test'

// NOTE: this file currently covers ONE scenario only — the gradient embed
// adapter's loop-duration reconciliation (see ~/lib/embed/surfaces/gradient.ts
// and ~/lib/gradientfx/motion.ts's motionConfigFor). A later task adding full
// gradient embed E2E coverage (mirroring embed-contract/embed-export/
// embed-parity for shader) should EXTEND this file, not overwrite it.

const T = 0.37 // arbitrary non-zero, non-half normalized position

// cfg.motion.duration ("D1") is what the studio itself treats as this
// config's clock (frameSource.ts always derives duration from this field —
// see gradientfx/frameSource.ts:44). The embed export is told a DIFFERENT
// duration ("D2") — simulating the exact divergence the finding describes:
// nothing today enforces embed.duration === cfg.motion.duration.
const D1 = 4
const D2 = 6

function buildCfg() {
  return {
    seed: 'embed-gradient-task2',
    canvas: { aspect: '16:9', layout: 'linear', margin: 0, innerRadius: 0.4, background: '#000000', center: { x: 0, y: 0 } },
    relief: { grain: 0, relief: 0, light: { azimuth: 135, elevation: 45 } },
    flow: {
      angle: 45, noiseScale: 3.5, intensity: 0, distortion: 50, detail: 2,
      depth: 60, highlights: 50, shadows: 55, foldScale: 60, speed: 0, gloss: 0,
      veins: 0, veinScale: 35, ripple: 0, refract: 0, viscosity: 0, swirl: 0,
    },
    layers: [
      {
        blend: 'normal', opacity: 1,
        shape: {
          type: 'bands', count: 20, minDepth: 0, curveExp: 1, jitter: 0, peaks: 3,
          phase: 0, detail: 4, sweep: 360, scrub: 0, gap: 0, rounding: 0,
          direction: 'up', mirror: 'none', valley: 0.5,
        },
        color: {
          stops: [
            { color: '#f9d9f0', pos: 0 }, { color: '#c026d3', pos: 0.4 },
            { color: '#0e0a1e', pos: 0.64 }, { color: '#f0a35a', pos: 1 },
          ],
          gradientDir: 'vertical', mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0,
        },
      },
    ],
    // One visually obvious track (relief.grain 0 -> 1), delay: 0 so its value
    // depends only on t/duration — the ratio a correct reconciliation preserves
    // regardless of which absolute duration is in play (see trackValue in
    // ~/lib/studio/track.ts).
    motion: {
      tracks: [{ path: 'relief.grain', from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }],
      duration: D1, fps: 30, size: 1080,
    },
    locks: {},
  }
}

test.describe('gradient embed loop-duration reconciliation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessGradientReady === true)
  })

  // The fix: the adapter must reconcile embed.duration into cfg.motion.duration
  // before rendering, so its output at t01 matches what the studio itself would
  // show at that same normalized loop position — no matter what `duration` the
  // export was told to use.
  test('adapter output at t01 matches the studio path, even when embed.duration diverges from cfg.motion.duration', async ({ page }) => {
    const cfg = buildCfg()

    const studio = await page.evaluate(([c, t]: [any, number]) =>
      (window as any).__embedHarnessGradient.studioRef(c, t), [cfg, T])

    const adapter = await page.evaluate(async ([c, t, dur]: [any, number, number]) => {
      const H = (window as any).__embedHarnessGradient
      const h = await H.mountConfig('g', { cfg: c, duration: dur })
      h.setSize(512, 512)
      h.setTime(t)
      const png = H.snapshot('g')
      h.destroy()
      return png
    }, [cfg, T, D2])

    expect(adapter).toBe(studio)
  })

  // The gate on the gate: prove D1 and D2 actually diverge for this fixture, so
  // the test above has teeth. This renders the SAME config the studio would
  // (duration left at D1) but at the time the OLD, unreconciled adapter would
  // have fed the renderer (t01 * D2) — i.e. exactly what draw() computed before
  // the fix, since render() would still have divided by cfg.motion.duration (D1).
  // If this ever stops differing from the studio reference, D1/D2/T no longer
  // exercise the bug and the fixture needs new values.
  test('the fixture genuinely exercises a duration mismatch (unreconciled time differs from the studio path)', async ({ page }) => {
    const cfg = buildCfg()

    const studio = await page.evaluate(([c, t]: [any, number]) =>
      (window as any).__embedHarnessGradient.studioRef(c, t), [cfg, T])

    // Same cfg (motion.duration still D1), but rendered at t01 normalized
    // against D2 instead of D1 — the pre-fix adapter's behavior.
    const unreconciled = await page.evaluate(([c, t, dur]: [any, number, number]) =>
      (window as any).__embedHarnessGradient.studioRef(c, (t * dur) / (c.motion.duration || 4)), [cfg, T, D2])

    expect(unreconciled).not.toBe(studio)
  })
})

// --- Full contract + parity coverage (mirrors embed-contract.spec.ts /
// embed-parity.spec.ts / embed-export.spec.ts for shader). The two scenarios
// above already cover "adapter matches the studio path at t01" and (via the
// unreconciled-vs-studio comparison) "setTime genuinely changes pixels" for
// this fixture class, so they are not repeated here.
//
// This block drives the default __embedHarnessGradient.config fixture — built
// from gradientfx/randomize.ts's own defaultConfig(), the same builder
// GradientStudioNode seeds a fresh node from — plus a motion track
// (relief.grain 0->1) so time genuinely matters on every render.
test.describe('EmbedSurface contract — gradient', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessGradientReady === true)
  })

  test('mounts and puts a canvas in the container', async ({ page }) => {
    const n = await page.evaluate(async () => {
      const h = await (window as any).__embedHarnessGradient.mount('g')
      return h ? document.querySelectorAll('#slot-g canvas').length : -1
    })
    expect(n).toBe(1)
  })

  test('setTime changes the rendered pixels', async ({ page }) => {
    const [p0, p1] = await page.evaluate(async () => {
      const H = (window as any).__embedHarnessGradient
      const h = await H.mount('g')
      h.setTime(0.0)
      const a = H.snapshot('g')
      h.setTime(0.5)
      const b = H.snapshot('g')
      return [a, b]
    })
    expect(p0).not.toBe(p1)
  })

  test('setSize resizes the canvas', async ({ page }) => {
    const dims = await page.evaluate(async () => {
      const h = await (window as any).__embedHarnessGradient.mount('g')
      h.setSize(320, 200)
      h.setTime(0.25)
      const c = document.querySelector('#slot-g canvas') as HTMLCanvasElement
      return [c.width, c.height]
    })
    expect(dims).toEqual([320, 200])
  })

  test('destroy removes the canvas', async ({ page }) => {
    const after = await page.evaluate(async () => {
      const h = await (window as any).__embedHarnessGradient.mount('g')
      h.destroy()
      return document.querySelectorAll('#slot-g canvas').length
    })
    expect(after).toBe(0)
  })

  // The test that justifies Task 1 (GradientFxRenderer becoming instantiable
  // rather than staying a globalThis-cached singleton): two embeds on one page
  // must not share a GL context or renderer state.
  test('two instances on one page render independently', async ({ page }) => {
    const { aAt0, aAt0Again, bAt5 } = await page.evaluate(async () => {
      const H = (window as any).__embedHarnessGradient
      const ha = await H.mount('g')
      const hb = await H.mount('g2')
      ha.setTime(0.0)
      const aAt0 = H.snapshot('g')
      hb.setTime(0.5)
      const bAt5 = H.snapshot('g2')
      const aAt0Again = H.snapshot('g')
      return { aAt0, aAt0Again, bAt5 }
    })
    expect(aAt0).toBe(aAt0Again)   // b's render must not have disturbed a
    expect(aAt0).not.toBe(bAt5)
  })

  // Regression for the leaked-WebGL-context bug, mirrored from
  // embed-contract.spec.ts's shader version. Chrome silently force-evicts the
  // OLDEST context past its ~16 cap rather than refusing new ones, so "the
  // last mount still works" cannot tell a leak apart from a fix — the real
  // signal is whether the eviction warning fires at all. Task 2 added
  // GradientFxRenderer.dispose(); this proves the gradient adapter's destroy()
  // actually calls it on every cycle, not just the last one.
  test('repeated mount/destroy releases WebGL contexts (no browser context-eviction warning)', async ({ page }) => {
    const contextWarnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('Too many active WebGL contexts')) {
        contextWarnings.push(msg.text())
      }
    })

    const result = await page.evaluate(async () => {
      const H = (window as any).__embedHarnessGradient
      let prev: any = null
      for (let i = 0; i < 20; i++) {
        if (prev) prev.destroy()
        const h = await H.mount('g')
        if (!h) return { ok: false, error: `mount ${i} returned null` }
        h.setTime(0.25)
        prev = h
      }
      const c = document.querySelector('#slot-g canvas') as HTMLCanvasElement | null
      const snapshot = H.snapshot('g')
      return {
        ok: true,
        canvasCount: document.querySelectorAll('#slot-g canvas').length,
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
    expect(contextWarnings).toEqual([])
  })
})

test.describe('embed export — gradient', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessGradientReady === true)
  })

  // Mirrors embed-export.spec.ts's shader coverage. Gradient carries no source
  // image and no EffectDefs, so its export should be far smaller than shader's
  // ~47 KB — but it must still be fully self-contained.
  test('produces self-contained html with no external references and a plausible size', async ({ page }) => {
    const html = await page.evaluate(() => (window as any).__embedHarnessGradient.exportHtml())
    expect(html).toContain('<!doctype html>')

    // Use the bundler's own detector, NOT a naive regex — the inlined base64
    // poster contains "//" constantly, and a naive pattern would fail on
    // every genuine export.
    const { externalRefs } = await import('../app/lib/embed/bundle')
    expect(externalRefs(html)).toEqual([])

    const kb = new Blob([html]).size / 1024
    expect(kb).toBeGreaterThan(1)
    expect(kb).toBeLessThan(500)
  })

  // The exported file must run the LIVE renderer, not just show its poster —
  // every export carries a poster fallback, and a dead render path still
  // LOOKS fine if only the poster is ever checked.
  test('the exported file renders live, not just its poster', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarnessGradient.exportHtml())

    const embed = await context.newPage()
    await embed.setContent(html)
    await embed.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })

    expect(await embed.locator('#sailor-poster').isHidden()).toBe(true)

    // And it must actually animate, given the fixture's motion track.
    const first = await embed.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    await embed.waitForTimeout(600)
    const later = await embed.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    expect(first).not.toBe(later)
    await embed.close()
  })
})

test.describe('embed parity with the studio — gradient', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessGradientReady === true)
  })

  // The gate on the gates. If this passes, a parity check would accept a
  // broken render. Perturbs the first layer's first color stop — the ramp LUT
  // this feeds pixels directly, so it changes output regardless of which
  // flow/motion params happen to be active (unlike e.g. flow.intensity, which
  // is a no-op while flow.speed is 0 in this fixture).
  test('the parity check fails when the config is deliberately corrupted', async ({ page, context }) => {
    const before = await page.evaluate(async (t: number) => {
      const H = (window as any).__embedHarnessGradient
      const h = await H.mount('g')
      h.setSize(512, 512)
      h.setTime(t)
      const png = H.snapshot('g')
      h.destroy()
      return png
    }, T)

    await page.evaluate(() => (window as any).__embedHarnessGradient.corrupt())

    const html = await page.evaluate(() => (window as any).__embedHarnessGradient.exportHtml())
    await context.addInitScript((t: number) => { (window as any).__SAILOR_FREEZE_T01__ = t }, T)
    const embed = await context.newPage()
    await embed.setViewportSize({ width: 512, height: 512 })
    await embed.setContent(html)
    await embed.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })
    expect(await embed.locator('#sailor-poster').isHidden()).toBe(true)
    const after = await embed.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    await embed.close()

    expect(after).not.toBe(before)
  })
})
