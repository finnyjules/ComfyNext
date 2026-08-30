import type { SketchDoc, SketchConstraint, EntityId, ConstraintKind } from './model'
import { getEntity, getPoint, lineEndpoints, circleCenter } from './model'
import type { Vec2 } from './geom'
import { sub, add, scale, len, dist } from './geom'

export interface ConstraintMark { id: EntityId; kind: ConstraintKind; glyph: string; x: number; y: number; text?: string }

const GLYPH: Record<ConstraintKind, string> = {
  tangentLineCircle: 'T', tangentCircleCircle: 'T', coincident: '=', concentric: '◎',
  horizontal: 'H', vertical: 'V', pointOnLine: '—', pointOnCircle: 'o', distance: '↔', radius: 'R',
  equalDist: 'E', rotatedFrom: '↻', mirroredFrom: '⇄', collinear: 'S',
}

// a representative world point to anchor the badge near, for the first resolvable ref
function anchor(doc: SketchDoc, c: SketchConstraint): Vec2 | null {
  for (const ref of c.refs) {
    const e = getEntity(doc, ref)
    if (!e) continue
    if (e.kind === 'point') return { x: e.x, y: e.y }
    if (e.kind === 'line') { const ep = lineEndpoints(doc, e); if (ep) return { x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 } }
    if (e.kind === 'circle') { const cen = circleCenter(doc, e); if (cen) return { x: cen.x + e.r, y: cen.y } }
    if (e.kind === 'path') {
      // midpoint of the first two resolvable anchors (i.e. the first segment's endpoints)
      const pts = e.anchors.map(id => getPoint(doc, id)).filter((p): p is NonNullable<typeof p> => !!p)
      if (pts.length >= 2) return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 }
    }
  }
  return null
}

export interface ArcDimensionMark { id: string; x: number; y: number; text: string }

// persistent "R n.n" radius chips for every arc segment of every non-construction
// path, positioned in WORLD coords at an approximation of the arc's midpoint:
// chord midpoint nudged out to the circle (center + (chordMid - center) normalized * r).
export function arcDimensionMarks(doc: SketchDoc): ArcDimensionMark[] {
  const out: ArcDimensionMark[] = []
  for (const e of doc.entities) {
    if (e.kind !== 'path' || e.construction) continue
    for (let i = 0; i < e.segments.length; i++) {
      const seg = e.segments[i]!
      if (seg.kind !== 'arc') continue
      const startId = e.anchors[i]
      const endId = e.anchors[(i + 1) % e.anchors.length]
      const start = startId != null ? getPoint(doc, startId) : undefined
      const end = endId != null ? getPoint(doc, endId) : undefined
      const center = getPoint(doc, seg.center)
      if (!start || !end || !center) continue
      const c: Vec2 = { x: center.x, y: center.y }
      const s: Vec2 = { x: start.x, y: start.y }
      const en: Vec2 = { x: end.x, y: end.y }
      const radius = dist(c, s)
      if (!Number.isFinite(radius) || radius < 1e-6) continue
      const chordMid: Vec2 = { x: (s.x + en.x) / 2, y: (s.y + en.y) / 2 }
      const outward = sub(chordMid, c)
      const outwardLen = len(outward)
      if (!Number.isFinite(outwardLen) || outwardLen < 1e-6) continue
      const arcMid = add(c, scale(outward, radius / outwardLen))
      if (!Number.isFinite(arcMid.x) || !Number.isFinite(arcMid.y)) continue
      out.push({ id: `${e.id}:${i}`, x: arcMid.x, y: arcMid.y, text: `R ${radius.toFixed(1)}` })
    }
  }
  return out
}

export function constraintMarks(doc: SketchDoc): ConstraintMark[] {
  const out: ConstraintMark[] = []
  for (const c of doc.constraints) {
    // require every ref to resolve, matching residuals' skip behavior
    if (!c.refs.every(r => getEntity(doc, r))) continue
    const at = anchor(doc, c)
    if (!at) continue
    out.push({ id: c.id, kind: c.kind, glyph: GLYPH[c.kind], x: at.x, y: at.y, ...(c.value != null ? { text: String(Math.round(c.value * 100) / 100) } : {}) })
  }
  return out
}
