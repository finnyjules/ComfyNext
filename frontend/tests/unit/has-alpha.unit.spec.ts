import { describe, it, expect } from 'vitest'
import { canvasHasAlpha } from '../../app/lib/engine/hasAlpha'

/** Build a fake ImageData-like RGBA buffer. `alphaAt` overrides specific pixel
 *  indices (0-based, row-major) away from the 255 (opaque) default. */
function makeImage(width: number, height: number, alphaAt: Record<number, number> = {}) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    data[p * 4 + 0] = 255
    data[p * 4 + 1] = 255
    data[p * 4 + 2] = 255
    data[p * 4 + 3] = p in alphaAt ? alphaAt[p]! : 255
  }
  return { data, width, height }
}

describe('canvasHasAlpha', () => {
  it('reports false for a fully opaque source', () => {
    const img = makeImage(32, 32)
    expect(canvasHasAlpha(img)).toBe(false)
  })

  it('reports true when any single pixel is below full alpha', () => {
    const img = makeImage(32, 32, { [32 * 5 + 5]: 254 })
    expect(canvasHasAlpha(img)).toBe(true)
  })

  it('reports true for a fully transparent source', () => {
    const width = 16, height = 16
    const data = new Uint8ClampedArray(width * height * 4) // all zero, incl. alpha
    expect(canvasHasAlpha({ data, width, height })).toBe(true)
  })

  it('does not miss a small transparent region in a large frame (no false negative from sampling)', () => {
    // A frame large enough that a coarse/sparse sampler would plausibly skip
    // straight over a single-pixel hole. Correctness over speed: this must
    // still come back true.
    const width = 1024, height = 1024
    const holeIndex = 777 * width + 511 // one pixel, off any obvious grid stride
    const img = makeImage(width, height, { [holeIndex]: 0 })
    expect(canvasHasAlpha(img)).toBe(true)
  })
})
