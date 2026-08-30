import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintResiduals } from '~/lib/sketch/residuals'
import { mergeSketchDoc } from '~/lib/sketch/merge'

function d(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 4, y: 0 },   // a→b points +x
      { id: 'c', kind: 'point', x: 1, y: 1 },
      { id: 'e', kind: 'point', x: 1, y: 5 },    // c→e points +y  (⊥ to a→b)
      { id: 'f', kind: 'point', x: 3, y: 3 },    // c→f points +x (∥ a→b)
    ],
    constraints: [],
  }
}

describe('perpendicular / parallel residuals', () => {
  it('perpendicular residual is the dot of the two directions', () => {
    const doc = d()
    // a→b = (4,0); c→e = (0,4) → dot 0 (perpendicular)
    doc.constraints = [{ id: 'k', kind: 'perpendicular', refs: ['a', 'b', 'c', 'e'] }]
    expect(constraintResiduals(doc)).toEqual([0])
    // a→b = (4,0); c→f = (2,2) → dot 8 (not perpendicular)
    doc.constraints = [{ id: 'k', kind: 'perpendicular', refs: ['a', 'b', 'c', 'f'] }]
    expect(constraintResiduals(doc)).toEqual([8])
  })
  it('parallel residual is the cross of the two directions', () => {
    const doc = d()
    // a→b = (4,0); c→f = (2,2) → cross 4*2 − 0*2 = 8 (not parallel)
    doc.constraints = [{ id: 'k', kind: 'parallel', refs: ['a', 'b', 'c', 'f'] }]
    expect(constraintResiduals(doc)).toEqual([8])
    // move f so c→f = (2,0), parallel to (4,0) → cross 0
    ;(doc.entities.find(e => e.id === 'f') as any).y = 1  // c=(1,1), f=(3,1) → c→f=(2,0)
    expect(constraintResiduals(doc)).toEqual([0])
  })
  it('degenerate direction (zero length) contributes nothing', () => {
    const doc = d()
    ;(doc.entities.find(e => e.id === 'b') as any).x = 0 // a==b → a→b zero length
    doc.constraints = [{ id: 'k', kind: 'perpendicular', refs: ['a', 'b', 'c', 'e'] }]
    expect(constraintResiduals(doc)).toEqual([])
  })
  it('merge accepts the new kinds', () => {
    const m = mergeSketchDoc({
      entities: [{ id: 'a', kind: 'point', x: 0, y: 0 }, { id: 'b', kind: 'point', x: 1, y: 0 }, { id: 'c', kind: 'point', x: 0, y: 0 }, { id: 'e', kind: 'point', x: 0, y: 1 }],
      constraints: [
        { id: 'k1', kind: 'perpendicular', refs: ['a', 'b', 'c', 'e'] },
        { id: 'k2', kind: 'parallel', refs: ['a', 'b', 'c', 'e'] },
      ],
    })
    expect(m.constraints.map(c => c.kind)).toEqual(['perpendicular', 'parallel'])
  })
})
