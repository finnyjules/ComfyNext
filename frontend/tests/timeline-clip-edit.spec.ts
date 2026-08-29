import { test, expect } from '@playwright/test'
import { PNG } from 'pngjs'

// Timeline clip-in-place editing (spec 1: 2026-08-27-timeline-live-studio-clip-editing).
//
// The feature: editing a Space Type clip's state IN PLACE on the timeline must
// (a) reach the rendered pixels, (b) leave the clip's trim untouched, and
// (c) detach the clip from its origin node. The store write-back
// (updateSpaceTypeClipState) is unit-tested in spacetype-state-source.unit.spec.ts;
// what NO test covered until now is the end-to-end path — a state edit driving
// the live WebGL bake of a Space Type clip on a real timeline. This spec closes
// that gap. It drives /dev/timeline-clip-harness, which holds the REAL
// useTimelineStore and renders its CURRENT state through the WebGL preview
// renderer (the only preview path that bakes spacetype live from clip.state —
// see spaceTypeSource.ts / spaceTypeClipRenderer.ts; the server path reads a
// pre-baked frame list the preview payload never carries and would skip the clip).
//
// Two WebGL renders are two GL contexts and are NOT byte-identical on antialiased
// edges (~0.002 mean noise floor — same property embed-spacetype.spec.ts documents
// and tests around). So the comparison is tolerant, with a wide margin between the
// noise floor and the edit's signal. The primary edit flips bgColor (fills the whole
// frame — calibrated ~0.35 mean, two orders of magnitude over the floor), plus a text
// change, so "the edit reached the render" is unambiguous. The no-edit control test
// pins the noise floor, proving the main test's diff is the edit and not GL nondeterminism.
// Two renders of the SAME state must stay under this (noise floor ~0.003).
const NOISE_CEIL = 0.01
// A bgColor flip must clear this by a wide margin (measured ~0.90).
const SIGNAL_FLOOR = 0.05
// A text-only edit on the frame-filling `field` effect (bgColor held constant)
// changes glyph pixels only — a smaller but unambiguous signal (measured well
// above the noise floor). This gates the text path independently of bgColor.
const TEXT_SIGNAL_FLOOR = 0.02

function pngOf(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'))
}

function meanDiff(aUrl: string, bUrl: string): number {
  const a = pngOf(aUrl)
  const b = pngOf(bUrl)
  if (a.width !== b.width || a.height !== b.height) return 1
  let sum = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(a.data[i + c]! - b.data[i + c]!) / 255
      n++
    }
  }
  return sum / n
}

test.describe('Timeline — editing a Space Type clip in place', () => {
  // The WebGL/three.js/spacetype import graph is heavy to cold-compile on the dev
  // server and each test drives a live GL render — well past the 60s default.
  test.describe.configure({ timeout: 120_000 })

  // Warm the dev server's module compilation ONCE so the first timed test doesn't
  // pay the (server-side, shared) cold compile of three.js + the spacetype engine.
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    try {
      await page.goto('/dev/timeline-clip-harness')
      await page.waitForFunction(() => !!(window as any).__clipHarness, undefined, { timeout: 90_000 })
      await page.evaluate(() => (window as any).__clipHarness.seed())
      await page.evaluate(() => (window as any).__clipHarness.render(0))
    } finally {
      await page.close()
    }
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/timeline-clip-harness')
    await page.waitForFunction(() => !!(window as any).__clipHarness, undefined, { timeout: 30_000 })
  })

  test('a content edit reaches the render, preserves trim, and detaches from origin', async ({ page }) => {
    const clipId = await page.evaluate(() => (window as any).__clipHarness.seed({ text: 'HELLO' }).clipId)

    const before = await page.evaluate(() => (window as any).__clipHarness.render(0))
    const trimBefore = await page.evaluate((id) => (window as any).__clipHarness.trim(id), clipId)
    const originBefore = await page.evaluate((id) => (window as any).__clipHarness.origin(id), clipId)

    // Seeding attaches the clip to a fake origin node — the detach below is only
    // meaningful if it was attached to begin with.
    expect(originBefore, 'seed must attach the clip to an origin node').not.toBeNull()

    // Edit the clip's content through the real store method under test. bgColor fills
    // the frame (huge, deterministic signal); the text change rides along as a second
    // genuine content edit.
    await page.evaluate(
      (id) => (window as any).__clipHarness.edit(id, { bgColor: '#ffffff', params: { text: 'GOODBYE' } }),
      clipId,
    )

    const after = await page.evaluate(() => (window as any).__clipHarness.render(0))
    const trimAfter = await page.evaluate((id) => (window as any).__clipHarness.trim(id), clipId)
    const originAfter = await page.evaluate((id) => (window as any).__clipHarness.origin(id), clipId)

    // (a) The edit reached the pixels. A tiny diff here means the state edit did not
    // drive the render (e.g. WebGL2 unavailable → transparent fallback both times).
    const editDiff = meanDiff(before, after)
    console.log(`[clip-edit] edit mean diff = ${editDiff.toFixed(4)} (floor ${SIGNAL_FLOOR})`)
    expect(
      editDiff,
      'the in-place edit must change the rendered frame (WebGL2 required)',
    ).toBeGreaterThan(SIGNAL_FLOOR)

    // (b) A content edit must not touch the clip's placement/trim.
    expect(trimAfter, 'content edit must not change trim').toEqual(trimBefore)

    // (c) Editing in place detaches the clip from its origin node (spec 1 detach model).
    expect(originAfter, 'in-place edit must detach the clip from its origin').toBeNull()
  })

  test('re-rendering the same state is near-identical (the edit diff is the edit, not GL noise)', async ({ page }) => {
    await page.evaluate(() => (window as any).__clipHarness.seed({ text: 'HELLO' }))
    const a = await page.evaluate(() => (window as any).__clipHarness.render(0))
    const b = await page.evaluate(() => (window as any).__clipHarness.render(0))
    const noise = meanDiff(a, b)
    console.log(`[clip-edit] no-edit mean diff = ${noise.toFixed(4)} (ceil ${NOISE_CEIL})`)
    expect(noise, 'two renders of the same state must sit at the noise floor').toBeLessThan(NOISE_CEIL)
  })

  test('a text-only edit changes the render (proves the glyph path, not just the background)', async ({ page }) => {
    // Seed the frame-filling `field` effect and hold bgColor constant, so the ONLY
    // thing the edit changes is the text — isolating the glyph/atlas path that the
    // bgColor-dominated test above cannot independently prove.
    const clipId = await page.evaluate(
      () => (window as any).__clipHarness.seed({ text: 'HELLO', state: { effectId: 'field' } }).clipId,
    )
    const before = await page.evaluate(() => (window as any).__clipHarness.render(0))

    await page.evaluate(
      (id) => (window as any).__clipHarness.edit(id, { params: { text: 'GOODBYE WORLD' } }),
      clipId,
    )
    const after = await page.evaluate(() => (window as any).__clipHarness.render(0))

    const textDiff = meanDiff(before, after)
    console.log(`[clip-edit] text-only mean diff = ${textDiff.toFixed(4)} (floor ${TEXT_SIGNAL_FLOOR})`)
    expect(textDiff, 'a text-only edit must change the glyph pixels').toBeGreaterThan(TEXT_SIGNAL_FLOOR)
  })
})
