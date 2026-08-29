import type { Vec2 } from './geom'

export type EntityId = string

export interface PointEntity { id: EntityId; kind: 'point'; x: number; y: number; construction?: boolean; fixed?: boolean }
export interface LineEntity { id: EntityId; kind: 'line'; p1: EntityId; p2: EntityId; construction?: boolean }
export interface CircleEntity { id: EntityId; kind: 'circle'; center: EntityId; r: number; construction?: boolean }
export type SketchEntity = PointEntity | LineEntity | CircleEntity

export type ConstraintKind =
  | 'coincident' | 'pointOnLine' | 'pointOnCircle'
  | 'tangentLineCircle' | 'tangentCircleCircle' | 'concentric'
  | 'horizontal' | 'vertical' | 'distance' | 'radius'

export interface SketchConstraint {
  id: EntityId
  kind: ConstraintKind
  refs: EntityId[]     // entity ids the constraint relates, order defined per kind
  value?: number       // for 'distance' and 'radius'
}

export interface SketchDoc { entities: SketchEntity[]; constraints: SketchConstraint[] }

export function getEntity(doc: SketchDoc, id: EntityId): SketchEntity | undefined {
  return doc.entities.find(e => e.id === id)
}

export function getPoint(doc: SketchDoc, id: EntityId): PointEntity | undefined {
  const e = getEntity(doc, id)
  return e && e.kind === 'point' ? e : undefined
}

export function lineEndpoints(doc: SketchDoc, line: LineEntity): { a: Vec2; b: Vec2 } | null {
  const a = getPoint(doc, line.p1)
  const b = getPoint(doc, line.p2)
  if (!a || !b) return null
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
}

export function circleCenter(doc: SketchDoc, circle: CircleEntity): Vec2 | null {
  const c = getPoint(doc, circle.center)
  return c ? { x: c.x, y: c.y } : null
}
