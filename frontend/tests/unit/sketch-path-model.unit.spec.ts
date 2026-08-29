import { describe, it, expect } from 'vitest'
import { mergeSketchDoc } from '~/lib/sketch/merge'

const pts = [
  { id: 'a', kind: 'point', x: 0, y: 0 },
  { id: 'b', kind: 'point', x: 10, y: 0 },
  { id: 'c', kind: 'point', x: 10, y: 8 },
  { id: 'ctr', kind: 'point', x: 10, y: 4 },
]

describe('path entity merge', () => {
  it('keeps a valid open path (line + arc)', () => {
    const d = mergeSketchDoc({
      entities: [
        // path listed BEFORE its points — must still survive (two-pass)
        { id: 'P', kind: 'path', anchors: ['a', 'b', 'c'], segments: [{ kind: 'line' }, { kind: 'arc', center: 'ctr', sweep: 1 }], closed: false },
        ...pts,
      ],
      constraints: [],
    })
    const p = d.entities.find(e => e.id === 'P') as any
    expect(p).toBeDefined()
    expect(p.anchors).toEqual(['a', 'b', 'c'])
    expect(p.segments[1]).toEqual({ kind: 'arc', center: 'ctr', sweep: 1 })
  })

  it('drops a path with a dangling anchor or bad segment count', () => {
    const d = mergeSketchDoc({
      entities: [
        ...pts,
        { id: 'P1', kind: 'path', anchors: ['a', 'GONE'], segments: [{ kind: 'line' }], closed: false },
        { id: 'P2', kind: 'path', anchors: ['a', 'b', 'c'], segments: [{ kind: 'line' }], closed: false }, // needs 2 segments
      ],
      constraints: [],
    })
    expect(d.entities.filter(e => (e as any).kind === 'path')).toHaveLength(0)
  })

  it('accepts a closed path with segments.length === anchors.length', () => {
    const d = mergeSketchDoc({
      entities: [...pts, { id: 'P', kind: 'path', anchors: ['a', 'b', 'c'], segments: [{ kind: 'line' }, { kind: 'line' }, { kind: 'line' }], closed: true }],
      constraints: [],
    })
    expect(d.entities.find(e => e.id === 'P')).toBeDefined()
  })

  it('accepts the new constraint kinds and requires value on rotatedFrom', () => {
    const d = mergeSketchDoc({
      entities: pts,
      constraints: [
        { id: 'k1', kind: 'equalDist', refs: ['a', 'b', 'a', 'c'] },
        { id: 'k2', kind: 'rotatedFrom', refs: ['b', 'c', 'a'], value: 60 },
        { id: 'k3', kind: 'rotatedFrom', refs: ['b', 'c', 'a'] },          // no value → dropped
        { id: 'k4', kind: 'collinear', refs: ['a', 'b', 'c'] },
      ],
    })
    expect(d.constraints.map(c => c.id)).toEqual(['k1', 'k2', 'k4'])
  })
})
