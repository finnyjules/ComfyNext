import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintMarks } from '~/lib/sketch/annotate'

const doc: SketchDoc = {
  entities: [
    { id: 'a', kind: 'point', x: 0, y: 0 },
    { id: 'b', kind: 'point', x: 10, y: 0 },
    { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
    { id: 'cc', kind: 'point', x: 5, y: 3 },
    { id: 'C', kind: 'circle', center: 'cc', r: 3 },
  ],
  constraints: [
    { id: 'k1', kind: 'tangentLineCircle', refs: ['L', 'C'] },
    { id: 'k2', kind: 'radius', refs: ['C'], value: 3 },
    { id: 'k3', kind: 'horizontal', refs: ['L'] },
    { id: 'k4', kind: 'coincident', refs: ['a', 'GONE'] }, // dangling → skipped
  ],
}

describe('constraintMarks', () => {
  it('emits one positioned mark per resolvable constraint', () => {
    const marks = constraintMarks(doc)
    expect(marks.map(m => m.id)).toEqual(['k1', 'k2', 'k3']) // k4 skipped
    const tan = marks.find(m => m.id === 'k1')!
    expect(tan.glyph).toBe('T')
    expect(Number.isFinite(tan.x) && Number.isFinite(tan.y)).toBe(true)
    const rad = marks.find(m => m.id === 'k2')!
    expect(rad.glyph).toBe('R')
    expect(rad.text).toBe('3')
  })
})
