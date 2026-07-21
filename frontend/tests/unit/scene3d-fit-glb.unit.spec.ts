import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { fitGlbGroup } from '~/lib/scene3d/fitGlb'

describe('fitGlbGroup', () => {
  it('scales a large off-centre mesh down to ~1.5 units and recentres it', () => {
    const group = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6))
    mesh.position.set(50, 20, -30) // arbitrary offset + scale, like a generated GLB
    group.add(mesh)
    fitGlbGroup(group, 1.5)
    const box = new THREE.Box3().setFromObject(group)
    const size = box.getSize(new THREE.Vector3())
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(1.5, 1)
    const center = box.getCenter(new THREE.Vector3())
    expect(Math.abs(center.x)).toBeLessThan(0.01)
    expect(Math.abs(center.z)).toBeLessThan(0.01)
    expect(box.min.y).toBeCloseTo(0, 1) // base on the ground
  })

  it('is a no-op-safe on an empty group', () => {
    expect(() => fitGlbGroup(new THREE.Group())).not.toThrow()
  })
})
