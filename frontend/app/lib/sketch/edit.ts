import type { SketchDoc, EntityId, ConstraintKind, LineEntity, CircleEntity } from './model'
import { getEntity } from './model'
import { freshId } from './ids'

export function addPoint(doc: SketchDoc, x: number, y: number, opts: { fixed?: boolean; construction?: boolean } = {}): EntityId {
  const id = freshId(doc, 'p')
  doc.entities.push({ id, kind: 'point', x, y, ...(opts.fixed ? { fixed: true } : {}), ...(opts.construction ? { construction: true } : {}) })
  return id
}

export function addLine(doc: SketchDoc, p1: EntityId, p2: EntityId, opts: { construction?: boolean } = {}): EntityId {
  const id = freshId(doc, 'l')
  doc.entities.push({ id, kind: 'line', p1, p2, ...(opts.construction ? { construction: true } : {}) })
  return id
}

export function addCircle(doc: SketchDoc, center: EntityId, r: number, opts: { construction?: boolean } = {}): EntityId {
  const id = freshId(doc, 'c')
  doc.entities.push({ id, kind: 'circle', center, r, ...(opts.construction ? { construction: true } : {}) })
  return id
}

export function addConstraint(doc: SketchDoc, kind: ConstraintKind, refs: EntityId[], value?: number): EntityId {
  const id = freshId(doc, 'k')
  doc.constraints.push({ id, kind, refs: [...refs], ...(value != null ? { value } : {}) })
  return id
}

export function removeConstraint(doc: SketchDoc, id: EntityId): void {
  doc.constraints = doc.constraints.filter(c => c.id !== id)
}

// Delete an entity and everything that structurally depends on it.
export function deleteEntity(doc: SketchDoc, id: EntityId): void {
  const e = getEntity(doc, id)
  if (!e) return
  // entities that reference this one and must go too (only points have dependents)
  const dependents: EntityId[] = []
  if (e.kind === 'point') {
    for (const other of doc.entities) {
      if (other.kind === 'line' && (other.p1 === id || other.p2 === id)) dependents.push(other.id)
      else if (other.kind === 'circle' && other.center === id) dependents.push(other.id)
    }
  }
  // remove this entity
  doc.entities = doc.entities.filter(x => x.id !== id)
  // drop constraints that reference the removed entity
  doc.constraints = doc.constraints.filter(c => !c.refs.includes(id))
  // recurse into dependents
  for (const depId of dependents) deleteEntity(doc, depId)
}
