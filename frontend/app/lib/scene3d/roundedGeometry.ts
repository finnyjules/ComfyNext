// Rounded-edge geometry builders for the 3D Studio. Kept out of engine.ts to
// keep that file focused. cornerRadius 0 never reaches here — the factory falls
// back to the plain three.js primitive — so these always round something.
import * as THREE from 'three'

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
