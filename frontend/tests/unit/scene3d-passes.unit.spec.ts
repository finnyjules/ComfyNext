import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { fitNearFar, collectEditorHelpers } from '~/lib/scene3d/passes'

describe('scene3d depth range fitting', () => {
  it('brackets the scene bounds from the camera', () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
    const { near, far } = fitNearFar(bounds, new THREE.Vector3(0, 1, 10))
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(10 - 1)   // closest face is ~9 away
    expect(far).toBeGreaterThan(10 + 1) // farthest face is ~11 away
  })
  it('degrades to sane defaults for an empty scene', () => {
    const { near, far } = fitNearFar(new THREE.Box3(), new THREE.Vector3(0, 0, 5))
    expect(near).toBeGreaterThan(0)
    expect(far).toBeGreaterThan(near)
  })
  it('keeps far > near for a zero-extent (point) bounds', () => {
    const p = new THREE.Vector3(0, 0, 0)
    const { near, far } = fitNearFar(new THREE.Box3(p.clone(), p.clone()), new THREE.Vector3(0, 0, 5))
    expect(far).toBeGreaterThan(near)
  })
})

describe('collectEditorHelpers', () => {
  it('collects editor helpers nested under a light group (not just direct children)', () => {
    const scene = new THREE.Scene()
    const group = new THREE.Group(); group.userData.isLight = true
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial())
    marker.userData.isGizmoHelper = true
    group.add(marker)
    scene.add(group)
    const found = collectEditorHelpers(scene)
    expect(found).toContain(marker)
  })
})
