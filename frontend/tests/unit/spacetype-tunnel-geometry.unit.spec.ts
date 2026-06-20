import { describe, it, expect } from 'vitest'
import { roundedRectPoint, buildTunnelRing, ellipsePoint, diamondPoint } from '../../app/lib/spacetype/tunnelGeometry'

describe('roundedRectPoint', () => {
  const a = 10, b = 6, r = 2
  it('starts on the top edge with an upward normal', () => {
    const p = roundedRectPoint(0, a, b, r)
    expect(p.y).toBeCloseTo(b); expect(p.x).toBeCloseTo(-(a - r)); expect(p.nx).toBeCloseTo(0); expect(p.ny).toBeCloseTo(1)
  })
  it('the right edge faces +x', () => {
    const sx = 2 * (a - r), arc = r * Math.PI / 2
    const p = roundedRectPoint(sx + arc + 1, a, b, r)   // partway down the right edge
    expect(p.x).toBeCloseTo(a); expect(p.nx).toBeCloseTo(1); expect(p.ny).toBeCloseTo(0)
  })
  it('the bottom edge faces −y', () => {
    const sx = 2 * (a - r), sy = 2 * (b - r), arc = r * Math.PI / 2
    const p = roundedRectPoint(sx + arc + sy + arc + 1, a, b, r)
    expect(p.y).toBeCloseTo(-b); expect(p.ny).toBeCloseTo(-1)
  })
  it('wraps periodically (s and s+perimeter coincide)', () => {
    const P = 2 * (2 * (a - r)) + 2 * (2 * (b - r)) + 4 * (r * Math.PI / 2)
    const p0 = roundedRectPoint(3.3, a, b, r)
    const p1 = roundedRectPoint(3.3 + P, a, b, r)
    expect(p1.x).toBeCloseTo(p0.x); expect(p1.y).toBeCloseTo(p0.y)
  })
  it('every sampled normal is unit length', () => {
    const P = 2 * (2 * (a - r)) + 2 * (2 * (b - r)) + 4 * (r * Math.PI / 2)
    for (let i = 0; i < 40; i++) {
      const p = roundedRectPoint((i / 40) * P, a, b, r)
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1)
    }
  })
})

describe('buildTunnelRing', () => {
  const base = { halfW: 10, halfH: 6, thickness: 1.2 }

  it('emits 2 verts per sample and 6 indices per quad, all in the z=0 plane', () => {
    const g = buildTunnelRing(base)
    const verts = g.positions.length / 3
    expect(verts % 2).toBe(0)
    expect(g.indices.length).toBe((verts / 2 - 1) * 6)
    for (let i = 2; i < g.positions.length; i += 3) expect(g.positions[i]).toBeCloseTo(0)
  })

  it('uv.x runs 0→1 around the perimeter; uv.y spans the band (0 inner, 1 outer)', () => {
    const g = buildTunnelRing(base)
    expect(g.uvs[0]).toBeCloseTo(0); expect(g.uvs[1]).toBeCloseTo(1)   // first outer
    expect(g.uvs[3]).toBeCloseTo(0)                                    // first inner v
    expect(g.uvs[g.uvs.length - 4]).toBeCloseTo(1)                     // last outer u
  })

  it('the two band edges straddle the centerline by ±thickness/2', () => {
    const g = buildTunnelRing(base)
    // first sample is on the top edge → outer is above the inner by the full thickness (in y)
    const outerY = g.positions[1]!, innerY = g.positions[4]!
    expect(outerY - innerY).toBeCloseTo(base.thickness)
  })

  it('perimeter ≈ straight runs + 4 quarter-arcs for the default corner radius', () => {
    const g = buildTunnelRing(base)
    const r = base.thickness / 2
    const expected = 2 * (2 * (base.halfW - r)) + 2 * (2 * (base.halfH - r)) + 4 * (r * Math.PI / 2)
    expect(g.perimeter).toBeCloseTo(expected)
  })

  it('is deterministic', () => {
    expect(Array.from(buildTunnelRing(base).positions)).toEqual(Array.from(buildTunnelRing(base).positions))
  })
})

describe('ellipsePoint (circle/ellipse shape)', () => {
  const a = 10, b = 6
  const perim = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
  it('every sample lies on the ellipse (x/a)²+(y/b)²=1 with a unit normal', () => {
    for (let i = 0; i < 24; i++) {
      const p = ellipsePoint((i / 24) * perim, perim, a, b)
      expect((p.x / a) ** 2 + (p.y / b) ** 2).toBeCloseTo(1, 4)
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1)
    }
  })
  it('a true circle has an exactly radial outward normal', () => {
    const p = ellipsePoint(0.37, 2 * Math.PI * 5, 5, 5)   // a=b=5
    expect(p.nx).toBeCloseTo(p.x / 5); expect(p.ny).toBeCloseTo(p.y / 5)
  })
})

describe('diamondPoint (rhombus shape)', () => {
  const a = 10, b = 6
  it('every sample lies on the rhombus |x|/a+|y|/b=1 with a unit normal', () => {
    const perim = 4 * Math.hypot(a, b)
    for (let i = 0; i < 24; i++) {
      const p = diamondPoint((i / 24) * perim, a, b)
      expect(Math.abs(p.x) / a + Math.abs(p.y) / b).toBeCloseTo(1, 4)
      expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1)
    }
  })
  it('starts at the top vertex and the four corners are the axis points', () => {
    const L = Math.hypot(a, b)
    expect(diamondPoint(0, a, b).x).toBeCloseTo(0); expect(diamondPoint(0, a, b).y).toBeCloseTo(b)   // top
    expect(diamondPoint(L, a, b).x).toBeCloseTo(a); expect(diamondPoint(L, a, b).y).toBeCloseTo(0)   // right
    expect(diamondPoint(2 * L, a, b).y).toBeCloseTo(-b)                                              // bottom
  })
})

describe('buildTunnelRing shapes', () => {
  const base = { halfW: 10, halfH: 6, thickness: 1.2 }
  for (const shape of ['rect', 'circle', 'diamond'] as const) {
    it(`${shape}: valid band geometry in z=0 with uv 0→1`, () => {
      const g = buildTunnelRing({ ...base, shape })
      const verts = g.positions.length / 3
      expect(verts % 2).toBe(0)
      expect(g.indices.length).toBe((verts / 2 - 1) * 6)
      expect(g.perimeter).toBeGreaterThan(0)
      for (let i = 2; i < g.positions.length; i += 3) expect(g.positions[i]).toBeCloseTo(0)
      expect(g.uvs[0]).toBeCloseTo(0)
      expect(g.uvs[g.uvs.length - 4]).toBeCloseTo(1)
    })
  }
  it('circle perimeter ≈ Ramanujan ellipse circumference', () => {
    const { halfW: a, halfH: b } = base
    const expected = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
    expect(buildTunnelRing({ ...base, shape: 'circle' }).perimeter).toBeCloseTo(expected)
  })
  it('diamond perimeter is the rounded-corner length (a bit under the sharp 4·√(a²+b²))', () => {
    const sharp = 4 * Math.hypot(base.halfW, base.halfH)
    const p = buildTunnelRing({ ...base, shape: 'diamond' }).perimeter
    expect(p).toBeLessThan(sharp)            // corner-rounding shortens the path
    expect(p).toBeGreaterThan(sharp * 0.7)   // but stays clearly diamond-proportioned
  })
})
