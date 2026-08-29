import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { freshId } from '~/lib/sketch/ids'
import { addPoint, addLine, addCircle, addConstraint, removeConstraint, deleteEntity } from '~/lib/sketch/edit'

const emptyDoc = (): SketchDoc => ({ entities: [], constraints: [] })

describe('freshId', () => {
  it('never collides with existing ids and is deterministic', () => {
    const d = emptyDoc()
    const a = freshId(d); d.entities.push({ id: a, kind: 'point', x: 0, y: 0 })
    const b = freshId(d)
    expect(b).not.toBe(a)
    // deterministic: same doc state → same next id
    const d2 = emptyDoc(); d2.entities.push({ id: a, kind: 'point', x: 0, y: 0 })
    expect(freshId(d2)).toBe(b)
  })
})

describe('authoring ops', () => {
  it('adds points, a line, a circle, and a constraint', () => {
    const d = emptyDoc()
    const p1 = addPoint(d, 0, 0)
    const p2 = addPoint(d, 10, 0)
    const L = addLine(d, p1, p2)
    const pc = addPoint(d, 5, 5)
    const C = addCircle(d, pc, 3)
    const k = addConstraint(d, 'tangentLineCircle', [L, C])
    expect(d.entities.map(e => e.kind)).toEqual(['point', 'point', 'line', 'point', 'circle'])
    expect(d.constraints).toHaveLength(1)
    expect(d.constraints[0]).toMatchObject({ id: k, kind: 'tangentLineCircle', refs: [L, C] })
  })

  it('removeConstraint drops just that constraint', () => {
    const d = emptyDoc()
    const p1 = addPoint(d, 0, 0), p2 = addPoint(d, 1, 1)
    const k = addConstraint(d, 'coincident', [p1, p2])
    removeConstraint(d, k)
    expect(d.constraints).toHaveLength(0)
    expect(d.entities).toHaveLength(2) // entities untouched
  })

  it('deleteEntity on a point cascades to dependent line + constraints', () => {
    const d = emptyDoc()
    const p1 = addPoint(d, 0, 0), p2 = addPoint(d, 10, 0)
    const L = addLine(d, p1, p2)
    addConstraint(d, 'horizontal', [L])
    deleteEntity(d, p1)
    // p1 gone, the line that referenced it gone, the constraint on that line gone
    expect(d.entities.find(e => e.id === p1)).toBeUndefined()
    expect(d.entities.find(e => e.id === L)).toBeUndefined()
    expect(d.entities.find(e => e.id === p2)).toBeDefined() // unrelated point stays
    expect(d.constraints).toHaveLength(0)
  })

  it('deleteEntity on a circle removes its constraints but keeps its center point', () => {
    const d = emptyDoc()
    const pc = addPoint(d, 5, 5)
    const C = addCircle(d, pc, 3)
    addConstraint(d, 'radius', [C], 3)
    deleteEntity(d, C)
    expect(d.entities.find(e => e.id === C)).toBeUndefined()
    expect(d.entities.find(e => e.id === pc)).toBeDefined() // center point not auto-removed
    expect(d.constraints).toHaveLength(0)
  })
})
