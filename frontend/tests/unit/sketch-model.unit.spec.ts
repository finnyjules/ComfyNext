import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { getEntity, getPoint, lineEndpoints, circleCenter } from '~/lib/sketch/model'

const doc: SketchDoc = {
  entities: [
    { id: 'p1', kind: 'point', x: 0, y: 0 },
    { id: 'p2', kind: 'point', x: 10, y: 0 },
    { id: 'pc', kind: 'point', x: 5, y: 5 },
    { id: 'l1', kind: 'line', p1: 'p1', p2: 'p2' },
    { id: 'c1', kind: 'circle', center: 'pc', r: 3 },
  ],
  constraints: [],
}

describe('sketch model', () => {
  it('resolves entities and points by id', () => {
    expect(getEntity(doc, 'l1')?.kind).toBe('line')
    expect(getPoint(doc, 'pc')).toMatchObject({ x: 5, y: 5 })
    expect(getPoint(doc, 'l1')).toBeUndefined() // not a point
  })

  it('resolves concrete endpoints and centers, null when a ref dangles', () => {
    const l1 = getEntity(doc, 'l1') as any
    expect(lineEndpoints(doc, l1)).toEqual({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } })
    const c1 = getEntity(doc, 'c1') as any
    expect(circleCenter(doc, c1)).toEqual({ x: 5, y: 5 })
    const dangling = { id: 'lx', kind: 'line', p1: 'p1', p2: 'nope' } as any
    expect(lineEndpoints(doc, dangling)).toBeNull()
  })
})
