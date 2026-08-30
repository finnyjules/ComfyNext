import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { arcDimensionMarks } from '~/lib/sketch/annotate'

describe('arcDimensionMarks', () => {
  it('emits one R-labeled mark per arc segment, positioned at the arc midpoint', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'ctr', kind: 'point', x: 0, y: 0 },
        { id: 'p0', kind: 'point', x: 5, y: 0 },
        { id: 'p1', kind: 'point', x: 0, y: 5 },
        { id: 'path1', kind: 'path', anchors: ['p0', 'p1'], closed: false,
          segments: [{ kind: 'arc', center: 'ctr', sweep: 0 }] },
      ],
      constraints: [],
    }
    const marks = arcDimensionMarks(doc)
    expect(marks).toHaveLength(1)
    const m = marks[0]!
    expect(m.id).toBe('path1:0')
    expect(m.text).toBe('R 5.0')
    expect(Number.isFinite(m.x)).toBe(true)
    expect(Number.isFinite(m.y)).toBe(true)
    // arc-mid should itself sit exactly on the circle of radius 5 about the center
    expect(Math.hypot(m.x - 0, m.y - 0)).toBeCloseTo(5, 6)
  })

  it('excludes construction paths', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'ctr', kind: 'point', x: 0, y: 0 },
        { id: 'p0', kind: 'point', x: 5, y: 0 },
        { id: 'p1', kind: 'point', x: 0, y: 5 },
        { id: 'path1', kind: 'path', anchors: ['p0', 'p1'], closed: false, construction: true,
          segments: [{ kind: 'arc', center: 'ctr', sweep: 0 }] },
      ],
      constraints: [],
    }
    expect(arcDimensionMarks(doc)).toEqual([])
  })

  it('emits nothing for a line-only path', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'p0', kind: 'point', x: 0, y: 0 },
        { id: 'p1', kind: 'point', x: 5, y: 5 },
        { id: 'path1', kind: 'path', anchors: ['p0', 'p1'], closed: false,
          segments: [{ kind: 'line' }] },
      ],
      constraints: [],
    }
    expect(arcDimensionMarks(doc)).toEqual([])
  })

  it('still produces a mark for a semicircle, where the chord midpoint coincides with the center', () => {
    // anchors (0,0) -> (4,0), center (2,0): the chord midpoint IS the center,
    // which degenerates the old "nudge chord-mid outward" approach (zero-length
    // vector) and used to cause the mark to be skipped entirely.
    const doc: SketchDoc = {
      entities: [
        { id: 'ctr', kind: 'point', x: 2, y: 0 },
        { id: 'p0', kind: 'point', x: 0, y: 0 },
        { id: 'p1', kind: 'point', x: 4, y: 0 },
        { id: 'path1', kind: 'path', anchors: ['p0', 'p1'], closed: false,
          segments: [{ kind: 'arc', center: 'ctr', sweep: 1 }] },
      ],
      constraints: [],
    }
    const marks = arcDimensionMarks(doc)
    expect(marks).toHaveLength(1)
    const m = marks[0]!
    expect(m.text).toBe('R 2.0')
    // mid-angle for sweep=1 from a0=PI (at p0) traveling the positive-angle
    // direction lands the arc mid on the bottom bulge: (2, -2).
    expect(m.x).toBeCloseTo(2, 6)
    expect(m.y).toBeCloseTo(-2, 6)
  })

  it('skips an arc segment whose center point is dangling', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'p0', kind: 'point', x: 5, y: 0 },
        { id: 'p1', kind: 'point', x: 0, y: 5 },
        { id: 'path1', kind: 'path', anchors: ['p0', 'p1'], closed: false,
          segments: [{ kind: 'arc', center: 'GONE', sweep: 0 }] },
      ],
      constraints: [],
    }
    expect(arcDimensionMarks(doc)).toEqual([])
  })
})
