import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { buildTriGrid, closestDistance, raycastGrid } from '~/lib/scene3d/voxel/triGrid'

const sphereGrid = (cell = 0.05) =>
  buildTriGrid(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48)), cell)

describe('triangle grid', () => {
  it('measures distance to a unit sphere surface analytically', () => {
    const g = sphereGrid()
    // A point on the +X axis at r=0.8 is 0.3 from a sphere of radius 0.5.
    expect(closestDistance(g, 0.8, 0, 0, 2)).toBeCloseTo(0.3, 2)
    // Dead centre is 0.5 from the surface.
    expect(closestDistance(g, 0, 0, 0, 2)).toBeCloseTo(0.5, 2)
  })

  it('returns the search radius when nothing is within it', () => {
    const g = sphereGrid()
    expect(closestDistance(g, 50, 50, 50, 1)).toBe(1)
  })

  it('raycasts onto the surface at the analytic distance', () => {
    const g = sphereGrid()
    const hit = raycastGrid(g, [3, 0, 0], [-1, 0, 0])
    expect(hit).not.toBeNull()
    expect(hit!.t).toBeCloseTo(2.5, 2) // 3 - 0.5
  })

  it('misses cleanly when the ray passes by', () => {
    const g = sphereGrid()
    expect(raycastGrid(g, [3, 5, 0], [-1, 0, 0])).toBeNull()
  })
})
