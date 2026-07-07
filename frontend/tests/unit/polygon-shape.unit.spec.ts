import { describe, it, expect } from 'vitest'
import {
  createPolygonLayer, createStarLayer, shapeToPathLayer,
} from '~/composables/useCompositorLayers'

describe('createPolygonLayer', () => {
  it('has parametric defaults (6 sides, sharp)', () => {
    const p = createPolygonLayer()
    expect(p.kind).toBe('polygon')
    expect(p.sides).toBe(6)
    expect(p.cornerRadius).toBe(0)
    expect(p.w).toBeGreaterThan(0)
    expect(p.h).toBeGreaterThan(0)
  })
  it('honors partial overrides', () => {
    const p = createPolygonLayer({ sides: 3, cornerRadius: 0.4 })
    expect(p.sides).toBe(3)
    expect(p.cornerRadius).toBe(0.4)
  })
})

describe('createStarLayer', () => {
  it('has parametric defaults (5 points, innerRatio 0.5)', () => {
    const s = createStarLayer()
    expect(s.kind).toBe('star')
    expect(s.points).toBe(5)
    expect(s.innerRatio).toBe(0.5)
    expect(s.cornerRadius).toBe(0)
  })
})

describe('shapeToPathLayer for polygon/star', () => {
  it('converts a polygon to a path layer carrying a derived d', () => {
    const path = shapeToPathLayer(createPolygonLayer({ sides: 4 }))
    expect(path).not.toBeNull()
    expect(path!.kind).toBe('path')
    expect(path!.d.length).toBeGreaterThan(0)
    expect(path!.bbox.w).toBeCloseTo(0.24, 5)
  })
  it('converts a star to a path layer', () => {
    const path = shapeToPathLayer(createStarLayer({ points: 5 }))
    expect(path).not.toBeNull()
    expect(path!.kind).toBe('path')
    expect(path!.d.includes('Q') || path!.d.includes('L')).toBe(true)
  })
})
