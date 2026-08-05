import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  encodeMesh, meshDataFromGeometry, contentDigest,
  MESH_VERTEX_CAP, MESH_DEFAULT_TARGET,
} from '~/lib/scene3d/mesh'
import { remesh } from '~/lib/scene3d/voxel'
import { solidify } from '~/lib/scene3d/voxel/solidify'
import { remeshObject, remeshMeshData, resolutionForTarget, REMESH_RESOLUTION_MAX } from '~/lib/scene3d/toMesh'
import type { PrimitiveObject } from '~/lib/scene3d/config'

const meshObject = async (geo: THREE.BufferGeometry): Promise<PrimitiveObject> => {
  const encoded = await encodeMesh(meshDataFromGeometry(geo))
  return {
    id: 'm1', name: 'M', visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: {} as any, kind: 'primitive', primitive: 'mesh',
    content: { mesh: encoded, meshKey: contentDigest(encoded) },
  }
}

describe('remesh action', () => {
  it('resolutionForTarget lands near the requested vertex count', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    const res = resolutionForTarget(src, MESH_DEFAULT_TARGET)
    const got = remesh(src, res).data.positions.length / 3
    expect(got).toBeGreaterThan(MESH_DEFAULT_TARGET * 0.65)
    expect(got).toBeLessThan(MESH_DEFAULT_TARGET * 1.35)
  }, 30_000)

  it('resolutionForTarget scales with the target', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    expect(resolutionForTarget(src, 20_000)).toBeGreaterThan(resolutionForTarget(src, 5_000))
  })

  it('resolutionForTarget never exceeds the Remesh slider\'s own max (Finding 3)', () => {
    // Before this fix, resolutionForTarget's internal ceiling (160) was
    // independent of — and 32 past — the slider's declared max (128): the
    // thumb pinned at 128 while the readout showed 160, and the first touch
    // of the slider silently, irreversibly dropped the real resolution to
    // 128. An ordinary open plane hit this by default, not as an edge case.
    const plane = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1, 8, 8))
    const sphere = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    // A generous target so the un-clamped formula would ask for far more
    // than the slider (and the vertex cap) allow.
    expect(resolutionForTarget(plane, MESH_VERTEX_CAP)).toBeLessThanOrEqual(REMESH_RESOLUTION_MAX)
    expect(resolutionForTarget(sphere, MESH_VERTEX_CAP)).toBeLessThanOrEqual(REMESH_RESOLUTION_MAX)
  })

  it('remeshes a closed object into a different buffer', async () => {
    const obj = await meshObject(new THREE.SphereGeometry(0.5, 64, 48))
    const before = obj.content!.meshKey
    const out = await remeshObject(obj, 48)
    expect(out.open).toBe(false)
    expect(out.obj.content!.meshKey).not.toBe(before)
    expect(out.obj.content!.meshKey).toBe(contentDigest(out.obj.content!.mesh!))
  })

  it('refuses an open object and leaves its buffer untouched', async () => {
    const obj = await meshObject(new THREE.PlaneGeometry(1, 1))
    const before = obj.content!.mesh
    const out = await remeshObject(obj, 48)
    expect(out.open).toBe(true)
    expect(out.obj.content!.mesh).toBe(before)
  })

  it('solidify closes an open surface so it can then be remeshed', () => {
    const plane = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1, 8, 8))
    expect(remesh(plane, 48).open).toBe(true)
    const shell = solidify(plane, 0.05)
    expect(remesh(shell, 64).open).toBe(false)
  })

  it('solidify roughly doubles the triangle count plus a rim', () => {
    const plane = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1, 8, 8))
    const shell = solidify(plane, 0.05)
    expect(shell.indices.length).toBeGreaterThan(plane.indices.length * 2)
    expect(shell.positions.length).toBe(plane.positions.length * 2)
  })

  it('does not double the rim on a UV-seamed open cylinder (Finding 2)', () => {
    // three.js's CylinderGeometry duplicates the vertex where its UV wraps
    // around (same position, different index), so an index-pair boundary
    // test sees the seam's shared edge twice — once per duplicate index —
    // and detects 26 boundary edges instead of the true 24 (12 on the top
    // rim, 12 on the bottom; caps are off via the `openEnded` argument).
    // Welding on position before detecting boundaries is what collapses
    // that back to 24.
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true)
    const cyl = meshDataFromGeometry(geo)
    const shell = solidify(cyl, 0.05)
    const baseTriCount = cyl.indices.length / 3
    const rimTriCount = shell.indices.length / 3 - 2 * baseTriCount
    // Two rim triangles (one quad) per boundary edge.
    expect(rimTriCount % 2).toBe(0)
    expect(rimTriCount / 2).toBe(24)
  })

  it('remeshMeshData (Gap 4: in-panel Remesh) works directly off raw MeshData, matching remeshObject', async () => {
    // The sculpt panel's in-session Remesh calls this directly against
    // SculptSession.toMeshData() — the LIVE working buffer, not
    // obj.content.mesh (the doc's stale pre-sculpt copy). Asserts the raw
    // entry point behaves the same as remeshObject's doc-object wrapper.
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    const out = await remeshMeshData(src, 48)
    expect(out.open).toBe(false)
    expect(out.vertexCount).toBe(out.data.positions.length / 3)
    expect(out.data.positions).not.toEqual(src.positions)
  })

  it('remeshMeshData refuses an open buffer and leaves it UNCHANGED (same object reference)', async () => {
    const src = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1))
    const out = await remeshMeshData(src, 48)
    expect(out.open).toBe(true)
    expect(out.data).toBe(src) // unchanged, not just equal — a careless caller can't commit a mangled mesh
  })

  it('retries at a lower resolution rather than throwing over the cap', async () => {
    const obj = await meshObject(new THREE.SphereGeometry(0.5, 64, 48))
    // 256 would produce far more than MESH_VERTEX_CAP vertices. This walks the
    // full retry ladder (256, 192, 144, 108 all stay over cap for this input,
    // so it falls through to the res-8 floor) — four full O(resolution^3)
    // remeshes, which is genuinely slow, not a hang. Long timeout on purpose.
    const out = await remeshObject(obj, 256)
    expect(out.open).toBe(false)
    expect(out.vertexCount).toBeLessThanOrEqual(MESH_VERTEX_CAP)
  }, 300_000)
})
