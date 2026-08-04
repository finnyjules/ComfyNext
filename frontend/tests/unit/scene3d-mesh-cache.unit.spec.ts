import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { encodeMesh, meshDataFromGeometry, contentDigest } from '~/lib/scene3d/mesh'
import { meshCacheGet, loadMesh, meshCacheClear } from '~/lib/scene3d/meshCache'
import { geometryFor, geoKeyFor } from '~/lib/scene3d/engine'
import type { PrimitiveObject } from '~/lib/scene3d/config'

const objWith = (mesh: string): PrimitiveObject => ({
  id: 'm', name: 'M', visible: true,
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  material: {} as any, kind: 'primitive', primitive: 'mesh',
  content: { mesh, meshKey: contentDigest(mesh) },
})

describe('mesh cache', () => {
  beforeEach(() => { meshCacheClear() })

  it('misses before load and hits after', async () => {
    const encoded = await encodeMesh(meshDataFromGeometry(new THREE.BoxGeometry(1, 1, 1)))
    const key = contentDigest(encoded)
    expect(meshCacheGet(key)).toBeNull()
    await loadMesh(encoded, key)
    expect(meshCacheGet(key)).not.toBeNull()
  })

  it('geometryFor returns a placeholder on a cache miss, real geometry on a hit', async () => {
    const encoded = await encodeMesh(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 32, 24)))
    const key = contentDigest(encoded)

    const placeholder = geometryFor('mesh', undefined, { mesh: encoded, meshKey: key })
    expect(placeholder.getAttribute('position').count).toBeLessThan(50) // the placeholder box

    await loadMesh(encoded, key)
    const real = geometryFor('mesh', undefined, { mesh: encoded, meshKey: key })
    expect(real.getAttribute('position').count).toBeGreaterThan(500)
  })

  it('geoKeyFor keys on meshKey, never on the payload', async () => {
    // A multi-KB payload must not reach the key — it is rebuilt on every sync
    // for every object, and stringifying it would put tens of KB of string work
    // on the drag path.
    const encoded = await encodeMesh(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48)))
    const key = geoKeyFor(objWith(encoded), 'smooth')
    expect(key).toContain(contentDigest(encoded))
    expect(key).not.toContain(encoded.slice(0, 64))
    expect(key.length).toBeLessThan(400)
  })
})
