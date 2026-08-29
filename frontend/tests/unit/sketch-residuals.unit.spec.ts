import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintResiduals } from '~/lib/sketch/residuals'

function base(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 10, y: 0 },
      { id: 'cc', kind: 'point', x: 5, y: 4 },
      { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
      { id: 'C', kind: 'circle', center: 'cc', r: 3 },
    ],
    constraints: [],
  }
}

describe('constraint residuals', () => {
  it('tangentLineCircle residual is (perp distance − r)', () => {
    const d = base()
    d.constraints = [{ id: 'k', kind: 'tangentLineCircle', refs: ['L', 'C'] }]
    // center is 4 above the x-axis line, r=3 → residual 4-3 = 1
    expect(constraintResiduals(d)).toEqual([1])
  })

  it('radius and distance use their value', () => {
    const d = base()
    d.constraints = [
      { id: 'r', kind: 'radius', refs: ['C'], value: 5 },       // 3-5 = -2
      { id: 'd', kind: 'distance', refs: ['a', 'b'], value: 8 }, // 10-8 = 2
    ]
    expect(constraintResiduals(d)).toEqual([-2, 2])
  })

  it('horizontal/vertical read endpoint deltas', () => {
    const d = base()
    d.entities[1] = { id: 'b', kind: 'point', x: 10, y: 3 } // b now above a
    d.constraints = [{ id: 'h', kind: 'horizontal', refs: ['L'] }]
    expect(constraintResiduals(d)).toEqual([0 - 3]) // Ay - By = -3
  })

  it('skips constraints with dangling refs, never NaN', () => {
    const d = base()
    d.constraints = [{ id: 'k', kind: 'tangentLineCircle', refs: ['L', 'GONE'] }]
    expect(constraintResiduals(d)).toEqual([])
  })

  it('coincident refs give point difference', () => {
    const d = base()
    d.entities.push({ id: 'd', kind: 'point', x: 3, y: 5 })
    d.constraints = [{ id: 'c', kind: 'coincident', refs: ['a', 'd'] }]
    // [a.x - d.x, a.y - d.y] = [0 - 3, 0 - 5] = [-3, -5]
    expect(constraintResiduals(d)).toEqual([-3, -5])
  })

  it('concentric refs give center difference', () => {
    const d = base()
    d.entities.push({ id: 'cc2', kind: 'point', x: 8, y: 1 })
    d.entities.push({ id: 'C2', kind: 'circle', center: 'cc2', r: 2 })
    d.constraints = [{ id: 'k', kind: 'concentric', refs: ['C', 'C2'] }]
    // [cc.x - cc2.x, cc.y - cc2.y] = [5 - 8, 4 - 1] = [-3, 3]
    expect(constraintResiduals(d)).toEqual([-3, 3])
  })

  it('pointOnLine gives signed distance', () => {
    const d = base()
    d.constraints = [{ id: 'pol', kind: 'pointOnLine', refs: ['cc', 'L'] }]
    // point cc(5,4) to line L from a(0,0) to b(10,0)
    // signed distance = ((B-A) × (P-A)) / ||B-A|| = (40) / 10 = 4
    expect(constraintResiduals(d)).toEqual([4])
  })

  it('pointOnCircle gives radius residual', () => {
    const d = base()
    d.entities.push({ id: 'p', kind: 'point', x: 7, y: 4 })
    d.constraints = [{ id: 'poc', kind: 'pointOnCircle', refs: ['p', 'C'] }]
    // point p(7,4) to circle C center(5,4) r=3: dist = 2, residual = 2 - 3 = -1
    expect(constraintResiduals(d)).toEqual([-1])
  })

  it('tangentCircleCircle gives tangency residual', () => {
    const d = base()
    d.entities.push({ id: 'cc2', kind: 'point', x: 9, y: 4 })
    d.entities.push({ id: 'C2', kind: 'circle', center: 'cc2', r: 2 })
    d.constraints = [{ id: 'tcc', kind: 'tangentCircleCircle', refs: ['C', 'C2'] }]
    // C: center(5,4) r=3, C2: center(9,4) r=2
    // dist(centers) = 4, residual = 4 - (3+2) = -1
    expect(constraintResiduals(d)).toEqual([-1])
  })

  it('vertical refs give x difference', () => {
    const d = base()
    d.constraints = [{ id: 'v', kind: 'vertical', refs: ['L'] }]
    // line from a(0,0) to b(10,0): a.x - b.x = 0 - 10 = -10
    expect(constraintResiduals(d)).toEqual([-10])
  })
})
