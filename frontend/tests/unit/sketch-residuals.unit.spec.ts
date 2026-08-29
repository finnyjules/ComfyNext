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
})
