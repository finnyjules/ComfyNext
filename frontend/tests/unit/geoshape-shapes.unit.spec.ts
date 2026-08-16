import { describe, it, expect } from 'vitest'
import { baseShapePath, BASE_SHAPES } from '~/lib/geoshape/shapes'

const base = { sides: 6, starInner: 0.45, irregularSeed: 1, size: 180, roundCorners: 6, roundRadius: 0 }

describe('geoshape base shapes', () => {
  it('every base shape produces a closed path d', () => {
    for (const kind of BASE_SHAPES) {
      const d = baseShapePath(kind, base)
      expect(d, kind).toMatch(/^M/)
      expect(d.trim().endsWith('Z'), kind).toBe(true)
      expect(d.length, kind).toBeGreaterThan(10)
    }
  })
  it('the 12 named shapes are all present', () => {
    expect(BASE_SHAPES).toEqual([
      'circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon',
      'octagon', 'star', 'semicircle', 'cross', 'leaf', 'irregular',
    ])
  })
  it('curved shapes (circle/semicircle/leaf) use arc/curve commands', () => {
    expect(baseShapePath('circle', base)).toMatch(/A/)      // arc
    expect(baseShapePath('semicircle', base)).toMatch(/A/)
    expect(baseShapePath('leaf', base)).toMatch(/Q/)         // quadratic
  })
  it('polygonal shapes differ from each other (triangle ≠ hexagon ≠ octagon)', () => {
    const t = baseShapePath('triangle', base)
    const h = baseShapePath('hexagon', base)
    const o = baseShapePath('octagon', base)
    expect(t).not.toBe(h)
    expect(h).not.toBe(o)
  })
  it('irregular is deterministic in its seed and differs across seeds', () => {
    expect(baseShapePath('irregular', base)).toBe(baseShapePath('irregular', base))
    expect(baseShapePath('irregular', base)).not.toBe(baseShapePath('irregular', { ...base, irregularSeed: 2 }))
  })
})
