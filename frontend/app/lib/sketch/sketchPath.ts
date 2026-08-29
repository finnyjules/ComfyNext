import type { SketchDoc, EntityId } from './model'
import { getEntity, lineEndpoints, circleCenter } from './model'

const num = (n: number) => (Object.is(n, -0) ? 0 : n)

export function entityPath(doc: SketchDoc, id: EntityId): string {
  const e = getEntity(doc, id)
  if (!e || e.kind === 'point') return ''
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
