import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry, type MeshData } from '~/lib/scene3d/mesh'
import { mergeMeshes } from '~/lib/scene3d/voxel/merge'

const RES = 56
/** Two unit spheres overlapping by half a radius along X. */
const ball = (x: number) =>
  meshDataFromGeometry(new THREE.SphereGeometry(0.5, 48, 32).translate(x, 0, 0))

const volumeOf = (d: MeshData): number => {
  let v = 0
  const p = d.positions, ix = d.indices
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i]! * 3, b = ix[i + 1]! * 3, c = ix[i + 2]! * 3
    v += (
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!)
      - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!)
      + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)
    ) / 6
  }
  return Math.abs(v)
}

/** Number of connected components over the triangle adjacency. */
const components = (d: MeshData): number => {
  const n = d.positions.length / 3
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]! } return x }
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (let i = 0; i < d.indices.length; i += 3) {
    join(d.indices[i]!, d.indices[i + 1]!)
    join(d.indices[i + 1]!, d.indices[i + 2]!)
  }
  const roots = new Set<number>()
  for (let i = 0; i < n; i++) roots.add(find(i))
  return roots.size
}

const SPHERE_VOL = (4 / 3) * Math.PI * 0.5 ** 3

describe('merge', () => {
  it('union of two overlapping spheres is ONE connected body', () => {
    // Two components would mean the fields were never combined — the single
    // most likely way to get a merge that "looks fine" but did nothing.
    const { data, open } = mergeMeshes([ball(-0.25), ball(0.25)], 'union', 0, RES)
    expect(open).toBe(false)
    expect(components(data)).toBe(1)
  })

  it('union volume exceeds either input but is less than their sum', () => {
    // Less than the sum, because they overlap — a naive concatenation of the
    // two meshes would pass "greater than either" and fail this.
    const { data } = mergeMeshes([ball(-0.25), ball(0.25)], 'union', 0, RES)
    const v = volumeOf(data)
    expect(v).toBeGreaterThan(SPHERE_VOL * 1.1)
    expect(v).toBeLessThan(SPHERE_VOL * 2)
  })

  it('subtract removes material from the base', () => {
    const { data } = mergeMeshes([ball(-0.25), ball(0.25)], 'subtract', 0, RES)
    expect(volumeOf(data)).toBeLessThan(SPHERE_VOL * 0.95)
  })

  it('intersect keeps only the overlap', () => {
    const { data } = mergeMeshes([ball(-0.25), ball(0.25)], 'intersect', 0, RES)
    const v = volumeOf(data)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(SPHERE_VOL * 0.75)
  })

  it('blend adds material at the join', () => {
    const sharp = volumeOf(mergeMeshes([ball(-0.3), ball(0.3)], 'union', 0, RES).data)
    const filleted = volumeOf(mergeMeshes([ball(-0.3), ball(0.3)], 'union', 0.15, RES).data)
    expect(filleted).toBeGreaterThan(sharp)
  })

  it('refuses when any input is open', () => {
    const plane = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1))
    const out = mergeMeshes([ball(0), plane], 'union', 0, RES)
    expect(out.open).toBe(true)
  })

  it('subtract is order-sensitive — the first input is the base', () => {
    const a = volumeOf(mergeMeshes([ball(-0.25), ball(0.25)], 'subtract', 0, RES).data)
    const b = volumeOf(mergeMeshes([ball(0.25), ball(-0.25)], 'subtract', 0, RES).data)
    expect(a).toBeCloseTo(b, 1) // symmetric shapes, so volumes match...
    // ...but the results occupy different halves of space.
    const ca = mergeMeshes([ball(-0.25), ball(0.25)], 'subtract', 0, RES).data
    const cb = mergeMeshes([ball(0.25), ball(-0.25)], 'subtract', 0, RES).data
    const meanX = (d: MeshData) => {
      let s = 0
      for (let i = 0; i < d.positions.length; i += 3) s += d.positions[i]!
      return s / (d.positions.length / 3)
    }
    expect(meanX(ca)).toBeLessThan(meanX(cb))
  }, 20000) // 4 merges at res 56 in one test — comfortably over the 5s default
})
