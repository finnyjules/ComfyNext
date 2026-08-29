import type { SketchDoc, SketchConstraint, LineEntity, CircleEntity } from './model'
import { getEntity, getPoint, lineEndpoints, circleCenter } from './model'
import { dist, distPointToLine } from './geom'

function circleOf(doc: SketchDoc, id: string): CircleEntity | null {
  const e = getEntity(doc, id)
  return e && e.kind === 'circle' ? e : null
}
function lineOf(doc: SketchDoc, id: string): LineEntity | null {
  const e = getEntity(doc, id)
  return e && e.kind === 'line' ? e : null
}

function residualsFor(doc: SketchDoc, c: SketchConstraint): number[] | null {
  switch (c.kind) {
    case 'coincident': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!)
      if (!a || !b) return null
      return [a.x - b.x, a.y - b.y]
    }
    case 'concentric': {
      const a = circleOf(doc, c.refs[0]!); const b = circleOf(doc, c.refs[1]!)
      if (!a || !b) return null
      const ca = circleCenter(doc, a); const cb = circleCenter(doc, b)
      if (!ca || !cb) return null
      return [ca.x - cb.x, ca.y - cb.y]
    }
    case 'pointOnLine': {
      const p = getPoint(doc, c.refs[0]!); const l = lineOf(doc, c.refs[1]!)
      if (!p || !l) return null
      const e = lineEndpoints(doc, l); if (!e) return null
      return [distPointToLine({ x: p.x, y: p.y }, e.a, e.b)]
    }
    case 'pointOnCircle': {
      const p = getPoint(doc, c.refs[0]!); const cir = circleOf(doc, c.refs[1]!)
      if (!p || !cir) return null
      const cen = circleCenter(doc, cir); if (!cen) return null
      return [dist({ x: p.x, y: p.y }, cen) - cir.r]
    }
    case 'tangentLineCircle': {
      const l = lineOf(doc, c.refs[0]!); const cir = circleOf(doc, c.refs[1]!)
      if (!l || !cir) return null
      const e = lineEndpoints(doc, l); const cen = circleCenter(doc, cir)
      if (!e || !cen) return null
      return [Math.abs(distPointToLine(cen, e.a, e.b)) - cir.r]
    }
    case 'tangentCircleCircle': {
      const a = circleOf(doc, c.refs[0]!); const b = circleOf(doc, c.refs[1]!)
      if (!a || !b) return null
      const ca = circleCenter(doc, a); const cb = circleCenter(doc, b)
      if (!ca || !cb) return null
      return [dist(ca, cb) - (a.r + b.r)]
    }
    case 'horizontal': {
      const l = lineOf(doc, c.refs[0]!); if (!l) return null
      const e = lineEndpoints(doc, l); if (!e) return null
      return [e.a.y - e.b.y]
    }
    case 'vertical': {
      const l = lineOf(doc, c.refs[0]!); if (!l) return null
      const e = lineEndpoints(doc, l); if (!e) return null
      return [e.a.x - e.b.x]
    }
    case 'distance': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!)
      if (!a || !b || c.value == null) return null
      return [dist({ x: a.x, y: a.y }, { x: b.x, y: b.y }) - c.value]
    }
    case 'radius': {
      const cir = circleOf(doc, c.refs[0]!)
      if (!cir || c.value == null) return null
      return [cir.r - c.value]
    }
    case 'equalDist': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!)
      const p = getPoint(doc, c.refs[2]!); const q = getPoint(doc, c.refs[3]!)
      if (!a || !b || !p || !q) return null
      return [dist({ x: a.x, y: a.y }, { x: b.x, y: b.y }) - dist({ x: p.x, y: p.y }, { x: q.x, y: q.y })]
    }
    case 'rotatedFrom': {
      const cp = getPoint(doc, c.refs[0]!); const og = getPoint(doc, c.refs[1]!); const ce = getPoint(doc, c.refs[2]!)
      if (!cp || !og || !ce || c.value == null) return null
      const a = c.value * Math.PI / 180
      const co = Math.cos(a), si = Math.sin(a)
      const dx = og.x - ce.x, dy = og.y - ce.y
      const rx = ce.x + co * dx - si * dy
      const ry = ce.y + si * dx + co * dy
      return [cp.x - rx, cp.y - ry]
    }
    case 'mirroredFrom': {
      const cp = getPoint(doc, c.refs[0]!); const og = getPoint(doc, c.refs[1]!); const l = lineOf(doc, c.refs[2]!)
      if (!cp || !og || !l) return null
      const e = lineEndpoints(doc, l); if (!e) return null
      const dirx = e.b.x - e.a.x, diry = e.b.y - e.a.y
      const L = Math.hypot(dirx, diry)
      if (L < 1e-12) return null
      const nx = -diry / L, ny = dirx / L                       // unit normal
      const s = (og.x - e.a.x) * nx + (og.y - e.a.y) * ny       // signed distance to axis
      const rx = og.x - 2 * s * nx
      const ry = og.y - 2 * s * ny
      return [cp.x - rx, cp.y - ry]
    }
    case 'collinear': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!); const p = getPoint(doc, c.refs[2]!)
      if (!a || !b || !p) return null
      return [(b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)]
    }
    default:
      return null
  }
}

export function constraintResiduals(doc: SketchDoc): number[] {
  const out: number[] = []
  for (const c of doc.constraints) {
    const r = residualsFor(doc, c)
    if (r) out.push(...r)
  }
  return out
}
