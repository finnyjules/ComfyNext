import { describe, it, expect } from 'vitest'
import { sub, dot, cross, len, dist, distPointToLine } from '~/lib/sketch/geom'

describe('sketch geom', () => {
  it('does basic vector algebra', () => {
    expect(sub({ x: 3, y: 5 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 3 })
    expect(dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0)
    expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1)
    expect(len({ x: 3, y: 4 })).toBe(5)
    expect(dist({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4)
  })

  it('measures signed distance from a point to an infinite line', () => {
    // line along the x-axis, point one unit above → +1 (left of →x)
    expect(distPointToLine({ x: 5, y: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(1, 9)
    expect(distPointToLine({ x: 5, y: -3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(-3, 9)
    // degenerate line (a≈b) → 0, never NaN
    expect(distPointToLine({ x: 5, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0)
  })
})
