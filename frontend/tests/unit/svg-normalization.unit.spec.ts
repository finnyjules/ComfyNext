import { describe, expect, it } from 'vitest'
import { svgNormalization } from '~/composables/useVectorSvg'

// Pure arithmetic extracted from svgToLeafPaths — no paper.js/DOM needed.
describe('svgNormalization', () => {
  it('scales bounds by targetWidth / bounds.width', () => {
    const { k, bbox } = svgNormalization({ width: 100, height: 50 }, 0.6)
    expect(k).toBeCloseTo(0.006, 10)
    expect(bbox).toEqual({ w: 0.6, h: 0.3 })
  })

  it('falls back to k=1 for zero-width bounds instead of Infinity/NaN', () => {
    // A degenerate SVG (e.g. a single vertical line) has zero-width bounds.
    // Without the width > 0 guard, k = targetWidth / 0 = Infinity, and every
    // downstream transform would silently produce garbage geometry.
    const { k } = svgNormalization({ width: 0, height: 40 }, 0.6)
    expect(Number.isFinite(k)).toBe(true)
    expect(k).toBe(1)
  })

  it('floors bbox dimensions at 0.001 when the scaled size would round to zero', () => {
    const { bbox } = svgNormalization({ width: 100, height: 0.0001 }, 0.6)
    expect(bbox.h).toBe(0.001)
  })
})
