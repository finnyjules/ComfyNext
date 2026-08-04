import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

// This project is ESM (no __dirname global) — derive it from import.meta.url instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Space Type is the third embeddable surface and the first with two genuinely new
// properties: it draws TEXT (a missing font falls back to sans-serif silently, never
// with an error) and it is the first surface where caps.alpha is actually true (Shader
// and Gradient both measured opaque). This file follows the conventions established by
// embed-parity.spec.ts (the Layer 1/2/3 adapter-vs-studio-vs-exported structure) and
// embed-gradient.spec.ts (the "EmbedSurface contract" + "embed export" sections, plus
// corrupting the harness's live config in place for the Layer 3 gate-on-the-gate).
//
// One thing neither of those precedents had to deal with: Shader/Gradient render to a
// 2D canvas (bit-exact, deterministic). Space Type is WebGL, and two SEPARATE WebGL
// contexts rendering the identical scene measurably do NOT always produce byte-identical
// output — confirmed with a throwaway repro before writing this file: two fresh engines,
// same config, same t01, differ by up to ~0.86 (of 1.0) on a handful of antialiased edge
// pixels, though usually (~7/8 runs) exactly zero. This is a real, if small, property of
// comparing renders across GL context instances, not a product bug — the SAME engine
// re-rendering the same t01 twice IS byte-identical every time. Layer 1/2 below (which
// compare TWO SEPARATE engines/contexts — adapter vs. studioRef, and adapter vs. the
// exported bundle in its own page) therefore use a tolerant pixel comparison, mirroring
// the pattern already established in this repo for WebGL golden-image tests
// (tests/shaderfx-golden.spec.ts's diffStats/PCT_THRESHOLD/MAX_MEAN/MAX_PCT_OVER), NOT
// exact string equality. Thresholds below are calibrated with real headroom over the
// measured noise floor (~0.002 mean, <1% of channel-samples over 8/255) while still
// catching a genuine corruption (opts.bgColor flip corruption below measures ~0.35 mean,
// ~98% over-threshold — two orders of magnitude clear of the noise floor).
const PCT_THRESHOLD = 8 / 255
const MAX_MEAN = 0.01
const MAX_PCT_OVER = 0.03

function diffStats(a: PNG, b: PNG): { max: number; mean: number; pctOver: number } {
  if (a.width !== b.width || a.height !== b.height) return { max: 1, mean: 1, pctOver: 1 }
  let max = 0, sum = 0, over = 0, n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c]! - b.data[i + c]!) / 255
      if (d > max) max = d
      if (d > PCT_THRESHOLD) over++
      sum += d
      n++
    }
  }
  return { max, mean: sum / n, pctOver: over / n }
}

function pngOf(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'))
}

/** Same scene, rendered on two separate WebGL contexts: expected to be near-identical,
 *  not necessarily byte-identical (see the module doc above). */
function expectNearEqual(aDataUrl: string, bDataUrl: string): void {
  const stats = diffStats(pngOf(aDataUrl), pngOf(bDataUrl))
  expect(stats.mean, `mean pixel diff ${stats.mean} exceeds ${MAX_MEAN}`).toBeLessThan(MAX_MEAN)
  expect(stats.pctOver, `fraction of channel-samples over ${PCT_THRESHOLD} is ${stats.pctOver}, exceeds ${MAX_PCT_OVER}`).toBeLessThan(MAX_PCT_OVER)
}

const T = 0.37 // arbitrary non-zero, non-half normalized position

// Two REAL, visually distinct font files already checked into public/fonts/ — used
// (never fetched over the network; read straight off disk into a data: URI) so the
// font test below proves the exported page renders in the ACTUAL embedded typeface,
// not merely "some @font-face was present". See "THE FONT TEST" section below.
const FONT_A_PATH = path.resolve(__dirname, '../public/fonts/ABCROM-Bold.otf')
const FONT_B_PATH = path.resolve(__dirname, '../public/fonts/NeueMontreal/PPNeueMontreal-Black.otf')
function fontDataUrl(p: string): string {
  return `data:font/otf;base64,${fs.readFileSync(p).toString('base64')}`
}
// A fictitious family name: guaranteed not to be a real system/browser font, so
// document.fonts.check() can only return true when OUR @font-face actually registered it.
const TEST_FAMILY = 'Sailor Embed Test Font'

