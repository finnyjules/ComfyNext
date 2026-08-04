import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  encodeMesh, meshDataFromGeometry, contentDigest,
  MESH_VERTEX_CAP, MESH_DEFAULT_TARGET,
} from '~/lib/scene3d/mesh'
import { remesh } from '~/lib/scene3d/voxel'
import { solidify } from '~/lib/scene3d/voxel/solidify'
import { remeshObject, resolutionForTarget } from '~/lib/scene3d/toMesh'
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
