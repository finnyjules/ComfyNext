// Codec round-trip + size budget. Pure data, no WebGL — runs in the node env.
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  encodeMesh, decodeMesh, meshDataFromGeometry, geometryFromMeshData,
  MESH_VERTEX_CAP, MESH_DEFAULT_TARGET,
} from '~/lib/scene3d/mesh'

describe('mesh codec', () => {
  it('round-trips positions within the quantisation bound', async () => {
    const geo = new THREE.SphereGeometry(0.5, 32, 24)
    const src = meshDataFromGeometry(geo)
    const back = await decodeMesh(await encodeMesh(src))

    expect(back.positions.length).toBe(src.positions.length)
    expect(Array.from(back.indices)).toEqual(Array.from(src.indices))

    // uint16 over a bbox of extent 1.0 → worst-case error 1/65535 per axis.
    // Allow 2x that for float32 rounding on the way back out.
    let worst = 0
    for (let i = 0; i < src.positions.length; i++) {
      worst = Math.max(worst, Math.abs(back.positions[i]! - src.positions[i]!))
    }
    expect(worst).toBeLessThan(2 / 65535)
  })

  it('round-trips through a THREE geometry with normals recomputed', async () => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const data = meshDataFromGeometry(geo)
    const rebuilt = geometryFromMeshData(data)
    expect(rebuilt.getAttribute('position').count).toBe(data.positions.length / 3)
    expect(rebuilt.getAttribute('normal')).toBeTruthy()
    expect(rebuilt.index).toBeTruthy()
  })

  it('delta-encodes: a 26k-vertex sphere stays under 120KB of base64', async () => {
    // The load-bearing assertion. Plain uint16+deflate measures ~450KB here;
    // if someone drops the delta+varint stage this test is what catches it.
    const geo = new THREE.SphereGeometry(0.5, 196, 130)
    const encoded = await encodeMesh(meshDataFromGeometry(geo))
    expect(encoded.length).toBeLessThan(120 * 1024)
  })

  it('rejects a mesh over the vertex cap', async () => {
    const positions = new Float32Array((MESH_VERTEX_CAP + 1) * 3)
    await expect(encodeMesh({ positions, indices: new Uint32Array(0) }))
      .rejects.toThrow(/vertex cap/i)
  })

  it('exposes a default target below the cap', () => {
    expect(MESH_DEFAULT_TARGET).toBeLessThan(MESH_VERTEX_CAP)
  })
})