async function adapterFrame(page: any, t: number): Promise<string> {
  return await page.evaluate(async (tt: number) => {
    const H = (window as any).__embedHarnessSpaceType
    const h = await H.mount('st')
    h.setSize(512, 512)
    h.setTime(tt)
    const png = H.snapshot('st')
    h.destroy()
    return png
  }, t)
}

// context.addInitScript, not page.addInitScript — Playwright does not replay
// page-level init scripts across page.setContent() (see the identical note in
// embed-parity.spec.ts / embed-gradient.spec.ts). An explicit 512x512 viewport is
// required too: the exported runtime sizes its canvas from #sailor-embed's box,
// which is CSS 100vw/100vh — the project's default viewport (1600x1000) would
// diverge from the 512x512 the adapter frame above requests via setSize.
async function embedFrame(context: any, html: string, t = T): Promise<string> {
  await context.addInitScript((tt: number) => { (window as any).__SAILOR_FREEZE_T01__ = tt }, t)
  const p = await context.newPage()
  await p.setViewportSize({ width: 512, height: 512 })
  await p.setContent(html)
  await p.waitForFunction(() => {
    const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
    return !!c && c.width > 1
  }, undefined, { timeout: 15_000 })
  // Assert the LIVE path ran, not the poster fallback.
  expect(await p.locator('#sailor-poster').isHidden()).toBe(true)
  const png = await p.evaluate(() =>
    (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
  await p.close()
  return png
}

test.describe('EmbedSurface contract — spacetype', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessSpaceTypeReady === true)
  })

  test('mounts and puts a canvas in the container', async ({ page }) => {
    const n = await page.evaluate(async () => {
      const h = await (window as any).__embedHarnessSpaceType.mount('st')
      return h ? document.querySelectorAll('#slot-st canvas').length : -1
    })
    expect(n).toBe(1)
  })

  test('setTime changes the rendered pixels', async ({ page }) => {
    const [p0, p1] = await page.evaluate(async () => {
      const H = (window as any).__embedHarnessSpaceType
      const h = await H.mount('st')
      h.setTime(0.0)
      const a = H.snapshot('st')
      h.setTime(0.5)
      const b = H.snapshot('st')
      return [a, b]
    })
    expect(p0).not.toBe(p1)
  })

  test('setSize resizes the canvas', async ({ page }) => {
    const dims = await page.evaluate(async () => {
      const h = await (window as any).__embedHarnessSpaceType.mount('st')
      h.setSize(320, 200)
      h.setTime(0.25)
      const c = document.querySelector('#slot-st canvas') as HTMLCanvasElement
      return [c.width, c.height]
    })
    expect(dims).toEqual([320, 200])
  })

  test('destroy removes the canvas', async ({ page }) => {
    const after = await page.evaluate(async () => {
      const h = await (window as any).__embedHarnessSpaceType.mount('st')
      h.destroy()
      return document.querySelectorAll('#slot-st canvas').length
    })
    expect(after).toBe(0)
  })

  // Per-effect state lives on root.userData (engine.ts's build()), not a module-level
  // variable — this is what makes two concurrent Space Type engines safe. This test is
  // what justifies that design.
  test('two instances on one page render independently', async ({ page }) => {
    const { aAt0, aAt0Again, bAt5 } = await page.evaluate(async () => {
      const H = (window as any).__embedHarnessSpaceType
      const ha = await H.mount('st')
      const hb = await H.mount('st2')
      ha.setTime(0.0)
      const aAt0 = H.snapshot('st')
      hb.setTime(0.5)
      const bAt5 = H.snapshot('st2')
      const aAt0Again = H.snapshot('st')
      return { aAt0, aAt0Again, bAt5 }
    })
    expect(aAt0).toBe(aAt0Again)   // b's render must not have disturbed a
    expect(aAt0).not.toBe(bAt5)
  })

  // Regression for the leaked-WebGL-context bug (mirrored from embed-contract.spec.ts /
  // embed-gradient.spec.ts). Chrome silently force-evicts the OLDEST context past its
  // ~16 cap rather than refusing new ones, so "the last mount still works" cannot tell a
  // leak apart from a fix — the real signal is whether the eviction warning fires at all.
  // This proves the spacetype adapter's destroy() calls engine.dispose() (which force-loses
  // the WebGL context — see engine.ts's doc) on every cycle, not just the last one.
  test('repeated mount/destroy releases WebGL contexts (no browser context-eviction warning)', async ({ page }) => {
    const contextWarnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('Too many active WebGL contexts')) {
        contextWarnings.push(msg.text())
      }
    })

    const result = await page.evaluate(async () => {
      const H = (window as any).__embedHarnessSpaceType
      let prev: any = null
      for (let i = 0; i < 20; i++) {
        if (prev) prev.destroy()
        const h = await H.mount('st')
        if (!h) return { ok: false, error: `mount ${i} returned null` }
        h.setTime(0.25)
        prev = h
      }
      const c = document.querySelector('#slot-st canvas') as HTMLCanvasElement | null
      const snapshot = H.snapshot('st')
      return {
        ok: true,
        canvasCount: document.querySelectorAll('#slot-st canvas').length,
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

test.describe('embed parity with the studio — spacetype', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessSpaceTypeReady === true)
  })

  // Layer 1 — the adapter must match the STUDIO render path (a fresh SpaceTypeEngine
  // driven by texOptsFromState, the same shared builder SpaceTypeSurface.vue itself
  // calls) — not just itself. This is the test that would catch buildTexOpts drifting
  // from texOptsFromState, exactly the "looks plausible, is wrong" failure this file's
  // module doc (and spacetype.ts's own) warns about. Near-equal, not exact — see the
  // module doc's note on cross-WebGL-context comparison.
  test('adapter matches the studio path at the same t01', async ({ page }) => {
    const studio = await page.evaluate((t: number) => {
      const H = (window as any).__embedHarnessSpaceType
      return H.studioRef(H.config, t)
    }, T)
    const adapter = await adapterFrame(page, T)
    expectNearEqual(adapter, studio)
  })

  // Layer 2 — the exported file must match the adapter. This is what the bundling and
  // serialization path can break (a config field lost, a wrong snapshot dimension, a
  // bundle falling back to another path) — none of which Layer 1 or Layer 3 alone catch.
  test('exported file matches the adapter at the same t01', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarnessSpaceType.exportHtml())
    const adapter = await adapterFrame(page, T)
    const exported = await embedFrame(context, html, T)
    expectNearEqual(exported, adapter)
  })

  // Layer 3 — the gate on the gates. If this passes, the two tests above prove nothing,
  // because the comparison would accept a broken render. Flips opts.bgColor, which fills
  // essentially the whole frame regardless of effect/params (calibrated at ~0.35 mean /
  // ~98% of channel-samples over threshold — two orders of magnitude past both the
  // cross-context noise floor AND the MAX_MEAN/MAX_PCT_OVER tolerance above), so exact
  // inequality is trivially safe here — no tolerance needed for "these must differ".
  test('the parity check fails when the config is deliberately corrupted', async ({ page, context }) => {
    const before = await adapterFrame(page, T)
    await page.evaluate(() => (window as any).__embedHarnessSpaceType.corrupt())
    const html = await page.evaluate(() => (window as any).__embedHarnessSpaceType.exportHtml())
    const after = await embedFrame(context, html, T)
    expect(after).not.toBe(before)
  })
})

