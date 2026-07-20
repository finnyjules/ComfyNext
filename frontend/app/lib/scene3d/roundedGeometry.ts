// Rounded-edge geometry builders for the 3D Studio. Kept out of engine.ts to
// keep that file focused. cornerRadius 0 never reaches here — the factory falls
// back to the plain three.js primitive — so these always round something.
import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'

/** 2D fillet of corner B in the polyline A-B-C: a tangent arc of radius r with
 *  `segments` spans, ordered from the A-side tangent to the C-side tangent.
 *  Degenerate corners (a straight run, a spike, a zero-length edge) return B. */
export function filletCorner(
  A: THREE.Vector2, B: THREE.Vector2, C: THREE.Vector2, r: number, segments: number,
): THREE.Vector2[] {
  const u = new THREE.Vector2().subVectors(A, B)
  const v = new THREE.Vector2().subVectors(C, B)
  const lu = u.length(), lv = v.length()
  if (lu < 1e-6 || lv < 1e-6 || r <= 1e-6) return [B.clone()]
  u.divideScalar(lu); v.divideScalar(lv)
  const cos = Math.min(1, Math.max(-1, u.dot(v)))
  const ang = Math.acos(cos)
  if (ang < 1e-3 || Math.PI - ang < 1e-3) return [B.clone()]
  const tanHalf = Math.tan(ang / 2)
  let t = r / tanHalf
  const maxT = Math.min(lu, lv) * 0.999
  let rr = r
  if (t > maxT) { t = maxT; rr = t * tanHalf }
  const T1 = new THREE.Vector2().copy(B).addScaledVector(u, t)
  const T2 = new THREE.Vector2().copy(B).addScaledVector(v, t)
  const bis = new THREE.Vector2().addVectors(u, v)
  const lb = bis.length()
  if (lb < 1e-6) return [B.clone()]
  bis.divideScalar(lb)
  const center = new THREE.Vector2().copy(B).addScaledVector(bis, rr / Math.sin(ang / 2))
  const a1 = Math.atan2(T1.y - center.y, T1.x - center.x)
  const a2 = Math.atan2(T2.y - center.y, T2.x - center.x)
  let da = a2 - a1
  while (da > Math.PI) da -= Math.PI * 2
  while (da < -Math.PI) da += Math.PI * 2
  const n = Math.max(1, Math.round(segments))
  const out: THREE.Vector2[] = []
  for (let i = 0; i <= n; i++) {
    const a = a1 + (da * i) / n
    out.push(new THREE.Vector2(center.x + Math.cos(a) * rr, center.y + Math.sin(a) * rr))
  }
  return out
}

/** A cylinder/cone with its rim(s) rounded. Built as a lathe of the silhouette
 *  profile (radius, y) revolved about Y; the outer rim corners are filleted. */
export function roundedLatheGeometry(
  radiusTop: number, radiusBottom: number, cornerRadius: number,
  cornerSides: number, radialSegments: number, phiLength: number,
): THREE.BufferGeometry {
  const halfH = 0.5
  const r = Math.min(cornerRadius, halfH * 0.98, Math.max(radiusTop, radiusBottom) * 0.98)
  const bottomAxis = new THREE.Vector2(0, -halfH)
  const rimB = new THREE.Vector2(radiusBottom, -halfH)
  const rimT = new THREE.Vector2(radiusTop, halfH)
  const topAxis = new THREE.Vector2(0, halfH)
  const pts: THREE.Vector2[] = [bottomAxis]
  if (radiusBottom > 1e-4) pts.push(...filletCorner(bottomAxis, rimB, rimT, r, cornerSides))
  if (radiusTop > 1e-4) pts.push(...filletCorner(rimB, rimT, topAxis, r, cornerSides))
  pts.push(topAxis)
  return new THREE.LatheGeometry(pts, Math.max(3, Math.round(radialSegments)), 0, phiLength)
}

/** A straight n-gon prism with rounded vertical edges (rounded-corner 2D shape)
 *  and a rounded rim (extrude bevel). Taper is intentionally dropped: rounding
 *  wins, so a rounded pyramid reads as a rounded prism. Centred on the origin,
 *  height 1 on Y. baseAngle sets the first corner's angle in the XZ footprint. */
