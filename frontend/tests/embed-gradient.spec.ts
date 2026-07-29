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