test.describe('embed export — spacetype', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessSpaceTypeReady === true)
  })

  // Unlike shader (~47 KB) and gradient (well under 500 KB), Space Type's bundle carries
  // three.js plus the ONE effect this export uses (the harness fixture is 'ribbon' — see
  // spaceTypeConfig above) inlined verbatim as the adapter <script>. Per-effect bundles
  // measure ~793KB-806KB (boost.js is the sole outlier at ~1.64MB — see
  // embed-build-output.unit.spec.ts's ceiling comment), plus a small poster/HTML shell —
  // a real export of this fixture measures ~840KB today. This band replaces one calibrated
  // for the old spacetype.js monolith (all 25 effects, ~1.85MB) that this task's per-effect
  // bundle split retired — that band would reject every real per-effect export now. The
  // floor still catches a bundle silently regressing toward near-empty; the ceiling still
  // catches a per-effect build somehow pulling all 25 effects back in (which would blow well
  // past it, as the old monolith band's numbers show).
  test('produces self-contained html with no external references and a plausible size', async ({ page }) => {
    const html = await page.evaluate(() => (window as any).__embedHarnessSpaceType.exportHtml())
    expect(html).toContain('<!doctype html>')

    // Use the bundler's own detector, NOT a naive regex — the inlined base64 poster/adapter
    // contain "//" constantly, and a naive pattern would fail on every genuine export.
    const { externalRefs } = await import('../app/lib/embed/bundle')
    expect(externalRefs(html)).toEqual([])

    const kb = new Blob([html]).size / 1024
    expect(kb).toBeGreaterThan(600)    // must be at least "the per-effect bundle alone", roughly
    expect(kb).toBeLessThan(1200)      // and not have ballooned back toward the old monolith
  })

  // The exported file must run the LIVE renderer, not just show its poster — every export
  // carries a poster fallback, and a dead render path still LOOKS fine if only the poster
  // is ever checked. Also asserts it actually animates, given ribbon's default speed 0.6.
  test('the exported file renders live, not just its poster', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarnessSpaceType.exportHtml())

    const embed = await context.newPage()
    await embed.setContent(html)
    await embed.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })

    expect(await embed.locator('#sailor-poster').isHidden()).toBe(true)

    const first = await embed.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    await embed.waitForTimeout(600)
    const later = await embed.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    expect(first).not.toBe(later)
    await embed.close()
  })
})

