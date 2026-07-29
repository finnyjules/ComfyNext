// frontend/app/lib/scene3d/hierarchy.ts
// Object hierarchy for Scene3D, expressed as `parentId` references over a FLAT
// `doc.objects` array. Nesting the array instead would force every one of the
// eight modules that iterate doc.objects to recurse, and would break the flat
// `objects.<id>.motion.*` agent path space — see the grouping design spec.
//
// Deliberately pure: no engine import, no WebGL. `three`'s Matrix4/Quaternion/
// Euler/Vector3 ARE allowed — they're plain JS maths with no renderer attached
// — because group/ungroup need real world-matrix composition to keep objects
// visually still across a reparent. World matrices here are always computed by
// walking `parentId` over the DOC, never read from the engine's live three.js
// roots. That is what keeps `groupObjects`/`ungroupObject` pure functions of
// `SceneObject[]`, and what lets these invariants be unit-tested with plain
// objects and no GPU context at all.
import * as THREE from 'three'
import type { GroupObject, SceneObject, Vec3 } from './config'

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

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/** Local TRS of one object as a matrix. Euler order matches SceneObjectBase's
 *  documented XYZ. */
function localMatrixOf(o: SceneObject): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...o.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.rotation, 'XYZ')),
    new THREE.Vector3(...o.scale),
  )
}

/** World matrix of `id`, composed by walking the parentId chain from the root
 *  down. Derived from the DOC rather than the engine's live roots so that
 *  grouping stays a pure function of data — which is what makes the
 *  world-transform invariants testable without a WebGL context.
 *  An unknown id, or a chain broken by a missing parent, yields identity. */
export function worldMatrixOf(objects: readonly SceneObject[], id: string): THREE.Matrix4 {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const chain: SceneObject[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  const out = new THREE.Matrix4()
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(localMatrixOf(chain[i]!))
  return out
}

/** Decompose a world matrix into the local TRS that reproduces it under
 *  `parentWorld`. This — not subtraction — is what keeps a child in place when
 *  the new parent is rotated or non-uniformly scaled. */
function rebase(childWorld: THREE.Matrix4, parentWorld: THREE.Matrix4): {
  position: Vec3; rotation: Vec3; scale: Vec3
} {
  _m.copy(parentWorld).invert().multiply(childWorld)
  _m.decompose(_p, _q, _s)
  _e.setFromQuaternion(_q, 'XYZ')
  return {
    position: [_p.x, _p.y, _p.z],
    rotation: [_e.x, _e.y, _e.z],
    scale: [_s.x, _s.y, _s.z],
  }
}

/** True when `candidateParentId` is `id` itself or sits inside `id`'s subtree —
 *  the reparent that would create a cycle. */
function wouldCycle(objects: readonly SceneObject[], id: string, candidateParentId?: string): boolean {
  if (!candidateParentId) return false
  if (candidateParentId === id) return true
  return descendantIds(objects, id).includes(candidateParentId)
}

/** Reparent `ids` under `group`, preserving every world transform, and return a
 *  NEW objects array with `group` inserted. `group.parentId` (set by the caller,
 *  normally to the primary selection's parent) decides where the group itself
 *  lands, so grouping inside an existing group nests rather than escaping.
 *
 *  The group is positioned at the world bounds centre of the selection —
 *  measured from object ORIGINS, not geometry bounds, since this module has no
 *  access to meshes. That is the pivot the gizmo will sit on.
 *
 *  An id whose reparent would create a cycle is skipped rather than applied. */
export function groupObjects(
  objects: readonly SceneObject[],
  ids: readonly string[],
  group: GroupObject,
): SceneObject[] {
  const members = ids.filter((id) => objects.some((o) => o.id === id) && !wouldCycle(objects, id, group.parentId))
  if (!members.length) return [...objects]

  // Bounds centre of the members' world origins.
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (const id of members) {
    _p.setFromMatrixPosition(worldMatrixOf(objects, id))
    min.min(_p); max.max(_p)
  }
  const centre = min.clone().add(max).multiplyScalar(0.5)

  // The group's own LOCAL transform: identity rotation/scale, solving only for
  // the position that puts the group at `centre` in world space. This is NOT
  // `rebase(identityRotationAtCentre, groupParentWorld)` — asking decompose to
  // cancel a ROTATED, NON-UNIFORMLY-SCALED parent's linear part down to world
  // identity has no exact TRS answer (the inverse of rotate-then-scale is
  // scale-then-rotate, which is shear once expanded back to rotate-then-scale)
  // and THREE's decompose silently drops that shear instead of erroring. A
  // group is a pivot, not a corrective transform, so it inherits its parent's
  // orientation like any other child rather than fighting it — only the
  // translation needs solving, and a plain point-through-inverse-matrix has no
  // such ambiguity.
  const groupParentWorld = group.parentId ? worldMatrixOf(objects, group.parentId) : new THREE.Matrix4()
  const localPos = centre.clone().applyMatrix4(_m.copy(groupParentWorld).invert())
  const placed: GroupObject = {
    ...group,
    position: [localPos.x, localPos.y, localPos.z],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }

  // Children rebased against the group's ACTUAL world matrix — recomposed
  // from `placed`'s own (identity-rotation) local TRS rather than the
  // `centre`-only matrix used to solve for it above. Since `placed`'s local
  // linear part is exactly identity, this recomposition is lossless, so
  // children land exactly back where they started rather than drifting by
  // whatever shear the group's own placement would otherwise have dropped.
  const groupWorld = new THREE.Matrix4().multiplyMatrices(groupParentWorld, localMatrixOf(placed))
  const memberSet = new Set(members)
  const next = objects.map((o) => {
    if (!memberSet.has(o.id)) return o
    const world = worldMatrixOf(objects, o.id)
    return { ...o, parentId: placed.id, ...rebase(world, groupWorld) }
  })
  return [...next, placed]
}

/** Dissolve `groupId`: its children move to the group's own parent with world
 *  transforms preserved, and the group object is removed. A non-group id, or an
 *  unknown one, returns the array unchanged. */
export function ungroupObject(objects: readonly SceneObject[], groupId: string): SceneObject[] {
  const group = objects.find((o) => o.id === groupId)
  if (!group || group.kind !== 'group') return [...objects]
  const newParentId = group.parentId
  const newParentWorld = newParentId ? worldMatrixOf(objects, newParentId) : new THREE.Matrix4()
  const childIds = new Set(childrenOf(objects, groupId).map((o) => o.id))
  return objects
    .filter((o) => o.id !== groupId)
    .map((o) => {
      if (!childIds.has(o.id)) return o
      const world = worldMatrixOf(objects, o.id)
      const rebased = { ...o, ...rebase(world, newParentWorld) }
      if (newParentId) rebased.parentId = newParentId
      else delete rebased.parentId
      return rebased
    })
}
