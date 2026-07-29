// frontend/app/lib/scene3d/hierarchy.ts
// Object hierarchy for Scene3D, expressed as `parentId` references over a FLAT
// `doc.objects` array. Nesting the array instead would force every one of the
// eight modules that iterate doc.objects to recurse, and would break the flat
// `objects.<id>.motion.*` agent path space — see the grouping design spec.
//
// Deliberately pure: no engine import, no WebGL, no `three`. This module only
// answers structural questions over `parentId` — roots, children, descendants,
// parent-first ordering, and cycle/dangling-reference repair. Transform maths
// (group/ungroup composing a parent's matrix into its children) is engine-side
// and belongs to a later task; keeping it out of here is what lets this file
// be unit-tested with plain objects and no GPU context at all.
import type { SceneObject } from './config'

/** Objects with no resolvable parent — the top level of the tree. Call after
 *  `sanitizeHierarchy`, which is what guarantees "absent" and "unresolvable"
 *  are the same thing. */
export function rootObjects(objects: readonly SceneObject[]): SceneObject[] {
  return objects.filter((o) => !o.parentId)
}

/** Direct children of `id`, in array order — the ordering the object list
 *  renders within each level. */
export function childrenOf(objects: readonly SceneObject[], id: string): SceneObject[] {
  return objects.filter((o) => o.parentId === id)
}

/** Every descendant id of `id`, excluding `id` itself. Used by delete and
 *  duplicate, both of which act on a whole subtree. Iterative rather than
 *  recursive, and guarded by a seen-set, so a cycle that slipped past
 *  `sanitizeHierarchy` degrades to a finite walk instead of a stack overflow. */
export function descendantIds(objects: readonly SceneObject[], id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    const current = queue.shift()!
    for (const child of childrenOf(objects, current)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child.id)
      queue.push(child.id)
    }
  }
  return out
}

/** `objects` reordered so every parent precedes its children. The engine syncs
 *  in this order because a child's three-root cannot be added to a parent root
 *  that does not exist yet.
 *
 *  Depth-sorted rather than a full topological sort: simpler, stable, and the
 *  cycle invariant guarantees the depth walk terminates. An object whose
 *  ancestor chain is broken anyway (defensive — `sanitizeHierarchy` should have
 *  cut it) is treated as depth 0 rather than dropped, so nothing vanishes. */
export function orderParentsFirst(objects: readonly SceneObject[]): SceneObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const depthOf = (o: SceneObject): number => {
    let depth = 0
    const seen = new Set<string>([o.id])
    let current = o
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent || seen.has(parent.id)) break
      seen.add(parent.id)
      current = parent
      depth++
    }
    return depth
  }
  // Decorate-sort-undecorate on the index keeps the sort stable across engines.
  return objects
    .map((o, i) => ({ o, i, d: depthOf(o) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.o)
}

/** In-place repair of the two ways a `parentId` graph can be invalid. MUTATES
 *  `objects` — it runs inside `parseDoc`, on freshly-built objects nobody else
 *  holds yet.
 *
 *  1. A `parentId` naming no object in the doc is dropped, so the object
 *     surfaces at the root. This is what saves a document that has been through
 *     an OLDER build: `parseDoc`'s flatMap silently drops unknown kinds, so a
 *     group vanishes while its children keep pointing at its id.
 *  2. Cycles are broken by cutting the edge that closes the loop. A doc can be
 *     hand-edited, agent-written, or round-tripped through anything; an
 *     infinite ancestor walk must not be reachable from parsed input. */
export function sanitizeHierarchy(objects: SceneObject[]): void {
  const byId = new Map(objects.map((o) => [o.id, o]))
  for (const o of objects) {
    if (o.parentId && !byId.has(o.parentId)) delete o.parentId
  }
  for (const o of objects) {
    const seen = new Set<string>([o.id])
    let current = o
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent) break
      if (seen.has(parent.id)) { delete current.parentId; break }
      seen.add(parent.id)
      current = parent
    }
  }
}
