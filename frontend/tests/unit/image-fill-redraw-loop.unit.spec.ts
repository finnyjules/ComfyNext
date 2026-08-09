import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * The preview drawers (FillControl.drawPreview, FillSwatch.draw) repaint an
 * image fill and, while the bitmap isn't ready, re-arm themselves to redraw
 * once it loads. This test models that redraw loop against the REAL cache
 * module for the cases that used to hard-freeze the tab:
 *
 *  - **empty src** — the state the moment you pick the 'image' fill type,
 *    before choosing an image. `ensureFillBitmaps([''])` resolves synchronously
 *    (the loop skips a falsy src → empty jobs → `Promise.resolve()`), so a
 *    `.then(redraw)` re-arm is an infinite microtask loop.
 *  - **in-flight src** — a second redraw while the first load is still pending.
 *
 * The fix: drivers pass an `onReady` callback that fires ONLY on a genuine
 * successful decode, so an empty / failed / still-loading src never re-arms.
 */

class FakeImage {
  static instances: FakeImage[] = []
  crossOrigin = ''
  #src = ''
  complete = false
  naturalWidth = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { FakeImage.instances.push(this) }
  set src(v: string) { this.#src = v }
  get src() { return this.#src }
  fireLoad(w = 10) { this.complete = true; this.naturalWidth = w; this.onload?.() }
}

let mod: typeof import('~/lib/paint/imageFillCache')

beforeEach(async () => {
  FakeImage.instances = []
  ;(globalThis as any).window = globalThis
  ;(globalThis as any).Image = FakeImage as any
  const vitest = await import('vitest')
  vitest.vi.resetModules()
  mod = await import('~/lib/paint/imageFillCache')
})
afterEach(() => {
  delete (globalThis as any).window
  delete (globalThis as any).Image
})
const flush = () => Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve())

describe('preview redraw loop safety', () => {
  it('OLD .then(redraw) pattern infinite-loops on an empty src (documents the freeze)', async () => {
    // Model the drawer with the OLD re-arm. A hard cap stands in for the frozen
    // event loop — without it this would never terminate.
    let draws = 0
    function draw() {
      draws++
      if (draws > 100) return                       // cap = "the tab would be frozen here"
      if (mod.getFillBitmap('')) return
      if (mod.hasFillBitmapFailed('')) return
      mod.ensureFillBitmaps(['']).then(draw)        // empty src → immediate resolve → re-arm forever
    }
    draw()
    // Each microtask turn lets one re-armed .then fire. A NON-looping drawer
    // would stay at exactly 1 no matter how many turns we pump; this one climbs
    // until the cap — i.e. it never stops on its own (the freeze).
    for (let i = 0; i < 120; i++) await Promise.resolve()
    expect(draws).toBeGreaterThan(50)               // ran away (would freeze)
  })

  it('NEW onReady pattern does not re-arm on an empty src', async () => {
    let draws = 0
    function draw() {
      draws++
      if (draws > 100) return
      if (mod.getFillBitmap('')) return
      mod.ensureFillBitmaps([''], draw)             // onReady: never fires for an empty src
    }
    draw()
    await flush()
    expect(draws).toBe(1)                            // drawn once, no loop
  })

  it('NEW onReady pattern redraws exactly once when a real bitmap decodes', async () => {
    const src = 'A'
    let draws = 0
    function draw() {
      draws++
      if (draws > 100) return
      if (mod.getFillBitmap(src)) return
      mod.ensureFillBitmaps([src], draw)
    }
    draw()                                           // starts the load, arms onReady
    await flush()
    expect(draws).toBe(1)                            // still loading → no re-arm yet
    FakeImage.instances[0]!.fireLoad(20)
    await flush()
    expect(draws).toBe(2)                            // onReady fired once → one redraw
    expect(mod.getFillBitmap(src)).not.toBeNull()
  })
})
