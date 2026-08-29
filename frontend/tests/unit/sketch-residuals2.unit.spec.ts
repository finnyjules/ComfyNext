import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintResiduals } from '~/lib/sketch/residuals'

function d(): SketchDoc {
  return {
    entities: [
      { id: 'o', kind: 'point', x: 0, y: 0 },
      { id: 'p', kind: 'point', x: 1, y: 0 },
      { id: 'q', kind: 'point', x: 0, y: 1 },
      { id: 'r', kind: 'point', x: 2, y: 3 },
      { id: 'ax1', kind: 'point', x: 0, y: 0 },
      { id: 'ax2', kind: 'point', x: 10, y: 0 },
      { id: 'AX', kind: 'line', p1: 'ax1', p2: 'ax2' },   // the x-axis
    ],
    constraints: [],
  }
}

describe('new residuals', () => {
  it('equalDist = dist(A,B) − dist(C,D)', () => {
    const doc = d()
    // dist(o,p)=1, dist(o,q)=1 → 0 ; dist(o,r)=√13
    doc.constraints = [
      { id: 'k1', kind: 'equalDist', refs: ['o', 'p', 'o', 'q'] },
      { id: 'k2', kind: 'equalDist', refs: ['o', 'p', 'o', 'r'] },
    ]
    const res = constraintResiduals(doc)
    expect(res[0]).toBeCloseTo(0, 9)
    expect(res[1]).toBeCloseTo(1 - Math.sqrt(13), 9)
  })

  it('rotatedFrom: copy equals orig rotated by value° about center', () => {
    const doc = d()
    // rotate p(1,0) by 90° about o → (0,1) = q exactly → residuals [0,0]
    doc.constraints = [{ id: 'k', kind: 'rotatedFrom', refs: ['q', 'p', 'o'], value: 90 }]
    const res = constraintResiduals(doc)
    expect(res[0]).toBeCloseTo(0, 9)
    expect(res[1]).toBeCloseTo(0, 9)
    // and a wrong copy: r(2,3) vs rotate(p,90)=(0,1) → [2-0, 3-1]
    doc.constraints = [{ id: 'k', kind: 'rotatedFrom', refs: ['r', 'p', 'o'], value: 90 }]
    expect(constraintResiduals(doc)).toEqual([2, 2])
  })

  it('mirroredFrom: copy equals orig reflected across the axis line', () => {
    const doc = d()
    // reflect r(2,3) across the x-axis → (2,−3); the "copy" q(0,1) is wrong by [0−2, 1−(−3)]
    doc.constraints = [{ id: 'k', kind: 'mirroredFrom', refs: ['q', 'r', 'AX'] }]
    const res = constraintResiduals(doc)
    expect(res[0]).toBeCloseTo(-2, 9)
    expect(res[1]).toBeCloseTo(4, 9)
  })

  it('collinear: cross(B−A, C−A) is 0 on a line, nonzero off it', () => {
    const doc = d()
    doc.constraints = [{ id: 'k', kind: 'collinear', refs: ['o', 'p', 'ax2'] }] // (0,0),(1,0),(10,0) → 0
    expect(constraintResiduals(doc)).toEqual([0])
    doc.constraints = [{ id: 'k', kind: 'collinear', refs: ['o', 'p', 'q'] }]   // cross((1,0),(0,1)) = 1
    expect(constraintResiduals(doc)).toEqual([1])
  })

  it('degenerate mirror axis (zero length) contributes nothing', () => {
    const doc = d()
    ;(doc.entities.find(e => e.id === 'ax2') as any).x = 0
    ;(doc.entities.find(e => e.id === 'ax2') as any).y = 0
    doc.constraints = [{ id: 'k', kind: 'mirroredFrom', refs: ['q', 'r', 'AX'] }]
    expect(constraintResiduals(doc)).toEqual([])
  })
})
