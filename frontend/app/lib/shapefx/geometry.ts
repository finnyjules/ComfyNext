import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { gemPoints } from './points'
import type { ShapeConfig, PrimitiveKind } from './config'

// Facet density 0–4 → segment counts. Low = chunky facets, high = fine.
const SEG = [3, 4, 6, 12, 24]
const seg = (density: number) => SEG[Math.max(0, Math.min(SEG.length - 1, Math.round(density)))]!

function primitiveGeometry(kind: PrimitiveKind, density: number): THREE.BufferGeometry {
  const s = seg(density)
  switch (kind) {
    case 'cube':         return new THREE.BoxGeometry(2, 2, 2)
    case 'sphere':       return new THREE.IcosahedronGeometry(1.4, Math.max(0, Math.min(4, Math.round(density)))) // faceted sphere; clamp detail 0–4
    case 'cone':         return new THREE.ConeGeometry(1.3, 2.4, Math.max(3, s))
    case 'cylinder':     return new THREE.CylinderGeometry(1.1, 1.1, 2.4, Math.max(3, s))
    case 'prism':        return new THREE.CylinderGeometry(1.3, 1.3, 2.4, 3) // triangular prism
    case 'torus':        return new THREE.TorusGeometry(1.1, 0.45, Math.max(3, s), Math.max(3, s * 2))
    case 'icosahedron':  return new THREE.IcosahedronGeometry(1.4, 0)
    case 'octahedron':   return new THREE.OctahedronGeometry(1.5, 0)
  }
}

/** Build the render geometry for a config. Non-indexed → flat/crisp facets. */
export function buildGeometry(config: ShapeConfig): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry
  if (config.shape.mode === 'gem') {
    const raw = gemPoints(config).map(([x, y, z]) => new THREE.Vector3(x, y, z))
    try {
      geo = new ConvexGeometry(raw)
      if (geo.getAttribute('position').count < 12) throw new Error('degenerate hull')
    } catch {
      geo = new THREE.TetrahedronGeometry(1.4, 0) // guaranteed solid fallback
    }
  } else {
    geo = primitiveGeometry(config.shape.primitive, config.shape.density)
  }
  // Flatten to non-indexed so each triangle owns distinct vertices → hard facet edges
  // and independent per-vertex colors. ConvexGeometry is already non-indexed; toNonIndexed
  // is a no-op cost there but harmless.
  const flat = geo.index ? geo.toNonIndexed() : geo
  if (flat !== geo) geo.dispose()
  flat.computeVertexNormals()
  flat.center()
  return flat
}
