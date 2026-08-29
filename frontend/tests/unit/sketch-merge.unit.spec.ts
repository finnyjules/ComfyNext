import { describe, it, expect } from 'vitest'
import { mergeSketchDoc } from '~/lib/sketch/merge'

describe('mergeSketchDoc', () => {
  it('returns an empty doc for garbage', () => {
    expect(mergeSketchDoc(null)).toEqual({ entities: [], constraints: [] })
    expect(mergeSketchDoc(42)).toEqual({ entities: [], constraints: [] })
    expect(mergeSketchDoc({})).toEqual({ entities: [], constraints: [] })
  })

  it('keeps valid entities, drops malformed ones, clamps negative r', () => {
    const d = mergeSketchDoc({
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 'nope', y: 0 },        // bad coord → dropped
        { id: 'cc', kind: 'point', x: 5, y: 5 },
        { id: 'C', kind: 'circle', center: 'cc', r: -3 },   // r clamped to 0
        { kind: 'point', x: 1, y: 1 },                       // no id → dropped
      ],
      constraints: [],
    })
    expect(d.entities.map(e => e.id)).toEqual(['a', 'cc', 'C'])
    expect((d.entities.find(e => e.id === 'C') as any).r).toBe(0)
  })

  it('drops dangling constraints and value-less dimensions', () => {
    const d = mergeSketchDoc({
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 10, y: 0 },
      ],
      constraints: [
        { id: 'k1', kind: 'coincident', refs: ['a', 'b'] },       // ok
        { id: 'k2', kind: 'coincident', refs: ['a', 'GONE'] },    // dangling → dropped
        { id: 'k3', kind: 'distance', refs: ['a', 'b'] },         // missing value → dropped
        { id: 'k4', kind: 'distance', refs: ['a', 'b'], value: 5 }, // ok
      ],
    })
    expect(d.constraints.map(c => c.id)).toEqual(['k1', 'k4'])
  })

  it('drops duplicate entity ids (first wins)', () => {
    const d = mergeSketchDoc({
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'a', kind: 'point', x: 9, y: 9 },
      ],
      constraints: [],
    })
    expect(d.entities).toHaveLength(1)
    expect((d.entities[0] as any).x).toBe(0)
  })
})
