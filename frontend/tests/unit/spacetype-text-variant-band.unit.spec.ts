import { describe, it, expect } from 'vitest'
import { textVariantForBand } from '~/lib/spacetype/ribbonGeometry'

describe('textVariantForBand (first string → top band)', () => {
  it('puts the first text (variant 0) on the TOP band (i = count-1)', () => {
    expect(textVariantForBand(2, 3, 3)).toBe(0)   // count=3, top band i=2 → text 0
    expect(textVariantForBand(5, 6, 6)).toBe(0)
  })
  it('puts the last text on the BOTTOM band (i = 0) when count == numTexts', () => {
    expect(textVariantForBand(0, 3, 3)).toBe(2)   // bottom band → last text
  })
  it('reads first→last going down (top band 0, next 1, …)', () => {
    const count = 4, n = 4
    expect([3, 2, 1, 0].map(i => textVariantForBand(i, count, n))).toEqual([0, 1, 2, 3])
  })
  it('cycles when count > numTexts', () => {
    // count=5, numTexts=2: top band i=4 → (5-1-4)%2 = 0
    expect(textVariantForBand(4, 5, 2)).toBe(0)
    expect(textVariantForBand(3, 5, 2)).toBe(1)
  })
  it('never returns negative / out of range', () => {
    for (let i = 0; i < 8; i++) {
      const v = textVariantForBand(i, 8, 3)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(3)
    }
  })
})
