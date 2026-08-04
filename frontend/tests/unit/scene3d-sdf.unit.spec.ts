import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { buildTriGrid } from '~/lib/scene3d/voxel/triGrid'
import { buildSdf, latticeFor } from '~/lib/scene3d/voxel/sdf'

const sdfOf = (geo: THREE.BufferGeometry, res = 48) => {
  const grid = buildTriGrid(meshDataFromGeometry(geo), 2 / res)
  return buildSdf(grid, latticeFor(grid, res))
}

const sample = (sdf: any, x: number, y: number, z: number) => {
  const i = Math.round((x - sdf.min[0]) / sdf.cell)
  const j = Math.round((y - sdf.min[1]) / sdf.cell)
  const k = Math.round((z - sdf.min[2]) / sdf.cell)
  return sdf.values[(k * sdf.dims[1] + j) * sdf.dims[0] + i]
}

describe('signed distance field', () => {
  it('signs a closed sphere: negative inside, positive outside', () => {
    const { sdf, open } = sdfOf(new THREE.SphereGeometry(0.5, 64, 48))
    expect(open).toBe(false)
    expect(sample(sdf, 0, 0, 0)).toBeLessThan(0)
    // Just outside the surface, not far outside: at res=48 with a 2-node
    // padding margin the lattice only reaches to ~0.542 from the sphere's
    // center (measured), so 0.9 lies off the sampled domain entirely and
    // sample()'s unchecked flat-index math wraps to an unrelated interior
    // node instead of erroring. 0.53 is outside the r=0.5 surface and inside
    // the lattice.
    expect(sample(sdf, 0.53, 0, 0)).toBeGreaterThan(0)
  })

  it('signs a closed box', () => {
    const { sdf, open } = sdfOf(new THREE.BoxGeometry(1, 1, 1))
    expect(open).toBe(false)
    expect(sample(sdf, 0, 0, 0)).toBeLessThan(0)
  })

  it('detects an open plane rather than producing garbage', () => {
    const { open } = sdfOf(new THREE.PlaneGeometry(1, 1))
    expect(open).toBe(true)
  })

  it('detects an open-ended cylinder', () => {
    const { open } = sdfOf(new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1, true))
    expect(open).toBe(true)
  })

  it('detects a ring', () => {
    const { open } = sdfOf(new THREE.RingGeometry(0.22, 0.5, 48))
    expect(open).toBe(true)
  })

  it('does NOT call a thin closed shape open', () => {
    // A torus is closed but its interior is a small fraction of its bounding
    // box. An open test that compared interior against total VOLUME would call
    // this open; comparing against the surface band is what gets it right.
    // Same shape of case as a solidified plane (Task 9).
    const { open } = sdfOf(new THREE.TorusGeometry(0.4, 0.08, 24, 64), 64)
    expect(open).toBe(false)
  })
})
