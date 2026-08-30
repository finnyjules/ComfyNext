import { describe, it, expect } from 'vitest'
import { arcThroughTangent, tangentJointArc } from '~/lib/sketch/infer'

describe('arcThroughTangent', () => {
  it('builds the arc tangent to a horizontal line at J, through end', () => {
    // J=(0,0), tangent horizontal (1,0), end=(0,4) straight up → semicircle bulging in x,
    // center on the vertical (perp to tangent) through J: C=(0,2), R=2
    const r = arcThroughTangent({ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 1, y: 0 })!
    expect(r.center.x).toBeCloseTo(0, 9)
    expect(r.center.y).toBeCloseTo(2, 9)
    expect(r.radius).toBeCloseTo(2, 9)
  })
  it('tangent at J really is tangentDir (radius ⊥ tangent)', () => {
    const J = { x: 1, y: 1 }, end = { x: 5, y: 3 }, T = { x: 1, y: 1 } // 45°
    const r = arcThroughTangent(J, end, T)!
    const radial = { x: J.x - r.center.x, y: J.y - r.center.y }
    expect(radial.x * T.x + radial.y * T.y).toBeCloseTo(0, 6) // radius ⊥ tangent
    // J and end both on the circle
    expect(Math.hypot(J.x - r.center.x, J.y - r.center.y)).toBeCloseTo(r.radius, 6)
    expect(Math.hypot(end.x - r.center.x, end.y - r.center.y)).toBeCloseTo(r.radius, 6)
  })
  it('end along the tangent → null (would be a straight line)', () => {
    expect(arcThroughTangent({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 1, y: 0 })).toBeNull()
  })
})

describe('tangentJointArc', () => {
  it('with no previous tangent, returns the free circumcircle arc', () => {
    const r = tangentJointArc({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 2 }, null)!
    expect(r.snappedTangent).toBe(false)
    // circumcircle of (0,0),(4,0),(2,2): center (2,0), R=2
    expect(r.center.x).toBeCloseTo(2, 6); expect(r.center.y).toBeCloseTo(0, 6)
    expect(r.radius).toBeCloseTo(2, 6)
  })
  it('snaps to tangent when the free drag is near-tangent-continuous', () => {
    // prev tangent horizontal at J=(0,0); pointer chosen so the free arc is ALMOST tangent
    // (near the exact-tangent circle's own boundary point (2,2) → free-arc tangent at J
    // comes out ~5.4° off horizontal, inside the 12° default tolerance)
    const r = tangentJointArc({ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 2.2, y: 2 }, { x: 1, y: 0 })!
    expect(r.snappedTangent).toBe(true)
    expect(r.center.x).toBeCloseTo(0, 6)  // exact tangent arc center on the perpendicular
    expect(r.center.y).toBeCloseTo(2, 6)
  })
  it('does NOT snap when the free drag is far from tangent', () => {
    const r = tangentJointArc({ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 3, y: 2 }, { x: 1, y: 0 })!
    expect(r.snappedTangent).toBe(false)
  })
  it('collinear free drag → null', () => {
    expect(tangentJointArc({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, null)).toBeNull()
  })
})