export function roundedPolyGeometry(
  sides: number, radius: number, cornerRadius: number, cornerSides: number, baseAngle: number,
): THREE.BufferGeometry {
  const n = Math.max(3, Math.round(sides))
  const inradius = radius * Math.cos(Math.PI / n)
  const edge = 2 * radius * Math.sin(Math.PI / n)
  // Vertical-edge fillet and rim bevel must both fit inside the inradius or the
  // extrude self-intersects; clamp conservatively so extreme sliders stay valid.
  const rcNominal = Math.min(cornerRadius, edge * 0.49, inradius * 0.6)
  const bevel = Math.min(cornerRadius, 0.49, Math.max(0, inradius - rcNominal) * 0.9)
  const sidesSeg = Math.max(1, Math.round(cornerSides))

  // The bevel must offset OUTWARD (ExtrudeGeometry's default) — that's the only
  // direction verified crossing-free for the rim ring at low side counts; an
  // inward offset folds the ring into a bowtie. So the base contour is shrunk
  // by `bevel` up front: the outward bevel then brings the vertical wall back
  // out to the nominal radius (baseR + bevel = radius), and the flat cap sits
  // inset at baseR as a proper rounded rim.
  const baseR = Math.max(1e-3, radius - bevel)
  const baseInradius = baseR * Math.cos(Math.PI / n)
  const baseEdge = 2 * baseR * Math.sin(Math.PI / n)
  const rc = Math.min(cornerRadius, baseEdge * 0.49, baseInradius * 0.6)

  const corners: THREE.Vector2[] = []
  for (let k = 0; k < n; k++) {
    const a = baseAngle + (k / n) * Math.PI * 2
    corners.push(new THREE.Vector2(Math.cos(a) * baseR, Math.sin(a) * baseR))
  }
  const shape = new THREE.Shape()
  for (let k = 0; k < n; k++) {
    const cur = corners[k]!
    const prev = corners[(k - 1 + n) % n]!
    const next = corners[(k + 1) % n]!
    const toPrev = new THREE.Vector2().subVectors(prev, cur).normalize()
    const toNext = new THREE.Vector2().subVectors(next, cur).normalize()
    const t1 = new THREE.Vector2().copy(cur).addScaledVector(toPrev, rc)
    const t2 = new THREE.Vector2().copy(cur).addScaledVector(toNext, rc)
    if (k === 0) shape.moveTo(t1.x, t1.y)
    else shape.lineTo(t1.x, t1.y)
    if (rc > 1e-4) shape.quadraticCurveTo(cur.x, cur.y, t2.x, t2.y)
  }
  shape.closePath()

  const depth = Math.max(1e-3, 1 - 2 * bevel)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 1e-4,
    bevelSegments: sidesSeg,
    bevelSize: bevel,
    bevelThickness: bevel,
    // bevelOffset left at its default (0 → outward). See the baseR comment above:
    // shrinking the base contour is what keeps the outward bevel at the nominal
    // radius instead of ballooning past it.
    curveSegments: sidesSeg,
    steps: 1,
  })
  geo.rotateX(-Math.PI / 2)   // extrude axis Z becomes height Y
  geo.center()                // recentre height on the origin
  geo.computeVertexNormals()  // ExtrudeGeometry does not compute smooth normals
  return geo
}

/** Spherical UV projection — ConvexGeometry sets position+normal but no uv, and
 *  the plain polyhedra have uvs, so textured materials need this to keep working. */
export function addSphericalUV(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const uv: number[] = []
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    const u = 0.5 + Math.atan2(v.z, v.x) / (Math.PI * 2)
    const w = 0.5 - Math.asin(Math.min(1, Math.max(-1, v.y))) / Math.PI
    uv.push(u, w)
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
}

/** Spherical interpolation of two unit vectors. */
function slerpDir(u: THREE.Vector3, w: THREE.Vector3, t: number): THREE.Vector3 {
  const dot = Math.min(1, Math.max(-1, u.dot(w)))
  const om = Math.acos(dot)
  if (om < 1e-4) return u.clone()
  const s = Math.sin(om)
  return u.clone().multiplyScalar(Math.sin((1 - t) * om) / s)
    .add(w.clone().multiplyScalar(Math.sin(t * om) / s)).normalize()
}

/** Round a CONVEX polyhedron's edges/corners by a convex offset: the Minkowski sum
 *  of the solid with a sphere of radius `cornerRadius`, approximated as the convex
 *  hull of per-vertex sample clouds. Faces stay flat (offset-face points), edges and
 *  corners round (arc samples). Result is scaled back to the base's bounding size so
 *  dragging Corner doesn't balloon the shape. Does not dispose `base`. */
export function roundedHullGeometry(
  base: THREE.BufferGeometry, cornerRadius: number, cornerSides: number,
): THREE.BufferGeometry {
  const pos = base.getAttribute('position') as THREE.BufferAttribute
  const index = base.index
  const triCount = index ? index.count / 3 : pos.count / 3
  const vAt = (i: number): THREE.Vector3 =>
    new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i)

  // Unique vertices keyed on quantised position, each with its incident face normals.
  const key = (p: THREE.Vector3): string =>
    `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`
  const verts = new Map<string, { p: THREE.Vector3, normals: THREE.Vector3[] }>()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3()
  for (let t = 0; t < triCount; t++) {
    a.copy(vAt(t * 3)); b.copy(vAt(t * 3 + 1)); c.copy(vAt(t * 3 + 2))
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize()
    for (const p of [a, b, c]) {
      const k = key(p)
      let e = verts.get(k)
      if (!e) { e = { p: p.clone(), normals: [] }; verts.set(k, e) }
      // dedupe near-parallel normals so a vertex keeps one entry per distinct face plane
      if (!e.normals.some((m) => m.dot(n) > 0.9999)) e.normals.push(n.clone())
    }
  }

  const steps = Math.max(1, Math.round(cornerSides))
  const points: THREE.Vector3[] = []
  for (const { p, normals } of verts.values()) {
    const dirs: THREE.Vector3[] = normals.map((m) => m.clone()) // flat faces
    for (let i = 0; i < normals.length; i++) {
      for (let j = i + 1; j < normals.length; j++) {
        for (let s = 1; s <= steps; s++) {
          dirs.push(slerpDir(normals[i]!, normals[j]!, s / (steps + 1))) // rounded edges
        }
      }
    }
    if (normals.length > 0) {
      const avg = new THREE.Vector3()
      for (const m of normals) avg.add(m)
      if (avg.lengthSq() > 1e-8) dirs.push(avg.normalize()) // corner cap
    }
    for (const d of dirs) points.push(p.clone().addScaledVector(d, cornerRadius))
  }

  const geo = new ConvexGeometry(points)

  // Preserve the base's overall size — the offset grows it by ~cornerRadius.
  base.computeBoundingSphere()
  geo.computeBoundingSphere()
  const r0 = base.boundingSphere!.radius
  const r1 = geo.boundingSphere!.radius
  if (r1 > 1e-6) geo.scale(r0 / r1, r0 / r1, r0 / r1)

  addSphericalUV(geo)
  return geo
}
