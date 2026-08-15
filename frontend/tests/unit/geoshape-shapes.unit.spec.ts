import { describe, it, expect } from 'vitest'
import { baseShapePath } from '~/lib/geoshape/shapes'

const base = { sides: 6, starInner: 0.45, irregularSeed: 1, size: 180, roundCorners: 6, roundRadius: 0 }

describe('geoshape base shapes', () => {
  it('polygon/hexagon/star produce a closed path d', () => {
    for (const kind of ['polygon', 'hexagon', 'star'] as const) {
      const d = baseShapePath(kind, base)
      expect(d).toMatch(/^M/)
      expect(d.trim().endsWith('Z')).toBe(true)
    }
  })
  it('hexagon equals a 6-sided polygon', () => {
    expect(baseShapePath('hexagon', base)).toBe(baseShapePath('polygon', { ...base, sides: 6 }))
  })
  it('irregular is deterministic in its seed and differs across seeds', () => {
    expect(baseShapePath('irregular', base)).toBe(baseShapePath('irregular', base))
    expect(baseShapePath('irregular', base)).not.toBe(baseShapePath('irregular', { ...base, irregularSeed: 2 }))
  })
})
