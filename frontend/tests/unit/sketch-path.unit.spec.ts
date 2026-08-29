import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { entityPath, sketchPathData } from '~/lib/sketch/sketchPath'

const doc: SketchDoc = {
  entities: [
    { id: 'a', kind: 'point', x: 0, y: 0 },
    { id: 'b', kind: 'point', x: 10, y: 0 },
    { id: 'cc', kind: 'point', x: 5, y: 5 },
    { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
    { id: 'C', kind: 'circle', center: 'cc', r: 3 },
    { id: 'G', kind: 'line', p1: 'a', p2: 'cc', construction: true },
  ],
  constraints: [],
}

describe('sketch path', () => {
  it('emits a line as M…L', () => {
    expect(entityPath(doc, 'L')).toBe('M 0 0 L 10 0')
  })
  it('emits a circle as two half-arcs', () => {
    // center (5,5) r=3 → left point (2,5), right point (8,5)
    expect(entityPath(doc, 'C')).toBe('M 2 5 A 3 3 0 0 1 8 5 A 3 3 0 0 1 2 5 Z')
  })
  it('a point emits nothing', () => {
    expect(entityPath(doc, 'a')).toBe('')
  })
  it('excludes construction geometry by default, includes on request', () => {
    const def = sketchPathData(doc)
    expect(def).toContain('M 0 0 L 10 0')      // L rendered
    expect(def).not.toContain('M 0 0 L 5 5')   // G (construction) hidden
    const withC = sketchPathData(doc, { includeConstruction: true })
    expect(withC).toContain('M 0 0 L 5 5')     // G now present
  })
})
