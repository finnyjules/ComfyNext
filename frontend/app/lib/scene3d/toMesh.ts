// Freeze a primitive's built geometry into a `mesh` primitive.
//
// The input is the geometry the engine ALREADY built for this object, so
// modifiers are baked in. That is exactly why `params` and `modifiers` are
// dropped from the result: leaving them would re-apply a twist that is already
// in the vertices.
import type * as THREE from 'three'
import { encodeMesh, meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { contentDigest, type PrimitiveObject } from '~/lib/scene3d/config'

export async function convertToMesh(
  obj: PrimitiveObject,
  geo: THREE.BufferGeometry,
): Promise<PrimitiveObject> {
  const encoded = await encodeMesh(meshDataFromGeometry(geo))
  return {
    id: obj.id,
    name: obj.name,
    visible: obj.visible,
    position: [...obj.position] as PrimitiveObject['position'],
    rotation: [...obj.rotation] as PrimitiveObject['rotation'],
    scale: [...obj.scale] as PrimitiveObject['scale'],
    material: obj.material,
    ...(obj.motion ? { motion: obj.motion } : {}),
    ...(obj.parentId ? { parentId: obj.parentId } : {}),
    kind: 'primitive',
    primitive: 'mesh',
    content: { mesh: encoded, meshKey: contentDigest(encoded) },
  }
}
