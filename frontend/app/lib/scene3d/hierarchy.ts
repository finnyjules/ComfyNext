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

/** Local TRS of one object, as the doc stores it. */
export interface LocalTransform { position: Vec3; rotation: Vec3; scale: Vec3 }

/** Convert a batch of WORLD transforms into the LOCAL transforms the doc stores,
 *  each rebased under its own real `parentId`. This is what the multi-selection
 *  gizmo needs: while the pivot owns the selected roots their local TRS is
 *  pivot-relative and means nothing to the doc, so the drag reports world
 *  transforms and this puts them back in their parents' frames.
 *
 *  Entries are applied PARENTS FIRST, and each result is folded into the working
 *  copy before the next is computed. A selection may legitimately contain both
 *  an object and one of its own descendants (a group and a child inside it), and
 *  the child's rebase divides by its parent's world matrix. Computing the child
 *  against the parent's PRE-drag world bakes the drag delta into the child's
 *  local, which the parent's own new transform then applies a second time — the
 *  child moves twice as far as the gizmo. Parents first makes that child's local
 *  come out exactly unchanged, which is the right answer: applying one transform
 *  P to a parent and its child leaves their relationship alone.
 *
 *  Ids not present in `objects` are skipped. Root-level objects (no `parentId`)
 *  take their world transform verbatim. Pure — `objects` is never mutated. */
export function rebaseMany(
  objects: readonly SceneObject[],
  entries: readonly { id: string; t: LocalTransform }[],
): { id: string; t: LocalTransform }[] {
  const wanted = new Map(entries.map((e) => [e.id, e.t]))
  // Working copy: rebasing a child must see its parent's ALREADY-REBASED local,
  // which is exactly what makes the ordering above load-bearing.
  let working = [...objects]
  const out: { id: string; t: LocalTransform }[] = []
  for (const o of orderParentsFirst(objects)) {
    const world = wanted.get(o.id)
    if (!world) continue
    let local: LocalTransform
    if (!o.parentId) {
      local = { position: world.position, rotation: world.rotation, scale: world.scale }
    } else {
      const worldMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...world.position),
        // XYZ everywhere — SceneObjectBase.rotation's documented order. A
        // mismatch here yields rotations that are wrong but still plausible.
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...world.rotation, 'XYZ')),
        new THREE.Vector3(...world.scale),
      )
      local = rebase(worldMatrix, worldMatrixOf(working, o.parentId))
    }
    out.push({ id: o.id, t: local })
    working = working.map((x) => (x.id === o.id ? { ...x, ...local } : x))
  }
  return out
}

/** The members of `ids` that have NO ancestor also in `ids` — the outermost
 *  objects of a selection, in `ids` order. Ids naming no object are dropped.
 *
 *  Exists because a transform delta applied to a group already reaches that
 *  group's children through the scene graph. Selecting a group AND one of its
 *  own children is a legal, one-shift-click-away state, and applying the same
 *  delta to both would move the child twice as far as the user asked for. The
 *  outermost member is the one that carries the delta.
 *
 *  A broken or cyclic ancestor chain (defensive — `sanitizeHierarchy` should
 *  have cut it) terminates the walk and counts the object as outermost, so a
 *  malformed doc drops an object out of a fan-out rather than hanging. */
export function outermostIds(objects: readonly SceneObject[], ids: readonly string[]): string[] {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const wanted = new Set(ids)
  return ids.filter((id) => {
    const start = byId.get(id)
    if (!start) return false
    const seen = new Set<string>([id])
    let current = start
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent || seen.has(parent.id)) break
      if (wanted.has(parent.id)) return false
      seen.add(parent.id)
      current = parent
    }
    return true
  })
}

/** Transform-row fan-out for a multi-selection: the writes that apply the same
 *  DELTA on one axis to every selected object.
 *
 *  Delta, never the same absolute value — typing a Position X of 3 with three
 *  objects selected must nudge all three by the same amount, not stack them on
 *  top of each other at x = 3. So the typed number lands verbatim on the PRIMARY
 *  (the last entry, the object whose value the panel is displaying) and every
 *  other member shifts by `next - primaryCurrent`.
 *
 *  `next` is in DOC units — radians for `rotation`, not the degrees the panel
 *  edits in. The caller converts, exactly as the single-selection path already
 *  did.
 *
 *  The primary always receives the typed value even when it sits inside another
 *  selected object: the row edits a LOCAL transform, so the number in the field
 *  has to become true whatever its ancestors are doing. Other members receive
 *  the delta only when they are outermost — see `outermostIds`.
 *
 *  Pure: returns writes for the caller to apply, and never touches `objects`. */
