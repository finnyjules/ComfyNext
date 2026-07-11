import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { gemPoints } from './points'
import { xmur3, mulberry32 } from './rng'
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

/**
 * ConvexGeometry (used for Gem mode) only sets `position` + `normal` — no `uv` —
 * so a Surface-fill MeshBasicMaterial with a `map` has nothing to sample and every
 * fragment reads UV (0,0), rendering as one flat texel instead of the mapped fill.
 * Backfill a simple planar (front-facing XY, normalized to the shape's own bounds)
 * UV so gradients/patterns sweep across the gem like they do on primitives.
 */
function ensureUV(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute('uv')) return
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i)
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1
  const uv = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    uv[i * 2] = (pos.getX(i) - minX) / spanX
    uv[i * 2 + 1] = (pos.getY(i) - minY) / spanY
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/**
 * Seeded vertex jitter. Offsets each vertex by a small random amount so clean primitives
 * turn crumpled/organic. The offset is a hash of the vertex's ORIGINAL (rounded) position +
 * seed, so vertices that were coincident get the SAME offset and the non-indexed mesh doesn't
 * tear at shared corners. Amount scales with the shape's own size. No-op at jitter 0.
 */
function applyJitter(geo: THREE.BufferGeometry, config: ShapeConfig): void {
  const amt = (config.shape.jitter || 0) / 100
  if (amt <= 0) return
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  geo.computeBoundingSphere()
  const maxOff = amt * (geo.boundingSphere?.radius || 1) * 0.35
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    // quantize to group coincident verts, then hash → a stable per-position offset
    const key = `${config.seed}|${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
    const rnd = mulberry32(xmur3(key))
    pos.setXYZ(i, x + (rnd() * 2 - 1) * maxOff, y + (rnd() * 2 - 1) * maxOff, z + (rnd() * 2 - 1) * maxOff)
  }
  pos.needsUpdate = true
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
  applyJitter(flat, config)          // perturb before normals/center so both reflect the jitter
  flat.computeVertexNormals()
  flat.center()
  ensureUV(flat)
  return flat
}
