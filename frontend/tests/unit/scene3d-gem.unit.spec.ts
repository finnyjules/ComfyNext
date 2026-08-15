import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { gemPoints, gemGeometry } from '~/lib/scene3d/gem'

describe('scene3d gem geometry', () => {
  it('gemPoints is deterministic for a seed', () => {
    const a = gemPoints(16, 0.5, 1, 3)
    const b = gemPoints(16, 0.5, 1, 3)
    expect(a.length).toBe(16)
    expect(a.map(v => [v.x, v.y, v.z])).toEqual(b.map(v => [v.x, v.y, v.z]))
  })

  it('different seeds produce different clouds', () => {
    const a = gemPoints(16, 0.5, 1, 3)
    const b = gemPoints(16, 0.5, 1, 4)
    expect(a.map(v => v.x)).not.toEqual(b.map(v => v.x))
  })

  it('clamps the point count so a junk import cannot hang the hull', () => {
    expect(gemPoints(1e8, 0.5, 1, 0).length).toBeLessThanOrEqual(64)
    expect(gemPoints(0, 0.5, 1, 0).length).toBeGreaterThanOrEqual(4)
  })

  it('gemGeometry returns a solid hull with UVs', () => {
    const geo = gemGeometry(20, 0.6, 1, 1)
    expect(geo.getAttribute('position').count).toBeGreaterThanOrEqual(12)
    expect(geo.getAttribute('uv')).toBeTruthy()
    geo.dispose()
  })

  it('gemGeometry falls back to a tetrahedron on a degenerate cloud', () => {
    // depth 0 + spread 0 collapses points onto a plane → hull degenerates
    const geo = gemGeometry(4, 0, 0, 0)
    expect(geo.getAttribute('position').count).toBeGreaterThanOrEqual(12)
    geo.dispose()
  })
})
