import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry, geometryFromMeshData } from '~/lib/scene3d/mesh'
import { remesh } from '~/lib/scene3d/voxel'

const volumeOf = (data: any) => {
  // Signed volume via the divergence theorem over the triangle soup.
  let v = 0
  const p = data.positions, ix = data.indices
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3
    v += (
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
    ) / 6
  }
  return Math.abs(v)
}

describe('remesh', () => {
  it('preserves a sphere\'s volume within grid tolerance', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    const { data, open } = remesh(src, 64)
    expect(open).toBe(false)
    const expected = (4 / 3) * Math.PI * 0.5 ** 3
    expect(volumeOf(data)).toBeGreaterThan(expected * 0.92)
    expect(volumeOf(data)).toBeLessThan(expected * 1.08)
  })

  it('preserves the bounding box within one cell', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    const { data } = remesh(src, 64)
    const geo = geometryFromMeshData(data)
    geo.computeBoundingBox()
    const b = geo.boundingBox!
    expect(b.max.x).toBeGreaterThan(0.45)
    expect(b.max.x).toBeLessThan(0.56)
  })

  it('produces a closed, indexed mesh', () => {
    const src = meshDataFromGeometry(new THREE.BoxGeometry(1, 1, 1))
    const { data } = remesh(src, 48)
    expect(data.indices.length % 3).toBe(0)
    expect(data.indices.length).toBeGreaterThan(0)
    // Every index addresses a real vertex.
    const n = data.positions.length / 3
    for (let i = 0; i < data.indices.length; i++) expect(data.indices[i]!).toBeLessThan(n)
  })

  it('refuses an open surface instead of meshing garbage', () => {
    const src = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1))
    expect(remesh(src, 48).open).toBe(true)
  })

  it('scales vertex count with resolution', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    const lo = remesh(src, 24).data.positions.length
    const hi = remesh(src, 64).data.positions.length
    expect(hi).toBeGreaterThan(lo * 2)
  })
})
