import { describe, it, expect } from 'vitest'
import { bentOffset } from '~/lib/spacetype/ringLayout'

describe('bentOffset', () => {
  it('bend=0 is flat for every s', () => {
    for (const s of [-2, -0.5, 0, 0.5, 2]) {
      expect(bentOffset(s, 5, 0)).toEqual({ tangent: s, inward: 0 })
    }
  })

  it('bend=1 lands on the arc', () => {
    const R = 5, s = 2
    const o = bentOffset(s, R, 1)
    expect(o.tangent).toBeCloseTo(R * Math.sin(s / R), 6)
    expect(o.inward).toBeCloseTo(R * (1 - Math.cos(s / R)), 6)
  })

  it('centre never moves at any bend', () => {
    for (const b of [0, 0.3, 0.7, 1]) {
      const o = bentOffset(0, 5, b)
      expect(o.tangent).toBeCloseTo(0, 9)
      expect(o.inward).toBeCloseTo(0, 9)
    }
  })

  it('inward is >= 0 and grows with |s| (edges curl toward centre)', () => {
    const near = bentOffset(1, 5, 1).inward
    const far = bentOffset(3, 5, 1).inward
    expect(near).toBeGreaterThanOrEqual(0)
    expect(far).toBeGreaterThan(near)
  })

  it('R<=0 is flat (no div by zero)', () => {
    expect(bentOffset(2, 0, 1)).toEqual({ tangent: 2, inward: 0 })
  })
})
