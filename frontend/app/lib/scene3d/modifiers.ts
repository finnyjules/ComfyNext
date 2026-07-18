// Non-destructive geometry modifiers, applied CPU-side to the real vertices.
//
// This is deliberately NOT a vertex shader: passes.ts renders the depth and
// normal outputs with scene.overrideMaterial, so a shader deformation would be
// invisible in two of the three exported images. Raycasting (selection and the
// gizmo), bounding boxes, shadows and the gradient bbox uniforms all read real
// geometry too.
//
// Stage order is fixed: subdivide → taper → twist → bend → noise → array.
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { modifierValue } from '~/lib/scene3d/primParams'

/** Rough ceiling for the final merged geometry. arrayCount is user-visible so it
 *  is never reduced; subdivision stops early instead. */
const VERTEX_BUDGET = 300_000

export function hasModifiers(modifiers: Record<string, number> | undefined): boolean {
  if (!modifiers) return false
  const m = (k: string) => modifierValue(modifiers, k)
  return m('taper') !== 0 || m('twist') !== 0 || m('bend') !== 0 || m('noise') !== 0 || m('arrayCount') > 1
}

// --- deterministic 3D value noise (no dependency, stable across runs) --------

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed, 2654435761)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const smooth = (t: number): number => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number): number => a + (b - a) * t

/** Value noise in [-1, 1]. */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi)
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed)
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), u)
  const x10 = mix(c(0, 1, 0), c(1, 1, 0), u)
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), u)
  const x11 = mix(c(0, 1, 1), c(1, 1, 1), u)
  return mix(mix(x00, x10, v), mix(x01, x11, v), w) * 2 - 1
}

// --- stages ------------------------------------------------------------------

/** Split every triangle into four at its edge midpoints, then re-weld so the
 *  result stays indexed and can still be shaded smoothly. */
function subdivideOnce(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo
  const pos = src.getAttribute('position')
  const uv = src.getAttribute('uv')
  const outPos: number[] = []
  const outUv: number[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const ab = new THREE.Vector3(), bc = new THREE.Vector3(), ca = new THREE.Vector3()
  const push = (v: THREE.Vector3) => { outPos.push(v.x, v.y, v.z) }
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos as THREE.BufferAttribute, i)
    b.fromBufferAttribute(pos as THREE.BufferAttribute, i + 1)
    c.fromBufferAttribute(pos as THREE.BufferAttribute, i + 2)
    ab.addVectors(a, b).multiplyScalar(0.5)
    bc.addVectors(b, c).multiplyScalar(0.5)
    ca.addVectors(c, a).multiplyScalar(0.5)
    push(a); push(ab); push(ca)
    push(ab); push(b); push(bc)
    push(ca); push(bc); push(c)
    push(ab); push(bc); push(ca)
    if (uv) {
      const u0 = uv.getX(i), v0 = uv.getY(i)
      const u1 = uv.getX(i + 1), v1 = uv.getY(i + 1)
      const u2 = uv.getX(i + 2), v2 = uv.getY(i + 2)
      const uab = (u0 + u1) / 2, vab = (v0 + v1) / 2
      const ubc = (u1 + u2) / 2, vbc = (v1 + v2) / 2
      const uca = (u2 + u0) / 2, vca = (v2 + v0) / 2
      outUv.push(u0, v0, uab, vab, uca, vca)
      outUv.push(uab, vab, u1, v1, ubc, vbc)
      outUv.push(uca, vca, ubc, vbc, u2, v2)
      outUv.push(uab, vab, ubc, vbc, uca, vca)
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3))
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2))
  if (src !== geo) src.dispose()
  const welded = mergeVertices(out)
  if (welded !== out) out.dispose()
  return welded
}

/** Per-vertex extent helper: [min, size] along an axis, guarded against zero. */
function extentOf(geo: THREE.BufferGeometry, axis: number): [number, number] {
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  const min = b.min.getComponent(axis)
  const size = b.max.getComponent(axis) - min
  return [min, size > 1e-6 ? size : 1]
}

function applyTaper(geo: THREE.BufferGeometry, amount: number, axis: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const [min, size] = extentOf(geo, axis)
  const p1 = (axis + 1) % 3
  const p2 = (axis + 2) % 3
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getComponent(i, axis) - min) / size          // 0..1
    const s = Math.max(0, 1 + amount * (t - 0.5) * 2)
    pos.setComponent(i, p1, pos.getComponent(i, p1) * s)
    pos.setComponent(i, p2, pos.getComponent(i, p2) * s)
  }
  pos.needsUpdate = true
}

