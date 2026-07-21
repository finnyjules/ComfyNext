import * as THREE from 'three'

/** Normalize a freshly-loaded (generated) GLB so it sits sensibly in the scene:
 *  uniform-scaled so its largest dimension ≈ targetSize, centred on X/Z, base on
 *  the y=0 ground plane. Mutates position/scale on the group. Safe on empty groups. */
export function fitGlbGroup(group: THREE.Object3D, targetSize = 1.5): void {
  const box = new THREE.Box3().setFromObject(group)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  if (maxDim < 1e-6) return
  const s = targetSize / maxDim
  group.scale.multiplyScalar(s)
  // Recompute the box at the new scale, then centre X/Z and drop the base to y=0.
  const scaled = new THREE.Box3().setFromObject(group)
  const c = scaled.getCenter(new THREE.Vector3())
  group.position.x -= c.x
  group.position.z -= c.z
  group.position.y -= scaled.min.y
}
