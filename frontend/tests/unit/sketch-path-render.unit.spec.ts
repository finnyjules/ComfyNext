import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { entityPath } from '~/lib/sketch/sketchPath'

function doc(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 4, y: 0 },
      { id: 'c', kind: 'point', x: 4, y: 4 },
      { id: 'ctr', kind: 'point', x: 4, y: 2 },   // center of the b→c arc, r = 2
      { id: 'P', kind: 'path', anchors: ['a', 'b', 'c'], segments: [{ kind: 'line' }, { kind: 'arc', center: 'ctr', sweep: 1 }], closed: false },
    ],
    constraints: [],
  }
}

describe('path rendering', () => {
  it('emits line then arc with radius from the center distance', () => {
    const d = entityPath(doc(), 'P')
    expect(d).toBe('M 0 0 L 4 0 A 2 2 0 0 1 4 4')
  })

  it('closed path emits Z and the wrap-around segment', () => {
    const dd = doc()
    ;(dd.entities.find(e => e.id === 'P') as any).closed = true
    ;(dd.entities.find(e => e.id === 'P') as any).segments = [{ kind: 'line' }, { kind: 'arc', center: 'ctr', sweep: 1 }, { kind: 'line' }]
    const d = entityPath(dd, 'P')
    expect(d).toBe('M 0 0 L 4 0 A 2 2 0 0 1 4 4 L 0 0 Z')
  })

  it('large-arc flag: sweep=0 for the same endpoints takes the long way', () => {
    const dd = doc()
    ;(dd.entities.find(e => e.id === 'P') as any).segments = [{ kind: 'line' }, { kind: 'arc', center: 'ctr', sweep: 0 }]
    // b→c around (4,2): CCW span (sweep-1 frame) is π → not large; the sweep=0 direction traverses 2π−π=π too.
    // Move c to make the spans unequal: c=(6,2) → start angle −90°, end 0° ; ccw span=π/2 ; sweep0 span=3π/2 → large
    ;(dd.entities.find(e => e.id === 'c') as any).x = 6
    ;(dd.entities.find(e => e.id === 'c') as any).y = 2
    const d = entityPath(dd, 'P')
    expect(d).toBe('M 0 0 L 4 0 A 2 2 0 1 0 6 2')
  })

  it('degenerate arc (radius ~ 0) falls back to a line', () => {
    const dd = doc()
    const ctr = dd.entities.find(e => e.id === 'ctr') as any
    const b = dd.entities.find(e => e.id === 'b') as any
    ctr.x = b.x; ctr.y = b.y   // center collapsed onto the start anchor
    const d = entityPath(dd, 'P')
    expect(d).toBe('M 0 0 L 4 0 L 4 4')
  })

  it('a dangling anchor makes the path emit nothing', () => {
    const dd = doc()
    ;(dd.entities.find(e => e.id === 'P') as any).anchors = ['a', 'b', 'GONE']
    expect(entityPath(dd, 'P')).toBe('')
  })
})
