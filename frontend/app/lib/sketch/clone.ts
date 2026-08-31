import type { SketchDoc, SketchEntity, SketchConstraint } from './model'

// Structural deep clone of a SketchDoc — used for undo/redo history snapshots.
// Every entity/constraint is a fresh object; a path's `anchors`/`segments`
// arrays (and each segment object) are fresh too, so mutating a clone never
// reaches back into the original doc (or a previously-pushed history entry).
// Pure — no reactivity assumptions, safe to call on a plain object or on
// something pulled out of a Vue ref.
export function cloneDoc(doc: SketchDoc): SketchDoc {
  return {
    entities: doc.entities.map(e => {
      if (e.kind === 'path') return { ...e, anchors: [...e.anchors], segments: e.segments.map(s => ({ ...s })) }
      return { ...e }
    }) as SketchEntity[],
    constraints: doc.constraints.map(c => ({ ...c, refs: [...c.refs] })) as SketchConstraint[],
  }
}