function applyTwist(geo: THREE.BufferGeometry, degrees: number, axis: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const [min, size] = extentOf(geo, axis)
  const p1 = (axis + 1) % 3
  const p2 = (axis + 2) % 3
  const total = (degrees * Math.PI) / 180
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getComponent(i, axis) - min) / size - 0.5     // -0.5..0.5
    const ang = total * t
    const cos = Math.cos(ang), sin = Math.sin(ang)
    const u = pos.getComponent(i, p1), v = pos.getComponent(i, p2)
    pos.setComponent(i, p1, u * cos - v * sin)
    pos.setComponent(i, p2, u * sin + v * cos)
  }
  pos.needsUpdate = true
}

/** Circular bend about `axis`: the shape curves along (axis+2)%3 and bulges
 *  along (axis+1)%3. The centre of the shape stays put. */
function applyBend(geo: THREE.BufferGeometry, degrees: number, axis: number): void {
  const total = (degrees * Math.PI) / 180
  if (Math.abs(total) < 1e-6) return
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const lengthAxis = (axis + 2) % 3
  const bulgeAxis = (axis + 1) % 3
  const [min, size] = extentOf(geo, lengthAxis)
  const centre = min + size / 2
  const radius = size / total
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getComponent(i, lengthAxis) - centre
    const b = pos.getComponent(i, bulgeAxis)
    const phi = s / radius
    const r = radius - b
    pos.setComponent(i, lengthAxis, r * Math.sin(phi))
    pos.setComponent(i, bulgeAxis, radius - r * Math.cos(phi))
  }
  pos.needsUpdate = true
}

function applyNoise(geo: THREE.BufferGeometry, amount: number, scale: number, seed: number): void {
  if (!geo.getAttribute('normal')) geo.computeVertexNormals()
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const d = valueNoise(x * scale, y * scale, z * scale, seed) * amount
    pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d)
  }
  pos.needsUpdate = true
}

function applyArray(
  geo: THREE.BufferGeometry,
  count: number,
  radial: boolean,
  offset: [number, number, number],
  radius: number,
  axis: number,
): THREE.BufferGeometry {
  const copies: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  const spin = new THREE.Matrix4()
  const axisVec = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
  const radialDir = (axis + 1) % 3
  for (let i = 0; i < count; i++) {
    const copy = geo.clone()
    if (radial) {
      const ang = (i / count) * Math.PI * 2
      const out = new THREE.Vector3()
      out.setComponent(radialDir, radius)
      m.makeTranslation(out.x, out.y, out.z)
      spin.makeRotationAxis(axisVec, ang)
      copy.applyMatrix4(spin.multiply(m))
    } else {
      copy.applyMatrix4(m.makeTranslation(offset[0] * i, offset[1] * i, offset[2] * i))
    }
    copies.push(copy)
  }
  const merged = mergeGeometries(copies)
  for (const c of copies) c.dispose()
  // mergeGeometries returns null if the inputs disagree on attributes; the
  // copies are clones of one geometry, so that cannot happen here.
  return merged ?? geo.clone()
}

// --- pipeline ----------------------------------------------------------------

export function applyModifiers(
  geo: THREE.BufferGeometry,
  modifiers: Record<string, number> | undefined,
): THREE.BufferGeometry {
  if (!hasModifiers(modifiers)) return geo
  const m = (k: string) => modifierValue(modifiers, k)

  const taper = m('taper'), twist = m('twist'), bend = m('bend'), noise = m('noise')
  const count = Math.round(m('arrayCount'))
  const deforms = taper !== 0 || twist !== 0 || bend !== 0 || noise !== 0

  let out = geo.clone()

  // Subdivision only earns its vertices when something deforms them, and it
  // yields to the budget so a dense shape in a big array cannot freeze the app.
  if (deforms) {
    const iterations = Math.round(m('subdivide'))
    const ceiling = VERTEX_BUDGET / Math.max(1, count)
    for (let i = 0; i < iterations; i++) {
      if (out.getAttribute('position').count * 4 > ceiling) break
      const next = subdivideOnce(out)
      out.dispose()
      out = next
    }
  }

  if (taper !== 0) applyTaper(out, taper, Math.round(m('taperAxis')))
  if (twist !== 0) applyTwist(out, twist, Math.round(m('twistAxis')))
  if (bend !== 0) applyBend(out, bend, Math.round(m('bendAxis')))
  if (noise !== 0) applyNoise(out, noise, m('noiseScale'), Math.round(m('noiseSeed')))

  if (deforms) {
    out.computeVertexNormals()
    out.computeBoundingBox()
    out.computeBoundingSphere()
  }

  if (count > 1) {
    const arrayed = applyArray(
      out,
      count,
      Math.round(m('arrayMode')) === 1,
      [m('arrayOffsetX'), m('arrayOffsetY'), m('arrayOffsetZ')],
      m('arrayRadius'),
      Math.round(m('arrayAxis')),
    )
    out.dispose()
    out = arrayed
    out.computeBoundingBox()
    out.computeBoundingSphere()
  }

  return out
}
