import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { cloneDoc } from '~/lib/sketch/clone'

describe('cloneDoc', () => {
  it('deep-clones entities, path segments, and constraint refs (no shared refs)', () => {
    const d: SketchDoc = {
      entities: [
        { id: 'a', kind: 'point', x: 1, y: 2 },
        { id: 'P', kind: 'path', anchors: ['a', 'b'], segments: [{ kind: 'arc', center: 'c', sweep: 1 }], closed: false },
      ],
      constraints: [{ id: 'k', kind: 'distance', refs: ['a', 'b'], value: 5 }],
    }
    const c = cloneDoc(d)
    expect(c).toEqual(d)
    c.entities[0]!.id = 'CHANGED'
    ;(c.entities[1] as any).anchors[0] = 'X'
    c.constraints[0]!.refs[0] = 'Y'
    // original untouched
    expect(d.entities[0]!.id).toBe('a')
    expect((d.entities[1] as any).anchors[0]).toBe('a')
    expect(d.constraints[0]!.refs[0]).toBe('a')
  })
})
