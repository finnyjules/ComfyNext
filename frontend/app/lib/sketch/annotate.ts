import type { SketchDoc, SketchConstraint, EntityId, ConstraintKind } from './model'
import { getEntity, getPoint, lineEndpoints, circleCenter } from './model'
import type { Vec2 } from './geom'

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

export function constraintMarks(doc: SketchDoc): ConstraintMark[] {
  const out: ConstraintMark[] = []
  for (const c of doc.constraints) {
    // require every ref to resolve, matching residuals' skip behavior
    if (!c.refs.every(r => getEntity(doc, r))) continue
    const at = anchor(doc, c)
    if (!at) continue
    out.push({ id: c.id, kind: c.kind, glyph: GLYPH[c.kind], x: at.x, y: at.y, ...(c.value != null ? { text: String(c.value) } : {}) })
  }
  return out
}
