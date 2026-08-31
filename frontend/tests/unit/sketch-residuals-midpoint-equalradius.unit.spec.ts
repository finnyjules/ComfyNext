import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintResiduals } from '~/lib/sketch/residuals'
import { mergeSketchDoc } from '~/lib/sketch/merge'

describe('midpoint residual', () => {
  it('P pinned to the midpoint of A(0,0)–B(10,0) → residual [0,0] when P=(5,0)', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'p', kind: 'point', x: 5, y: 0 },
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 10, y: 0 },
      ],
      constraints: [{ id: 'k', kind: 'midpoint', refs: ['p', 'a', 'b'] }],
    }
    expect(constraintResiduals(doc)).toEqual([0, 0])
  })

  it('P away from the midpoint → nonzero residual = P − (A+B)/2', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'p', kind: 'point', x: 8, y: 3 },
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 10, y: 0 },
      ],
      constraints: [{ id: 'k', kind: 'midpoint', refs: ['p', 'a', 'b'] }],
    }
    const res = constraintResiduals(doc)
    expect(res[0]).toBeCloseTo(8 - 5, 9)
    expect(res[1]).toBeCloseTo(3 - 0, 9)
  })

  it('skips (null → no residuals pushed) when a ref does not resolve to a point', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'p', kind: 'point', x: 5, y: 0 },
        { id: 'a', kind: 'point', x: 0, y: 0 },
        // 'b' deliberately absent
      ],
      constraints: [{ id: 'k', kind: 'midpoint', refs: ['p', 'a', 'GONE'] }],
    }
    expect(constraintResiduals(doc)).toEqual([])
  })
})

describe('equalRadius residual', () => {
  it('r1=3, r2=5 → residual −2', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'ca', kind: 'point', x: 0, y: 0 },
        { id: 'A', kind: 'circle', center: 'ca', r: 3 },
        { id: 'cb', kind: 'point', x: 8, y: 2 },
        { id: 'B', kind: 'circle', center: 'cb', r: 5 },
      ],
      constraints: [{ id: 'k', kind: 'equalRadius', refs: ['A', 'B'] }],
    }
    expect(constraintResiduals(doc)).toEqual([-2])
  })

  it('equal radii → residual 0', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'ca', kind: 'point', x: 0, y: 0 },
        { id: 'A', kind: 'circle', center: 'ca', r: 4 },
        { id: 'cb', kind: 'point', x: 8, y: 2 },
        { id: 'B', kind: 'circle', center: 'cb', r: 4 },
      ],
      constraints: [{ id: 'k', kind: 'equalRadius', refs: ['A', 'B'] }],
    }
    expect(constraintResiduals(doc)).toEqual([0])
  })

  it('skips when a ref is not a circle', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'ca', kind: 'point', x: 0, y: 0 },
        { id: 'A', kind: 'circle', center: 'ca', r: 3 },
        { id: 'notACircle', kind: 'point', x: 1, y: 1 },
      ],
      constraints: [{ id: 'k', kind: 'equalRadius', refs: ['A', 'notACircle'] }],
    }
    expect(constraintResiduals(doc)).toEqual([])
  })
})

describe('mergeSketchDoc accepts the new kinds', () => {
  it('keeps a valid midpoint constraint', () => {
    const d = mergeSketchDoc({
      entities: [
        { id: 'p', kind: 'point', x: 5, y: 0 },
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 10, y: 0 },
      ],
      constraints: [{ id: 'k', kind: 'midpoint', refs: ['p', 'a', 'b'] }],
    })
    expect(d.constraints.map(c => c.kind)).toEqual(['midpoint'])
  })

  it('keeps a valid equalRadius constraint', () => {
    const d = mergeSketchDoc({
      entities: [
        { id: 'ca', kind: 'point', x: 0, y: 0 },
        { id: 'A', kind: 'circle', center: 'ca', r: 3 },
        { id: 'cb', kind: 'point', x: 8, y: 2 },
        { id: 'B', kind: 'circle', center: 'cb', r: 5 },
      ],
      constraints: [{ id: 'k', kind: 'equalRadius', refs: ['A', 'B'] }],
    })
    expect(d.constraints.map(c => c.kind)).toEqual(['equalRadius'])
  })

  it('drops a midpoint/equalRadius constraint with a dangling ref', () => {
    const d = mergeSketchDoc({
      entities: [
        { id: 'p', kind: 'point', x: 5, y: 0 },
        { id: 'a', kind: 'point', x: 0, y: 0 },
      ],
      constraints: [{ id: 'k', kind: 'midpoint', refs: ['p', 'a', 'GONE'] }],
    })
    expect(d.constraints).toEqual([])
  })
})
