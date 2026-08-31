import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { snapPoint, inferCircleTangents } from '~/lib/sketch/infer'

function doc(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 10, y: 0 },
      { id: 'L', kind: 'line', p1: 'a', p2: 'b' },      // x-axis segment
      { id: 'cc', kind: 'point', x: 5, y: 10 },
      { id: 'C', kind: 'circle', center: 'cc', r: 3 },   // circle at (5,10) r3
    ],
    constraints: [],
  }
}

describe('snapPoint', () => {
  it('snaps to a nearby existing point (coincident) with exact coords', () => {
    const r = snapPoint(doc(), 0.2, -0.1)
    expect(r.snap?.kind).toBe('coincident')
    expect(r.snap?.targetId).toBe('a')
    expect(r).toMatchObject({ x: 0, y: 0 })
  })

  it('snaps onto a line (point-on-line) projecting to the line', () => {
    const r = snapPoint(doc(), 4, 0.3) // just above the x-axis, far from endpoints
    expect(r.snap?.kind).toBe('pointOnLine')
    expect(r.snap?.targetId).toBe('L')
    expect(r.y).toBeCloseTo(0, 6)   // projected onto the axis
    expect(r.x).toBeCloseTo(4, 6)
  })

  it('snaps onto a circle (point-on-circle) at the nearest circumference point', () => {
    // near the bottom of circle C (center 5,10 r3 → bottom point (5,7))
    const r = snapPoint(doc(), 5, 7.3)
    expect(r.snap?.kind).toBe('pointOnCircle')
    expect(r.snap?.targetId).toBe('C')
    expect(r.x).toBeCloseTo(5, 6)
    expect(r.y).toBeCloseTo(7, 6)
  })

  it('returns no snap when nothing is within tolerance', () => {
    const r = snapPoint(doc(), 50, 50)
    expect(r.snap).toBeNull()
    expect(r).toMatchObject({ x: 50, y: 50 })
  })

  it('snaps to a construction point (a guide) same as any other point', () => {
    // construction points are now only guides placed via Guide mode
    // (sketch-draw.vue) — the old pen/smooth-handle exclusion is retired, so
    // a guide point is a full coincident snap target.
    const d = doc()
    d.entities.push({ id: 'h', kind: 'point', x: 20, y: 20, construction: true })
    const r = snapPoint(d, 20.2, 19.9)
    expect(r.snap?.kind).toBe('coincident')
    expect(r.snap?.targetId).toBe('h')
  })
})

describe('inferCircleTangents', () => {
  it('detects tangency to a line when |perpDist - r| is tiny', () => {
    // a circle centered at (5,3) radius 3 is tangent to the x-axis line L
    const t = inferCircleTangents(doc(), 5, 3, 3)
    expect(t.some(x => x.kind === 'tangentLineCircle' && x.targetId === 'L')).toBe(true)
  })

  it('detects external tangency to another circle', () => {
    // existing C at (5,10) r3; a new circle at (5,16) r3 → centers 6 apart = 3+3 → tangent
    const t = inferCircleTangents(doc(), 5, 16, 3)
    expect(t.some(x => x.kind === 'tangentCircleCircle' && x.targetId === 'C')).toBe(true)
  })

  it('returns nothing when clearly not tangent', () => {
    expect(inferCircleTangents(doc(), 50, 50, 1)).toEqual([])
  })
})
