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
  if (best) return { x: best.x, y: best.y, snap: best }
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
