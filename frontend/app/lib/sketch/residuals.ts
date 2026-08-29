import type { SketchDoc, SketchConstraint, LineEntity, CircleEntity } from './model'
import { getEntity, getPoint, lineEndpoints, circleCenter } from './model'
import { dist, distPointToLine, type Vec2 } from './geom'

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
