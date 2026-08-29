import type { SketchDoc, EntityId, SketchEntity } from './model'
import { getEntity, getPoint, lineEndpoints, circleCenter } from './model'

const num = (n: number) => (Object.is(n, -0) ? 0 : n)

function pathD(doc: SketchDoc, p: Extract<SketchEntity, { kind: 'path' }>): string {
  const pts = p.anchors.map(id => getPoint(doc, id))
  if (pts.some(x => !x)) return ''
  const segCount = p.closed ? p.anchors.length : p.anchors.length - 1
  if (p.segments.length !== segCount) return ''
  let d = `M ${num(pts[0]!.x)} ${num(pts[0]!.y)}`
  for (let i = 0; i < segCount; i++) {
    const from = pts[i]!
    const to = pts[(i + 1) % p.anchors.length]!
    const seg = p.segments[i]!
    if (seg.kind === 'arc') {
      const c = getPoint(doc, seg.center)
      const r = c ? Math.hypot(from.x - c.x, from.y - c.y) : 0
      if (!c || r < 1e-6) { d += ` L ${num(to.x)} ${num(to.y)}`; continue }
      const a0 = Math.atan2(from.y - c.y, from.x - c.x)
      const a1 = Math.atan2(to.y - c.y, to.x - c.x)
      const TAU = Math.PI * 2
      const ccw = ((a1 - a0) % TAU + TAU) % TAU
      const span = seg.sweep === 1 ? ccw : TAU - ccw
      const large = span > Math.PI ? 1 : 0
      d += ` A ${num(r)} ${num(r)} 0 ${large} ${seg.sweep} ${num(to.x)} ${num(to.y)}`
    } else {
      // 'line' and (until M2 renders curves) 'cubic' both emit straight
      d += ` L ${num(to.x)} ${num(to.y)}`
    }
  }
  if (p.closed) d += ' Z'
  return d
}

export function entityPath(doc: SketchDoc, id: EntityId): string {
  const e = getEntity(doc, id)
  if (!e || e.kind === 'point') return ''
  if (e.kind === 'path') return pathD(doc, e)
  if (e.kind === 'line') {
    const pts = lineEndpoints(doc, e); if (!pts) return ''
    return `M ${num(pts.a.x)} ${num(pts.a.y)} L ${num(pts.b.x)} ${num(pts.b.y)}`
  }
  // circle: two half-arcs from the left point, sweeping through the right and back
  const cen = circleCenter(doc, e); if (!cen) return ''
  const r = e.r
  const lx = num(cen.x - r), rx = num(cen.x + r), cy = num(cen.y)
  return `M ${lx} ${cy} A ${r} ${r} 0 0 1 ${rx} ${cy} A ${r} ${r} 0 0 1 ${lx} ${cy} Z`
}

export function sketchPathData(doc: SketchDoc, opts: { includeConstruction?: boolean } = {}): string {
  const parts: string[] = []
  for (const e of doc.entities) {
    if (e.kind === 'point') continue
    if (e.construction && !opts.includeConstruction) continue
    const d = entityPath(doc, e.id)
    if (d) parts.push(d)
  }
  return parts.join(' ')
}
