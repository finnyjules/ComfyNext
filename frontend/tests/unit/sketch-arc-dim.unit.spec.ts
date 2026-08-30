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