// Space Type is the FIRST surface where surface.caps.alpha is genuinely true (Shader and
// Gradient both measured opaque, so exportEmbedHtml's `transparent` option has never had a
// real effect until now — see exportWebEmbed's own comment in SpaceTypeSurface.vue). These
// tests exercise that plumbing directly: both the ENGINE's own alpha (opts.alpha, which
// governs whether the WebGL canvas produces transparent pixels at all) and the PAGE-level
// flag (exportEmbedHtml's `transparent`, which governs whether the exported document's own
// html/body background is painted transparent so a hosting page can show through it). A
// config could get either half right and still fail to genuinely composite — both are
// checked.
test.describe('transparent export — spacetype', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessSpaceTypeReady === true)
  })

  test('opts.alpha: true + transparent export paints the page background transparent, and the canvas carries real alpha', async ({ page, context }) => {
    const html = await page.evaluate(() => {
      const H = (window as any).__embedHarnessSpaceType
      const cfg = { ...H.config, opts: { ...H.config.opts, alpha: true, bgColor: '#0e0e10' } }
      return H.exportWith(cfg, 512, 512, true)
    })

    const embed = await context.newPage()
    await embed.setContent(html)
    await embed.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })

    // The page-level half: bundle.ts's `bg` var must be 'transparent', not the opaque
    // '#000' default — this is the exact wiring that was missing before exportWebEmbed
    // was made to pass `transparent: transparent.value` through to exportEmbedHtml.
    const bodyBg = await embed.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bodyBg).toBe('rgba(0, 0, 0, 0)')

    // The engine-level half: the canvas itself must contain genuinely transparent pixels
    // (ribbon's own background, outside the ribbon geometry, is empty) — not merely an
    // opaque render sitting on a transparent page.
    const hasAlpha = await embed.evaluate(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement
      const off = document.createElement('canvas')
      off.width = c.width; off.height = c.height
      const ctx = off.getContext('2d')!
      ctx.drawImage(c, 0, 0)
      const data = ctx.getImageData(0, 0, off.width, off.height).data
      for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true
      return false
    })
    expect(hasAlpha).toBe(true)
    await embed.close()
  })

  test('opts.alpha: false (or transparent not requested) keeps the page background opaque black', async ({ page, context }) => {
    const html = await page.evaluate(() => (window as any).__embedHarnessSpaceType.exportHtml())

    const embed = await context.newPage()
    await embed.setContent(html)
    await embed.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })

    const bodyBg = await embed.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bodyBg).toBe('rgb(0, 0, 0)')
    await embed.close()
  })
})

