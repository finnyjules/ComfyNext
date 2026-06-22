import { describe, it, expect } from 'vitest'
import { cleanAlphaPixels } from '../../app/composables/useInpaint'

// Build a w×h RGBA buffer; `alphaAt(x,y)` returns the alpha for each pixel.
function makeRGBA(w: number, h: number, alphaAt: (x: number, y: number) => number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    d[i] = 200; d[i + 1] = 200; d[i + 2] = 200; d[i + 3] = alphaAt(x, y)
  }
  return d
}

describe('cleanAlphaPixels', () => {
  it('removes a faint disconnected corner haze and crops to the subject', () => {
    const w = 20, h = 20
    // Solid 6×6 subject block in the center; a faint speck in the corner.
    const d = makeRGBA(w, h, (x, y) => {
      if (x >= 7 && x <= 12 && y >= 7 && y <= 12) return 255 // subject
      if (x === 19 && y === 19) return 54                    // corner haze
      return 0
    })
    const bbox = cleanAlphaPixels(d, w, h, { grow: 0 })
    expect(bbox).toEqual({ minX: 7, minY: 7, maxX: 12, maxY: 12 })
    // Corner haze zeroed.
    expect(d[(19 * w + 19) * 4 + 3]).toBe(0)
    // Subject preserved.
    expect(d[(9 * w + 9) * 4 + 3]).toBe(255)
  })

  it('keeps soft edges around the subject via grow', () => {
    const w = 20, h = 20
    // Solid 4×4 core with a 1px alpha-80 halo around it (below `core`).
    const inCore = (x: number, y: number) => x >= 8 && x <= 11 && y >= 8 && y <= 11
    const inHalo = (x: number, y: number) => x >= 7 && x <= 12 && y >= 7 && y <= 12
    const d = makeRGBA(w, h, (x, y) => (inCore(x, y) ? 255 : inHalo(x, y) ? 80 : 0))
    cleanAlphaPixels(d, w, h, { grow: 2 })
    // Halo pixel adjacent to the core survives (grow recovered it).
    expect(d[(7 * w + 9) * 4 + 3]).toBe(80)
  })

  it('returns null when there is no solid subject', () => {
    const w = 8, h = 8
    const d = makeRGBA(w, h, () => 30) // all faint, nothing ≥ core
    expect(cleanAlphaPixels(d, w, h)).toBeNull()
  })

  it('keeps multiple sizable components but drops tiny specks', () => {
    const w = 30, h = 12
    // Two solid blocks (both large) + a 1px speck far away.
    const d = makeRGBA(w, h, (x, y) => {
      if (x >= 2 && x <= 6 && y >= 2 && y <= 9) return 255   // block A
      if (x >= 20 && x <= 24 && y >= 2 && y <= 9) return 255 // block B
      if (x === 28 && y === 0) return 200                    // speck
      return 0
    })
    cleanAlphaPixels(d, w, h, { grow: 0 })
    expect(d[(5 * w + 4) * 4 + 3]).toBe(255)  // block A kept
    expect(d[(5 * w + 22) * 4 + 3]).toBe(255) // block B kept
    expect(d[(0 * w + 28) * 4 + 3]).toBe(0)   // speck dropped
  })
})
