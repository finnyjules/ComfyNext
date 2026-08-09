import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * Regression for the hard-freeze on selecting an image fill: a second
 * `ensureFillBitmaps` for an ALREADY-IN-FLIGHT src must NOT resolve
 * synchronously. It used to (Set-based `inFlight` → empty jobs →
 * `Promise.resolve()`), and the preview drawers chain `.then(redraw)`, which
 * re-calls `ensureFillBitmaps` → an infinite microtask loop that starves the
 * event loop so the `<img>.onload` macrotask never runs → the tab freezes.
 * The fix shares one pending promise per in-flight src, so `.then(redraw)`
 * fires exactly once, AFTER the decode settles.
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
  fireError() { this.onerror?.() }
}

let mod: typeof import('~/lib/paint/imageFillCache')

beforeEach(async () => {
  FakeImage.instances = []
  ;(globalThis as any).window = globalThis
  ;(globalThis as any).Image = FakeImage as any
  // Fresh module state per test (module-scope Maps persist otherwise).
  const vitest = await import('vitest')
  vitest.vi.resetModules()
  mod = await import('~/lib/paint/imageFillCache')
})

afterEach(() => {
  delete (globalThis as any).window
  delete (globalThis as any).Image
})

const flush = () => Promise.resolve().then(() => Promise.resolve())

describe('imageFillCache in-flight sharing', () => {
  it('a second request for an in-flight src does not resolve until the load settles', async () => {
    let firstDone = false, secondDone = false
    const p1 = mod.ensureFillBitmaps(['A']).then(() => { firstDone = true })
    const p2 = mod.ensureFillBitmaps(['A']).then(() => { secondDone = true })

    await flush()
    // The bug: the second (in-flight) call resolved synchronously here.
    expect(secondDone).toBe(false)
    expect(firstDone).toBe(false)
    // Only ONE actual image load was started for the shared src.
    expect(FakeImage.instances.length).toBe(1)

    FakeImage.instances[0]!.fireLoad(20)
    await p1; await p2
    expect(firstDone).toBe(true)
    expect(secondDone).toBe(true)
    expect(mod.getFillBitmap('A')).not.toBeNull()
  })

  it('re-requesting after load is a no-op (bitmap already cached) and resolves promptly', async () => {
    const p1 = mod.ensureFillBitmaps(['B'])
    await flush()
    FakeImage.instances[0]!.fireLoad()
    await p1
    const before = FakeImage.instances.length
    await mod.ensureFillBitmaps(['B'])          // already cached → no new load
    expect(FakeImage.instances.length).toBe(before)
  })

  it('a failed src is remembered and not retried', async () => {
    const p1 = mod.ensureFillBitmaps(['C'])
    await flush()
    FakeImage.instances[0]!.fireError()
    await p1
    expect(mod.hasFillBitmapFailed('C')).toBe(true)
    const before = FakeImage.instances.length
    await mod.ensureFillBitmaps(['C'])          // known-failed → no new load
    expect(FakeImage.instances.length).toBe(before)
  })
})
