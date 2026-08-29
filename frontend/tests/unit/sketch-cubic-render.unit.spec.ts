import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { entityPath } from '~/lib/sketch/sketchPath'

function doc(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 10, y: 0 },
      { id: 'ha', kind: 'point', x: 2, y: 3, construction: true },   // out-handle of a
      { id: 'hb', kind: 'point', x: 8, y: 3, construction: true },   // in-handle of b
      { id: 'P', kind: 'path', anchors: ['a', 'b'], segments: [{ kind: 'cubic', h1: 'ha', h2: 'hb' }], closed: false },
    ],
    constraints: [],
  }
}

describe('cubic rendering', () => {
  it('emits C with both handle coords', () => {
    expect(entityPath(doc(), 'P')).toBe('M 0 0 C 2 3 8 3 10 0')
  })
  it('null h1 collapses the first control point onto the start anchor', () => {
    const d = doc()
    ;(d.entities.find(e => e.id === 'P') as any).segments = [{ kind: 'cubic', h1: null, h2: 'hb' }]
    expect(entityPath(d, 'P')).toBe('M 0 0 C 0 0 8 3 10 0')
  })
  it('dangling handle id degrades to a straight side, not empty output', () => {
    const d = doc()
    ;(d.entities.find(e => e.id === 'P') as any).segments = [{ kind: 'cubic', h1: 'GONE', h2: 'hb' }]
    expect(entityPath(d, 'P')).toBe('M 0 0 C 0 0 8 3 10 0')
  })
})
