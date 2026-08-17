import { describe, it, expect } from 'vitest'
import { buildCurvePolyline, CURVE_SAMPLES } from '~/lib/gradientfx/curvePath'
import { CURVE_DEFAULTS, type CurveConfig } from '~/lib/gradientfx/types'

const mk = (o: Partial<CurveConfig>): CurveConfig => ({ ...CURVE_DEFAULTS, ...o })
const pt = (p: { pts: Float32Array }, k: number) => ({ x: p.pts[k*2]!, y: p.pts[k*2+1]! })

describe('buildCurvePolyline', () => {
  it('hits both endpoints exactly', () => {
    const c = mk({ start: { x: 0.1, y: 0.2 }, end: { x: 0.9, y: 0.8 }, shape: 'arc' })
    const p = buildCurvePolyline(c)
    expect(p.n).toBe(CURVE_SAMPLES)
    expect(pt(p, 0).x).toBeCloseTo(0.1, 5); expect(pt(p, 0).y).toBeCloseTo(0.2, 5)
    expect(pt(p, p.n - 1).x).toBeCloseTo(0.9, 5); expect(pt(p, p.n - 1).y).toBeCloseTo(0.8, 5)
  })

  it('arc-length is monotonic non-decreasing, len[0]=0, len[last]=1', () => {
    const p = buildCurvePolyline(mk({ shape: 'wave', waves: 4, curvature: 0.6 }))
    expect(p.len[0]).toBeCloseTo(0, 6)
    expect(p.len[p.n - 1]).toBeCloseTo(1, 6)
    for (let k = 1; k < p.n; k++) expect(p.len[k]!).toBeGreaterThanOrEqual(p.len[k - 1]!)
  })

  it('line preset is collinear (cross-product ~0 for every point)', () => {
    const c = mk({ start: { x: 0.1, y: 0.3 }, end: { x: 0.9, y: 0.6 }, shape: 'line', curvature: 1 })
    const p = buildCurvePolyline(c)
    const ax = 0.9 - 0.1, ay = 0.6 - 0.3
    for (let k = 0; k < p.n; k++) {
      const cross = ax * (pt(p, k).y - 0.3) - ay * (pt(p, k).x - 0.1)
      expect(Math.abs(cross)).toBeLessThan(1e-4)
    }
  })

  it('curvature 0 collapses arc onto the straight chord', () => {
    const c = mk({ start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 }, shape: 'arc', curvature: 0 })
    const p = buildCurvePolyline(c)
    for (let k = 0; k < p.n; k++) expect(pt(p, k).y).toBeCloseTo(0.5, 4)
  })

  it('wave with N waves crosses the chord axis ~N times (sign changes)', () => {
    const c = mk({ start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 }, shape: 'wave', waves: 3, curvature: 0.5, phase: 0 })
    const p = buildCurvePolyline(c)
    let signChanges = 0, prev = 0
    for (let k = 0; k < p.n; k++) {
      const off = pt(p, k).y - 0.5
      const s = Math.sign(off)
      if (s !== 0 && prev !== 0 && s !== prev) signChanges++
      if (s !== 0) prev = s
    }
    expect(signChanges).toBeGreaterThanOrEqual(3)
    expect(signChanges).toBeLessThanOrEqual(7)
  })

  it('bend sign flips the bow side', () => {
    const base = { start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 }, shape: 'arc' as const, curvature: 0.6 }
    const pos = buildCurvePolyline(mk({ ...base, bend: 1 }))
    const neg = buildCurvePolyline(mk({ ...base, bend: -1 }))
    const midPos = pos.pts[Math.floor(pos.n/2)*2 + 1]!  // mid y
    const midNeg = neg.pts[Math.floor(neg.n/2)*2 + 1]!
    expect(Math.sign(midPos - 0.5)).toBe(-Math.sign(midNeg - 0.5))
  })
})
