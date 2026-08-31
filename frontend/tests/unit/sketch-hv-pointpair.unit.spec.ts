import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintResiduals } from '~/lib/sketch/residuals'

function base(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 10, y: 3 },
      { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
    ],
    constraints: [],
  }
}

describe('horizontal/vertical residuals: two-point form', () => {
  it('horizontal[pA, pB] = pA.y - pB.y', () => {
    const d = base()
    d.entities.push({ id: 'p', kind: 'point', x: 5, y: 5 }, { id: 'q', kind: 'point', x: 8, y: 1 })
    d.constraints = [{ id: 'h', kind: 'horizontal', refs: ['p', 'q'] }]
    expect(constraintResiduals(d)).toEqual([5 - 1])
  })

  it('vertical[pA, pB] = pA.x - pB.x', () => {
    const d = base()
    d.entities.push({ id: 'p', kind: 'point', x: 5, y: 5 }, { id: 'q', kind: 'point', x: 8, y: 1 })
    d.constraints = [{ id: 'v', kind: 'vertical', refs: ['p', 'q'] }]
    expect(constraintResiduals(d)).toEqual([5 - 8])
  })

  it('line-ref form (refs=[lineId]) still works for horizontal', () => {
    const d = base()
    d.constraints = [{ id: 'h', kind: 'horizontal', refs: ['L'] }]
    // a(0,0), b(10,3): a.y - b.y = 0 - 3 = -3
    expect(constraintResiduals(d)).toEqual([-3])
  })

  it('line-ref form (refs=[lineId]) still works for vertical', () => {
    const d = base()
    d.constraints = [{ id: 'v', kind: 'vertical', refs: ['L'] }]
    // a(0,0), b(10,3): a.x - b.x = 0 - 10 = -10
    expect(constraintResiduals(d)).toEqual([-10])
  })

  it('two-point form returns null (skipped) when a ref is dangling', () => {
    const d = base()
    d.entities.push({ id: 'p', kind: 'point', x: 5, y: 5 })
    d.constraints = [{ id: 'h', kind: 'horizontal', refs: ['p', 'GONE'] }]
    expect(constraintResiduals(d)).toEqual([])
  })

  it('refs[0] resolving to neither a line nor a point is skipped', () => {
    const d = base()
    d.entities.push({ id: 'cc', kind: 'point', x: 0, y: 0 }, { id: 'C', kind: 'circle', center: 'cc', r: 2 })
    d.constraints = [{ id: 'h', kind: 'horizontal', refs: ['C', 'a'] }]
    expect(constraintResiduals(d)).toEqual([])
  })
})
