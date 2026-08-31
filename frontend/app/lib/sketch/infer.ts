import type { SketchDoc, EntityId, PointEntity, LineEntity, CircleEntity } from './model'
import { lineEndpoints, circleCenter } from './model'
import { dist, distPointToLine, sub, add, scale, len, dot, type Vec2 } from './geom'

export interface PointSnap {
  kind: 'coincident' | 'pointOnLine' | 'pointOnCircle'
  targetId: EntityId
  x: number
  y: number
  dist: number
}

// closest point on the infinite line through a→b to p
function projectOnLine(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a)
  const L2 = dot(ab, ab)
  if (L2 < 1e-12) return { x: a.x, y: a.y }
  const t = dot(sub(p, a), ab) / L2
  return add(a, scale(ab, t))
}

export function snapPoint(
  doc: SketchDoc,
  x: number,
  y: number,
  opts: { tol?: number; exclude?: EntityId[] } = {},
): { x: number; y: number; snap: PointSnap | null } {
  const tol = opts.tol ?? 0.6
  const exclude = new Set(opts.exclude ?? [])
  const p = { x, y }
  let best: PointSnap | null = null
  const consider = (s: PointSnap) => {
    if (s.dist > tol) return
    // points beat curves; otherwise nearer wins
    if (!best) { best = s; return }
    const rank = (k: PointSnap['kind']) => (k === 'coincident' ? 0 : 1)
    if (rank(s.kind) < rank(best.kind) || (rank(s.kind) === rank(best.kind) && s.dist < best.dist)) best = s
  }
  for (const e of doc.entities) {
    if (exclude.has(e.id)) continue
    if (e.kind === 'point') {
      // construction points are pen/smooth handles, not snap targets; construction
      // LINES/CIRCLES (guides) still snap below — only points are excluded here
      if (e.construction) continue
      const d = dist(p, { x: e.x, y: e.y })
      consider({ kind: 'coincident', targetId: e.id, x: e.x, y: e.y, dist: d })
    } else if (e.kind === 'line') {
      const ep = lineEndpoints(doc, e); if (!ep) continue
      const proj = projectOnLine(p, ep.a, ep.b)
      consider({ kind: 'pointOnLine', targetId: e.id, x: proj.x, y: proj.y, dist: dist(p, proj) })
    } else if (e.kind === 'circle') {
      const cen = circleCenter(doc, e); if (!cen) continue
      const toC = sub(p, cen)
      const l = len(toC)
      if (l < 1e-9) continue // center itself — no meaningful circumference direction
      const on = add(cen, scale(toC, e.r / l))
      consider({ kind: 'pointOnCircle', targetId: e.id, x: on.x, y: on.y, dist: Math.abs(l - e.r) })
    }
  }
  if (best) { const b: PointSnap = best; return { x: b.x, y: b.y, snap: b } }
  return { x, y, snap: null }
}

export interface TangentInfer {
  kind: 'tangentLineCircle' | 'tangentCircleCircle'
  targetId: EntityId
}

export function inferCircleTangents(
  doc: SketchDoc,
  centerX: number,
  centerY: number,
  r: number,
  opts: { tol?: number; exclude?: EntityId[] } = {},
): TangentInfer[] {
  const tol = opts.tol ?? 0.6
  const exclude = new Set(opts.exclude ?? [])
  const c = { x: centerX, y: centerY }
  const out: TangentInfer[] = []
  for (const e of doc.entities) {
    if (exclude.has(e.id)) continue
    if (e.kind === 'line') {
      const ep = lineEndpoints(doc, e); if (!ep) continue
      if (Math.abs(Math.abs(distPointToLine(c, ep.a, ep.b)) - r) < tol) {
        out.push({ kind: 'tangentLineCircle', targetId: e.id })
      }
    } else if (e.kind === 'circle') {
      const cen = circleCenter(doc, e); if (!cen) continue
      if (Math.abs(dist(c, cen) - (r + e.r)) < tol) {
        out.push({ kind: 'tangentCircleCircle', targetId: e.id })
      }
    }
  }
  return out
}

export function arcThroughTangent(J: Vec2, end: Vec2, tangentDir: Vec2): { center: Vec2; radius: number } | null {
  const tl = Math.hypot(tangentDir.x, tangentDir.y)
  if (tl < 1e-12) return null
  const tx = tangentDir.x / tl, ty = tangentDir.y / tl
  const nx = -ty, ny = tx                // unit normal to the tangent
  const dx = end.x - J.x, dy = end.y - J.y
  const nd = nx * dx + ny * dy           // N·d
  if (Math.abs(nd) < 1e-9) return null   // end lies along the tangent → straight
  const s = (dx * dx + dy * dy) / (2 * nd)
  const center = { x: J.x + s * nx, y: J.y + s * ny }
  return { center, radius: Math.abs(s) }
}

// circumcircle center of three points (null if collinear)
function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const dcp = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  if (Math.abs(dcp) < 1e-9) return null
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / (2 * dcp)
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / (2 * dcp)
  return { x: ux, y: uy }
}

function sweepFor(J: Vec2, end: Vec2, pointer: Vec2, C: Vec2): 0 | 1 {
  const TAU = Math.PI * 2
  const a0 = Math.atan2(J.y - C.y, J.x - C.x)
  const a1 = Math.atan2(end.y - C.y, end.x - C.x)
  const aQ = Math.atan2(pointer.y - C.y, pointer.x - C.x)
  const ccw = ((a1 - a0) % TAU + TAU) % TAU
  const qccw = ((aQ - a0) % TAU + TAU) % TAU
  return qccw <= ccw ? 1 : 0
}

export interface JointArc { center: Vec2; radius: number; sweep: 0 | 1; snappedTangent: boolean }

export function tangentJointArc(J: Vec2, end: Vec2, pointer: Vec2, tangentDir: Vec2 | null, tolDeg = 12): JointArc | null {
  const freeC = circumcenter(J, end, pointer)
  if (!freeC) return null
  const sweep = sweepFor(J, end, pointer, freeC)
  let center = freeC
  let snappedTangent = false
  if (tangentDir) {
    // free arc's tangent at J is perpendicular to (J − freeC)
    const rx = J.x - freeC.x, ry = J.y - freeC.y            // radial dir
    const ftx = -ry, fty = rx                               // free tangent = ⊥ radial
    const fl = Math.hypot(ftx, fty), tl = Math.hypot(tangentDir.x, tangentDir.y)
    if (fl > 1e-9 && tl > 1e-9) {
      // undirected angle between free tangent and desired tangent
      const cosang = Math.abs((ftx * tangentDir.x + fty * tangentDir.y) / (fl * tl))
      const ang = Math.acos(Math.min(1, cosang)) * 180 / Math.PI
      if (ang <= tolDeg) {
        const snap = arcThroughTangent(J, end, tangentDir)
        if (snap) { center = snap.center; snappedTangent = true }
      }
    }
  }
  const radius = Math.hypot(J.x - center.x, J.y - center.y)
  // recompute sweep for the (possibly moved) center, still biased by the pointer side
  return { center, radius, sweep: sweepFor(J, end, pointer, center), snappedTangent }
}
