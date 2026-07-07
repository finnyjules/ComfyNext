import { describe, it, expect } from 'vitest'
import {
  polygonVertices, starVertices, roundedPolygonPath, polygonPathData, starPathData,
} from '~/lib/compositor/polygonGeometry'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('polygonVertices', () => {
  it('returns `sides` vertices, first at top', () => {
    const v = polygonVertices(4, 2, 2) // rx=ry=1
    expect(v).toHaveLength(4)
    expect(near(v[0].x, 0)).toBe(true)
    expect(near(v[0].y, -1)).toBe(true)   // top
  })
  it('a 4-gon is a diamond on the axes', () => {
    const v = polygonVertices(4, 2, 2)
    expect(near(v[1].x, 1) && near(v[1].y, 0)).toBe(true)   // right
    expect(near(v[2].x, 0) && near(v[2].y, 1)).toBe(true)   // bottom
    expect(near(v[3].x, -1) && near(v[3].y, 0)).toBe(true)  // left
  })
  it('respects the (w/2,h/2) ellipse radii', () => {
    const v = polygonVertices(4, 4, 2) // rx=2, ry=1
    expect(near(v[1].x, 2)).toBe(true)
    expect(near(v[2].y, 1)).toBe(true)
  })
  it('clamps sides below 3 up to 3', () => {
    expect(polygonVertices(2, 2, 2)).toHaveLength(3)
    expect(polygonVertices(4.6, 2, 2)).toHaveLength(5) // rounds
  })
})

describe('starVertices', () => {
  it('returns 2*points vertices, alternating outer/inner radii', () => {
    const v = starVertices(5, 0.5, 2, 2) // outer r=1, inner r=0.5
    expect(v).toHaveLength(10)
    expect(near(Math.hypot(v[0].x, v[0].y), 1)).toBe(true)    // outer
    expect(near(Math.hypot(v[1].x, v[1].y), 0.5)).toBe(true)  // inner
    expect(near(v[0].x, 0) && near(v[0].y, -1)).toBe(true)    // first outer at top
  })
  it('clamps innerRatio into (0.01, 0.99) and points to >=3', () => {
    expect(starVertices(2, 5, 2, 2)).toHaveLength(6) // points clamped to 3 -> 6 verts
    const v = starVertices(4, 5, 2, 2) // innerRatio clamped to 0.99
    expect(Math.hypot(v[1].x, v[1].y)).toBeLessThanOrEqual(0.99 + 1e-9)
  })
})

describe('roundedPolygonPath', () => {
  it('cornerRadius 0 yields a straight M/L/Z path (no arcs)', () => {
    const d = roundedPolygonPath(polygonVertices(4, 2, 2), 0)
    expect(d.startsWith('M ')).toBe(true)
    expect(d.includes('L ')).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
    expect(d.includes('Q')).toBe(false)
  })
  it('cornerRadius > 0 introduces quadratic arcs', () => {
    const d = roundedPolygonPath(polygonVertices(4, 2, 2), 0.5)
    expect(d.includes('Q')).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
  })
  it('returns empty for < 3 vertices', () => {
    expect(roundedPolygonPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.5)).toBe('')
  })
})

describe('polygonPathData / starPathData', () => {
  it('produce non-empty paths for valid sizes', () => {
    expect(polygonPathData(6, 0.24, 0.24, 0).length).toBeGreaterThan(0)
    expect(starPathData(5, 0.5, 0.24, 0.24, 0.2).length).toBeGreaterThan(0)
  })
  it('return empty string when w or h is ~0', () => {
    expect(polygonPathData(6, 0, 0.24, 0)).toBe('')
    expect(starPathData(5, 0.5, 0.24, 0, 0)).toBe('')
  })
})
