// @vitest-environment happy-dom
//
// The pixel primitives behind "≈ variations produced four tiles that actually
// look different". Separate file from `takes-spread.unit.spec.ts` because that
// one is node-on-purpose (it pins the pick log's SSR guard against a genuinely
// absent `window`), and these need a DOM.
//
// `pixelDistance` is tested against synthetic buffers, so it is exact maths with
// nothing mocked. `thumbSignature` is tested against happy-dom's canvas, which
// does NOT rasterise — so what is proven here is the contract (unreadable input
// ⇒ null, never a throw), not that a real downsample is faithful. The live pass
// covers the real numbers.
import { describe, it, expect } from 'vitest'
import {
  THUMB_DIFF_MIN,
  THUMB_DIFF_SIZE,
  pixelDistance,
  thumbDistance,
  thumbSignature,
} from '~/lib/agent/takes'

/** A flat RGBA buffer of one colour, THUMB_DIFF_SIZE² pixels. */
function flat(r: number, g: number, b: number, a = 255, px = THUMB_DIFF_SIZE * THUMB_DIFF_SIZE) {
  const out = new Uint8ClampedArray(px * 4)
  for (let i = 0; i < px; i++) {
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a
  }
  return out
}

describe('pixelDistance', () => {
  it('two identical pictures are zero apart', () => {
    expect(pixelDistance(flat(120, 30, 200), flat(120, 30, 200))).toBe(0)
  })

  it('is the mean absolute difference per channel, on a 0..255 scale', () => {
    // One channel differs by 40 → 40/4 channels = 10 mean.
    expect(pixelDistance(flat(100, 0, 0), flat(140, 0, 0))).toBe(10)
    expect(pixelDistance(flat(0, 0, 0, 0), flat(255, 255, 255, 255))).toBe(255)
  })

  it('counts alpha — a silhouette change on transparency is a real difference', () => {
    // Same colour, opaque vs transparent: nothing but alpha moved.
    expect(pixelDistance(flat(10, 10, 10, 255), flat(10, 10, 10, 0))!).toBeGreaterThan(THUMB_DIFF_MIN)
  })

  it('a barely-different picture scores BELOW the "same picture" threshold', () => {
    // One channel off by 4 → mean 1. This is the case the re-spread exists for.
    expect(pixelDistance(flat(100, 100, 100), flat(104, 100, 100))!).toBeLessThan(THUMB_DIFF_MIN)
  })

  it('an obviously different picture scores ABOVE it', () => {
    expect(pixelDistance(flat(20, 20, 20), flat(200, 60, 90))!).toBeGreaterThan(THUMB_DIFF_MIN)
  })

  it('measures only half a buffer that differs, honestly', () => {
    const a = flat(0, 0, 0)
    const b = flat(0, 0, 0)
    for (let i = 0; i < b.length / 2; i++) b[i] = 255
    // Half the buffer went to 255. Its alpha bytes were already 255, so only
    // the 3 colour channels of that half actually moved: 0.5 × 0.75 × 255.
    expect(pixelDistance(a, b)).toBeCloseTo(95.625, 2)
  })

  it('returns null — never 0 — when the two cannot be compared', () => {
    // 0 would read as "identical" and trigger a re-spread of something nobody
    // measured; null means "can't tell" and is left alone.
    expect(pixelDistance(null, flat(0, 0, 0))).toBeNull()
    expect(pixelDistance(flat(0, 0, 0), null)).toBeNull()
    expect(pixelDistance(new Uint8ClampedArray(0), new Uint8ClampedArray(0))).toBeNull()
    expect(pixelDistance(flat(0, 0, 0, 255, 4), flat(0, 0, 0, 255, 9))).toBeNull()
  })
})

describe('thumbSignature', () => {
  it('refuses what it cannot measure, without throwing', () => {
    expect(thumbSignature(null)).toBeNull()
    expect(thumbSignature(undefined)).toBeNull()
    // A data-URL thumb: decoding it would be async, so it is simply not measured.
    expect(thumbSignature('data:image/png;base64,iVBORw0KGgo=')).toBeNull()
    expect(thumbSignature('')).toBeNull()
  })

  it('reads a canvas at the fixed comparison size, whatever the source size', () => {
    for (const size of [8, 160, 512]) {
      const c = document.createElement('canvas')
      c.width = size; c.height = size
      const sig = thumbSignature(c)
      // happy-dom may not implement getImageData at all — either it gives the
      // fixed-size buffer, or it declines. Both are contract-honest; a throw
      // escaping into the strip is not.
      if (sig) expect(sig.length).toBe(THUMB_DIFF_SIZE * THUMB_DIFF_SIZE * 4)
    }
  })

  it('never throws on a hostile canvas', () => {
    const hostile = { getContext: () => { throw new Error('tainted') }, width: 10, height: 10 }
    expect(() => thumbSignature(hostile as unknown as HTMLCanvasElement)).not.toThrow()
    expect(thumbSignature(hostile as unknown as HTMLCanvasElement)).toBeNull()
  })
})

describe('thumbDistance', () => {
  it('is null when either side is unmeasurable', () => {
    expect(thumbDistance(null, null)).toBeNull()
    expect(thumbDistance('data:image/png;base64,x', null)).toBeNull()
  })
})