export function axisDeltaWrites(
  objects: readonly SceneObject[],
  ids: readonly string[],
  prop: 'position' | 'rotation' | 'scale',
  axis: 0 | 1 | 2,
  next: number,
): { id: string; value: number }[] {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const primaryId = ids[ids.length - 1]
  const primary = primaryId ? byId.get(primaryId) : undefined
  if (!primary) return []
  const delta = next - primary[prop][axis]
  const out = [{ id: primary.id, value: next }]
  // An unchanged value fans out nothing rather than re-writing everyone's
  // current number: those writes are no-ops the deep doc watcher would still
  // pay a full engine sync for.
  if (delta === 0) return out
  for (const id of outermostIds(objects, ids)) {
    if (id === primary.id) continue
    const o = byId.get(id)!
    out.push({ id, value: o[prop][axis] + delta })
  }
  return out
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

/** Clone `rootId` and its whole subtree, returning the clones — root's clone
 *  first, then descendants in the order `descendantIds` walks them (parents
 *  before their own children) — with each clone's `parentId` re-pointed at the
 *  CLONED ancestor, never left naming an object in the ORIGINAL subtree. Left
 *  unmapped, a child clone's `parentId` would still point at the SOURCE
 *  parent, so a "self-contained" duplicate would secretly stay wired into the
 *  original — deleting or moving the source would take pieces of the
 *  duplicate with it.
 *
 *  `make` is threaded an ACCUMULATING `existing` array — every clone produced
 *  so far in this call, root's included — because `existing` doubles as the
 *  name-uniqueness scope object factories number a new name against. Handing
 *  every clone in a batch the SAME starting snapshot instead of one that
 *  grows as clones are made is what let two clones collide on a name: a group
 *  named "Group" containing a group named "Group 2" — duplicating the outer
 *  group numbers the copy "Group 3" against the doc, but if the inner clone
 *  is then numbered against that same stale doc snapshot (not one containing
 *  the copy), it ALSO becomes "Group 3". Seeding the scope with the root's own
 *  clone before any descendant is cloned is what closes that gap.
 *
 *  `make` fabricates the new id/object, so this function stays engine- and
 *  factory-agnostic — it only orchestrates cloning order and `parentId`
 *  remapping, which is what makes it unit-testable with a fake `make`. */
export function cloneSubtree(
  objects: readonly SceneObject[],
  rootId: string,
  make: (src: SceneObject, existing: SceneObject[]) => SceneObject,
): SceneObject[] {
  const root = objects.find((o) => o.id === rootId)
  if (!root) return []

  // The scope every clone in this batch is numbered against — starts as the
  // pre-duplicate doc and grows with each clone, root's included, so no two
  // clones made here can ever see the same stale snapshot.
  let scope = [...objects]
  const idMap = new Map<string, string>()
  const clones: SceneObject[] = []

  const rootClone = make(root, scope)
  scope = [...scope, rootClone]
  idMap.set(rootId, rootClone.id)
  clones.push(rootClone)

  for (const descId of descendantIds(objects, rootId)) {
    const src = objects.find((o) => o.id === descId)
    if (!src) continue
    const clone = make(src, scope)
    scope = [...scope, clone]
    idMap.set(descId, clone.id)
    clones.push(clone)
  }

  // Remap every clone's parentId through idMap in one pass at the end, not as
  // each clone is made — a clone's parentId travels VERBATIM off its source
  // (see cloneObject), so it still names the ORIGINAL ancestor until this
  // rewrite runs. Root's own parentId is deliberately left alone: its parent
  // sits outside the subtree and is never a key in idMap, so the lookup below
  // is a no-op for it.
  for (const clone of clones) {
    if (clone.parentId && idMap.has(clone.parentId)) clone.parentId = idMap.get(clone.parentId)!
  }

  return clones
}

/** Dissolve every group named in `groupIds` and report the ids that should
 *  become the new selection. Exists because a selection can legitimately
 *  contain a group AND one of its own descendant groups (e.g. `A -> B -> D`
 *  with both `A` and `B` selected) — dissolving `A` frees `B` as a child, but
 *  `B` is itself in `groupIds` and gets dissolved right after. A naive loop
 *  that just concatenates each group's freed children (as the Vue surface
 *  used to) reports `B`'s id as part of the new selection even though `B` no
 *  longer exists in the returned array: `B` was ALSO in `groupIds`, so it gets
 *  dissolved on its own iteration and stops existing. That phantom id is not
 *  cosmetic — a `selectedIds.length >= 2` "can group" guard reads true for a
 *  single surviving object, and Cmd+G immediately after ungrouping silently
 *  filters the dead id out and produces a pointless one-child group, exactly
 *  the state the guard exists to prevent.
 *
 *  `freedIds` is therefore built as a Set across all iterations — because
 *  processing order can revisit the same eventual survivor twice (dissolving
 *  the inner group before the outer one frees the same descendant again) —
 *  and then filtered down to ids that still exist in the final `objects`. For
 *  `A -> B -> D` with both dissolved, the only surviving freed object is `D`,
 *  so `freedIds` is `[D.id]` regardless of the order `groupIds` lists `A`/`B`
 *  in. An id in `groupIds` that is not a group (or does not exist) is skipped,
 *  matching `ungroupObject`'s own no-op behaviour for such ids. */
export function ungroupMany(
  objects: readonly SceneObject[],
  groupIds: readonly string[],
): { objects: SceneObject[]; freedIds: string[] } {
  let working = [...objects]
  const freed = new Set<string>()
  for (const id of groupIds) {
    const group = working.find((o) => o.id === id)
    if (!group || group.kind !== 'group') continue
    for (const child of childrenOf(working, id)) freed.add(child.id)
    working = ungroupObject(working, id)
  }
  const survivingIds = new Set(working.map((o) => o.id))
  const freedIds = [...freed].filter((id) => survivingIds.has(id))
  return { objects: working, freedIds }
}
