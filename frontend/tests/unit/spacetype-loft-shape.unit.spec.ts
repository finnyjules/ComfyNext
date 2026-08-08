import { describe, it, expect } from 'vitest'
import { shapeContour } from '../../app/lib/spacetype/loftGeometry'

const P = 48
const params = { rectRadius: 0.5, polySides: 5, starDepth: 0.5 }

describe('shapeContour', () => {
  it('every shape returns exactly `points` vertices', () => {
    for (const s of ['oval','capsule','rectangle','polygon','star'] as const)
      expect(shapeContour(s, params, P).length).toBe(P)
  })
  it('oval is a unit circle (all radii ~1)', () => {
    for (const p of shapeContour('oval', params, P)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 3)
  })
  it('rectangle reaches into the corners (max extent > oval)', () => {
    const maxR = (pts: {x:number;y:number}[]) => Math.max(...pts.map(p => Math.hypot(p.x, p.y)))
    expect(maxR(shapeContour('rectangle', { ...params, rectRadius: 0 }, P))).toBeGreaterThan(1.2)
  })
  it('star has alternating near/far vertices (inner pulled in by starDepth)', () => {
    const r = shapeContour('star', { ...params, polySides: 5, starDepth: 0.6 }, 200).map(p => Math.hypot(p.x, p.y))
    expect(Math.min(...r)).toBeLessThan(0.6)   // inner points pulled in
    expect(Math.max(...r)).toBeGreaterThan(0.9) // outer points near 1
  })
  it('polygon has no deep inner points (starDepth ignored)', () => {
    const r = shapeContour('polygon', { ...params, polySides: 6 }, 200).map(p => Math.hypot(p.x, p.y))
    expect(Math.min(...r)).toBeGreaterThan(0.7)  // polygon edges dip only to the apothem, not to center
  })
})