// THE FONT TEST — the one this task exists for. A missing font does not look broken:
// canvas falls back to sans-serif and the export renders confidently in the WRONG
// typeface. "Text appeared" is not evidence. Two real, visually distinct font files
// (already in public/fonts/, read from disk — never fetched over the network) are
// inlined under the SAME fictitious family name so a diff can only be explained by
// which actual font bytes were embedded, not by whether @font-face was present at all.
//
// Uses 'field' (a tiled text-grid effect — see buildConfig('field') in the harness),
// NOT the default 'ribbon' fixture used elsewhere in this file: ribbon's own drawn
// text covers only a few percent of a 512x512 frame (calibrated), too close to the
// cross-context noise floor described in this file's module doc to trust a pixel
// diff as evidence on its own. field's tiled text covers most of the frame, so a
// genuine font swap clears that noise floor by well over an order of magnitude
// (calibrated: ~0.05-0.09 mean vs ~0.002 noise) — exact inequality is trustworthy here.
test.describe('embed font inlining — spacetype', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/embed-harness')
    await page.waitForFunction(() => (window as any).__embedHarnessSpaceTypeReady === true)
  })

  async function fieldBaseConfig(page: any): Promise<any> {
    return await page.evaluate(() => (window as any).__embedHarnessSpaceType.buildConfig('field'))
  }

  async function exportAt(page: any, cfg: any): Promise<string> {
    return await page.evaluate((c: any) =>
      (window as any).__embedHarnessSpaceType.exportWith(c, 512, 512), cfg)
  }

  // Reads back whether a FontFace matching family+status:'loaded' actually landed in
  // document.fonts — NOT document.fonts.check(), which turned out (verified with a
  // throwaway repro before writing this) to return true for ANY family name, real or
  // entirely fictitious, on a totally blank page with no @font-face at all — it answers
  // "can SOMETHING render this text", not "does this exact face exist". Iterating the
  // FontFaceSet directly is the precise, correct query: a fresh page/context has no
  // entries until an @font-face rule actually registers one (confirmed: entries had
  // length 0 for a font:null export in the same repro).
  async function fontIsLoaded(page: any, family: string): Promise<boolean> {
    return await page.evaluate(
      (fam: string) => [...document.fonts].some((f: any) => f.family === fam && f.status === 'loaded'),
      family,
    )
  }

  async function waitForCanvas(p: any) {
    await p.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })
  }

  // The direct, decisive assertion (per the task brief's suggestion, once corrected to
  // the right API — see fontIsLoaded's doc above): the exported page actually has a
  // loaded FontFace for the family+weight the config named. mount() awaits
  // document.fonts.load()/document.fonts.ready before its first render (spacetype.ts),
  // so by the time the canvas exists this is already settled.
  test('the real font actually loaded in the exported page (document.fonts entries, not .check())', async ({ page, context }) => {
    const base = await fieldBaseConfig(page)
    const cfg = {
      ...base,
      font: { family: TEST_FAMILY, weight: 700, dataUrl: fontDataUrl(FONT_A_PATH) },
      params: { ...base.params, font: TEST_FAMILY },
    }
    const html = await exportAt(page, cfg)

    // Own context (not the shared `context` fixture reused elsewhere in this file):
    // confirmed via repro that reusing one context/renderer-process across multiple
    // font-bearing page loads can leak an EARLIER page's @font-face registration into
    // a LATER page's document.fonts, which would make this assertion pass even for a
    // page that never declared the face itself. A fresh context per export sidesteps it.
    const embedCtx = await context.browser()!.newContext()
    const embed = await embedCtx.newPage()
    await embed.setViewportSize({ width: 512, height: 512 })
    await embed.setContent(html)
    await waitForCanvas(embed)
    const loaded = await fontIsLoaded(embed, TEST_FAMILY)
    await embedCtx.close()
    expect(loaded).toBe(true)
  })

  // The negative control: with font: null, nothing ever declares an @font-face for
  // TEST_FAMILY (a fictitious name no real system/browser ships), so no matching entry
  // can exist in document.fonts — proving the positive result above isn't vacuous.
  test('document.fonts has no matching entry when font is null (no face was ever injected)', async ({ page, context }) => {
    const base = await fieldBaseConfig(page)
    const cfg = { ...base, font: null, params: { ...base.params, font: TEST_FAMILY } }
    const html = await exportAt(page, cfg)

    const embedCtx = await context.browser()!.newContext()
    const embed = await embedCtx.newPage()
    await embed.setViewportSize({ width: 512, height: 512 })
    await embed.setContent(html)
    await waitForCanvas(embed)
    const loaded = await fontIsLoaded(embed, TEST_FAMILY)
    await embedCtx.close()
    expect(loaded).toBe(false)
  })

  // The rendering evidence: the real font actually changes what gets drawn, not just
  // what document.fonts reports. font: null falls back to the canvas default
  // (sans-serif), which looks nothing like the embedded display face. Separate
  // contexts per export — see the font-cache-leak note above.
  test('the exported file renders in the real font — pixels differ from a font:null export of the same piece', async ({ page, context }) => {
    const base = await fieldBaseConfig(page)
    const withFont = {
      ...base,
      font: { family: TEST_FAMILY, weight: 700, dataUrl: fontDataUrl(FONT_A_PATH) },
      params: { ...base.params, font: TEST_FAMILY },
    }
    const withoutFont = { ...base, font: null, params: { ...base.params, font: TEST_FAMILY } }

    const htmlWith = await exportAt(page, withFont)
    const htmlWithout = await exportAt(page, withoutFont)
    const browser = context.browser()!
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const pngWith = await embedFrameIn(ctxA, htmlWith)
    const pngWithout = await embedFrameIn(ctxB, htmlWithout)
    await ctxA.close()
    await ctxB.close()
    expect(pngWith).not.toBe(pngWithout)
  })

  // The gate on the gate. If the pixel diff above passed merely because "a font was
  // present vs not", swapping in a DIFFERENT real font file under the exact same
  // declared family+weight must ALSO change the render — proving the comparison is
  // sensitive to which actual font bytes were inlined, not just whether @font-face
  // exists. (@font-face matching is driven by the CSS family name, never the font
  // file's own internal name table, so this genuinely tests the embedded bytes.)
  test('the check has teeth: a different embedded font file (same declared family) renders differently', async ({ page, context }) => {
    const base = await fieldBaseConfig(page)
    const fontA = {
      ...base,
      font: { family: TEST_FAMILY, weight: 700, dataUrl: fontDataUrl(FONT_A_PATH) },
      params: { ...base.params, font: TEST_FAMILY },
    }
    const fontB = {
      ...base,
      font: { family: TEST_FAMILY, weight: 700, dataUrl: fontDataUrl(FONT_B_PATH) },
      params: { ...base.params, font: TEST_FAMILY },
    }

    const htmlA = await exportAt(page, fontA)
    const htmlB = await exportAt(page, fontB)
    const browser = context.browser()!
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const pngA = await embedFrameIn(ctxA, htmlA)
    const pngB = await embedFrameIn(ctxB, htmlB)
    await ctxA.close()
    await ctxB.close()
    expect(pngA).not.toBe(pngB)
  })

  // Same shape as embedFrame() above, but takes an explicit context (rather than the
  // module-level default) and freezes at t01=0 — used by the font tests, which each
  // need their OWN isolated context (see the font-cache-leak note above), not the one
  // shared `context` fixture the rest of this file reuses across calls.
  async function embedFrameIn(ctx: any, html: string): Promise<string> {
    await ctx.addInitScript(() => { (window as any).__SAILOR_FREEZE_T01__ = 0 })
    const p = await ctx.newPage()
    await p.setViewportSize({ width: 512, height: 512 })
    await p.setContent(html)
    await p.waitForFunction(() => {
      const c = document.querySelector('#sailor-embed canvas') as HTMLCanvasElement | null
      return !!c && c.width > 1
    }, undefined, { timeout: 15_000 })
    expect(await p.locator('#sailor-poster').isHidden()).toBe(true)
    const png = await p.evaluate(() =>
      (document.querySelector('#sailor-embed canvas') as HTMLCanvasElement).toDataURL())
    await p.close()
    return png
  }
})
