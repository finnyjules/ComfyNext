import { describe, it, expect } from 'vitest'
import {
  rootObjects, childrenOf, descendantIds, orderParentsFirst, sanitizeHierarchy, cloneSubtree,
} from '~/lib/scene3d/hierarchy'
import type { SceneObject } from '~/lib/scene3d/config'

/** Minimal stand-in — hierarchy.ts only ever reads `id` and `parentId`. */
function obj(id: string, parentId?: string): SceneObject {
  return {
    kind: 'primitive', primitive: 'box', id, name: id, visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { type: 'standard' } as SceneObject['material'],
    ...(parentId ? { parentId } : {}),
  }
}

/** True if ANY object's ancestor chain revisits a node before terminating —
 *  the property `sanitizeHierarchy` promises. Counting how many objects still
 *  carry a `parentId` (the old assertion) only proves the right NUMBER of
 *  edges survived, not that the survivors are acyclic — a fix that cuts one
 *  cycle but leaves a second independent one, or cuts the wrong edge and
 *  leaves a shorter loop, can still land on the expected count. Walking every
 *  chain with a seen-set is what actually catches that. */
function hasAnyCycle(objects: readonly SceneObject[]): boolean {
  const byId = new Map(objects.map(o => [o.id, o]))
  return objects.some((o) => {
    const seen = new Set<string>([o.id])
    let current = o
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent) return false
      if (seen.has(parent.id)) return true
      seen.add(parent.id)
      current = parent
    }
    return false
  })
}

describe('scene3d hierarchy', () => {
  it('lists roots and direct children', () => {
    const objects = [obj('g'), obj('a', 'g'), obj('b', 'g'), obj('c')]
    expect(rootObjects(objects).map(o => o.id)).toEqual(['g', 'c'])
    expect(childrenOf(objects, 'g').map(o => o.id)).toEqual(['a', 'b'])
    expect(childrenOf(objects, 'c')).toEqual([])
  })

  it('collects descendants breadth-first, excluding the object itself', () => {
    const objects = [obj('g'), obj('inner', 'g'), obj('leaf', 'inner'), obj('other')]
    expect(descendantIds(objects, 'g').sort()).toEqual(['inner', 'leaf'])
    expect(descendantIds(objects, 'leaf')).toEqual([])
  })

  it('orders parents before children regardless of array order', () => {
    const objects = [obj('leaf', 'inner'), obj('inner', 'g'), obj('g')]
    const ids = orderParentsFirst(objects).map(o => o.id)
    expect(ids.indexOf('g')).toBeLessThan(ids.indexOf('inner'))
    expect(ids.indexOf('inner')).toBeLessThan(ids.indexOf('leaf'))
  })

  it('preserves every object when ordering', () => {
    const objects = [obj('leaf', 'inner'), obj('inner', 'g'), obj('g'), obj('lone')]
    expect(orderParentsFirst(objects)).toHaveLength(4)
  })

  it('drops a parentId that resolves to no object', () => {
    const objects = [obj('a', 'ghost')]
    sanitizeHierarchy(objects)
    expect(objects[0]!.parentId).toBeUndefined()
  })

  it('breaks a two-object cycle', () => {
    const objects = [obj('a', 'b'), obj('b', 'a')]
    sanitizeHierarchy(objects)
    // Exactly one edge is cut, so the pair becomes a chain rather than a loop.
    const withParent = objects.filter(o => o.parentId)
    expect(withParent).toHaveLength(1)
    expect(hasAnyCycle(objects)).toBe(false)
    expect(() => orderParentsFirst(objects)).not.toThrow()
  })

  it('breaks a three-object cycle', () => {
    const objects = [obj('a', 'c'), obj('b', 'a'), obj('c', 'b')]
    sanitizeHierarchy(objects)
    expect(objects.filter(o => o.parentId)).toHaveLength(2)
    expect(hasAnyCycle(objects)).toBe(false)
    expect(orderParentsFirst(objects)).toHaveLength(3)
  })

  it('breaks two independent cycles, including one a chain feeds into', () => {
    // 'a' is not itself in a cycle — it merely points at one ('b'), which
    // together with 'c' forms a loop. A survivor-count-only assertion could
    // pass here by coincidence even if the wrong edge got cut; walking every
    // chain is what actually proves nothing still loops.
    const objects = [
      obj('a', 'b'), obj('b', 'c'), obj('c', 'b'),
      obj('d', 'e'), obj('e', 'd'),
    ]
    sanitizeHierarchy(objects)
    expect(hasAnyCycle(objects)).toBe(false)
    expect(() => orderParentsFirst(objects)).not.toThrow()
  })

  it('rejects an object parented to itself', () => {
    const objects = [obj('a', 'a')]
    sanitizeHierarchy(objects)
    expect(objects[0]!.parentId).toBeUndefined()
  })

  it('leaves a valid hierarchy untouched', () => {
    const objects = [obj('g'), obj('a', 'g')]
    sanitizeHierarchy(objects)
    expect(objects[1]!.parentId).toBe('g')
  })
})

// ── cloneSubtree: duplicate's clone-and-remap, extracted so it can be pinned
// with a counting fake `make` instead of only exercised through the Vue
// surface. A real `make` (Scene3DStudioSurface's `cloneObject`) fabricates a
// fresh id and numbers the copy's name against `existing`; this fake instead
// derives a deterministic id from the source's own id and RECORDS every
// `existing` array it was handed, so the batch-accumulation behaviour is
// directly observable rather than inferred from names.
function fakeCloneFactory() {
  const calls: { srcId: string; existingIds: string[] }[] = []
  const make = (src: SceneObject, existing: SceneObject[]): SceneObject => {
    calls.push({ srcId: src.id, existingIds: existing.map((o) => o.id) })
    // parentId travels verbatim off the source, exactly like the real
    // cloneObject — cloneSubtree is what's responsible for remapping it.
    return { ...src, id: `${src.id}-clone` }
  }
  return { make, calls }
}

describe('scene3d cloneSubtree', () => {
  it('clones a childless object as a single clone, leaving its own parentId untouched', () => {
    // 'a' sits under an external ancestor ('outer') that is not part of the
    // subtree being cloned — its parentId must survive verbatim, not get
    // remapped, since 'outer' is never a key in cloneSubtree's id map.
    const objects = [obj('outer'), obj('a', 'outer')]
    const { make } = fakeCloneFactory()
    const clones = cloneSubtree(objects, 'a', make)
    expect(clones).toHaveLength(1)
    expect(clones[0]!.id).toBe('a-clone')
    expect(clones[0]!.parentId).toBe('outer')
  })

  it('remaps every clone parentId to the CLONED ancestor, never the original, across a two-level subtree', () => {
    const objects = [obj('g'), obj('child', 'g'), obj('grand', 'child')]
    const { make } = fakeCloneFactory()
    const clones = cloneSubtree(objects, 'g', make)
    expect(clones.map((c) => c.id)).toEqual(['g-clone', 'child-clone', 'grand-clone'])

    const byId = new Map(clones.map((c) => [c.id, c]))
    expect(byId.get('g-clone')!.parentId).toBeUndefined()
    expect(byId.get('child-clone')!.parentId).toBe('g-clone')
    expect(byId.get('grand-clone')!.parentId).toBe('child-clone')

    // No clone's parentId names an ORIGINAL id — every non-root clone's
    // parentId must resolve inside the clone set, not the source subtree.
    const originalIds = new Set(objects.map((o) => o.id))
    for (const clone of clones) {
      if (clone.parentId) expect(originalIds.has(clone.parentId)).toBe(false)
    }
  })

  // THE regression test for the naming-collision fix: a group named "Group"
  // containing a group named "Group 2" duplicated the outer group, and the
  // inner clone was numbered against the SAME stale `doc.objects` snapshot the
  // outer clone was numbered against — both became "Group 3". Fixed by seeding
  // the accumulating scope with the root's own clone BEFORE any descendant is
  // cloned. Asserting on names would couple this test to a factory's specific
  // numbering scheme; asserting on the `existing` array `make` was actually
  // handed is the direct, factory-agnostic version of the same claim.
  it('hands the first child clone an existing-scope that already contains the root clone', () => {
    const objects = [obj('g'), obj('child', 'g')]
    const { make, calls } = fakeCloneFactory()
    cloneSubtree(objects, 'g', make)

    expect(calls).toHaveLength(2)
    const rootCall = calls[0]!
    const firstChildCall = calls[1]!
    expect(rootCall.srcId).toBe('g')
    expect(firstChildCall.srcId).toBe('child')
    expect(firstChildCall.existingIds).toContain('g-clone')
  })
})

import * as THREE from 'three'
import { worldMatrixOf, groupObjects, ungroupObject, ungroupMany } from '~/lib/scene3d/hierarchy'
import { createGroup } from '~/lib/scene3d/config'

/** World-space position of `id`, derived independently of the code under test. */
function worldPos(objects: SceneObject[], id: string): [number, number, number] {
  const v = new THREE.Vector3().setFromMatrixPosition(worldMatrixOf(objects, id))
  return [v.x, v.y, v.z]
}

function expectClose(a: readonly number[], b: readonly number[]) {
  a.forEach((n, i) => expect(n).toBeCloseTo(b[i]!, 5))
}

describe('scene3d group/ungroup transforms', () => {
  it('composes a parent transform into a child world matrix', () => {
    const parent = obj('p'); parent.position = [1, 0, 0]
    const child = obj('c', 'p'); child.position = [0, 2, 0]
    expectClose(worldPos([parent, child], 'c'), [1, 2, 0])
  })

  it('preserves world position when grouping', () => {
    const a = obj('a'); a.position = [1, 0, 0]
    const b = obj('b'); b.position = [3, 0, 0]
    const before = [worldPos([a, b], 'a'), worldPos([a, b], 'b')]
    const group = createGroup([a, b])
    const after = groupObjects([a, b], ['a', 'b'], group)
    expect(after.find(o => o.id === 'a')!.parentId).toBe(group.id)
    expectClose(worldPos(after, 'a'), before[0]!)
    expectClose(worldPos(after, 'b'), before[1]!)
  })

  it('places the group at the selection bounds centre', () => {
    const a = obj('a'); a.position = [1, 0, 0]
    const b = obj('b'); b.position = [3, 0, 0]
    const group = createGroup([a, b])
    const after = groupObjects([a, b], ['a', 'b'], group)
    expectClose(after.find(o => o.id === group.id)!.position, [2, 0, 0])
  })

  // THE test this feature lives or dies on. Rebasing by subtraction passes every
  // assertion above and fails this one: a rotated parent means the child's local
  // offset is no longer its world offset.
  it('preserves world position when grouping under a ROTATED, SCALED ancestor', () => {
    const outer = obj('outer')
    outer.position = [5, 1, -2]
    outer.rotation = [0, Math.PI / 3, Math.PI / 7]
    outer.scale = [2, 0.5, 1.5]
    const a = obj('a', 'outer'); a.position = [1, 0, 0]
    const b = obj('b', 'outer'); b.position = [0, 3, 1]
    const objects = [outer, a, b]
    const before = [worldPos(objects, 'a'), worldPos(objects, 'b')]

    // Expected group world position: bounds centre of the members' world
    // origins, computed independently from `before` (captured pre-grouping)
    // rather than by calling back into the code under test — for two points
    // the componentwise min/max average coincides with the componentwise
    // mean, so this is exact, not an approximation.
    const expectedGroupWorldPos: [number, number, number] = [
      (before[0]![0] + before[1]![0]) / 2,
      (before[0]![1] + before[1]![1]) / 2,
      (before[0]![2] + before[1]![2]) / 2,
    ]

    const group = createGroup(objects)
    group.parentId = 'outer'
    const after = groupObjects(objects, ['a', 'b'], group)

    expectClose(worldPos(after, 'a'), before[0]!)
    expectClose(worldPos(after, 'b'), before[1]!)

    // The group itself: its WORLD position must land at the selection's
    // bounds centre even though it has a rotated, non-uniformly-scaled
    // parent (naive `centre - parentWorld.position` subtraction would miss
    // this), and its LOCAL rotation/scale must stay identity — a group
    // inherits its parent's orientation rather than correcting to world
    // identity, which is what decides gizmo orientation later.
    const placedGroup = after.find(o => o.id === group.id)!
    expectClose(worldPos(after, group.id), expectedGroupWorldPos)
    expectClose(placedGroup.rotation, [0, 0, 0])
    expectClose(placedGroup.scale, [1, 1, 1])
  })

  it('preserves world position when ungrouping under a rotated ancestor', () => {
    const outer = obj('outer')
    outer.position = [0, 2, 0]
    outer.rotation = [Math.PI / 5, Math.PI / 3, 0]
    outer.scale = [1.5, 1.5, 1.5]
    const group = createGroup([outer]) as SceneObject
    group.parentId = 'outer'
    group.position = [1, 0, 2]
    group.rotation = [0, Math.PI / 4, 0]
    const a = obj('a', group.id); a.position = [2, 0, 0]
    const objects = [outer, group, a]
    const before = worldPos(objects, 'a')

    const after = ungroupObject(objects, group.id)
    expect(after.find(o => o.id === group.id)).toBeUndefined()
    expect(after.find(o => o.id === 'a')!.parentId).toBe('outer')
    expectClose(worldPos(after, 'a'), before)
  })

  it('group then ungroup is an identity on world transforms', () => {
    const a = obj('a'); a.position = [1, 2, 3]; a.rotation = [0.3, 0.4, 0.5]; a.scale = [1, 2, 3]
    const b = obj('b'); b.position = [-4, 0, 1]
    const before = [worldPos([a, b], 'a'), worldPos([a, b], 'b')]
    const group = createGroup([a, b])
    const grouped = groupObjects([a, b], ['a', 'b'], group)
    const back = ungroupObject(grouped, group.id)
    expectClose(worldPos(back, 'a'), before[0]!)
    expectClose(worldPos(back, 'b'), before[1]!)
  })

  it('refuses to group an object into its own descendant', () => {
    const g = createGroup([]) as SceneObject
    const child = obj('child', g.id)
    const inner = createGroup([g, child])
    inner.parentId = 'child'
    const after = groupObjects([g, child, inner], [g.id], inner)
    // The illegal reparent is skipped, leaving the graph acyclic.
    expect(after.find(o => o.id === g.id)!.parentId).toBeUndefined()
  })
})

// ── ungroupMany: dissolving multiple selected groups at once ─────────────────
// Lives here (not in the Vue surface) precisely so the nested-selection case —
// a group AND one of its own descendant groups both selected — can be pinned
// with a real assertion. See ungroupMany's doc comment in hierarchy.ts for the
// phantom-selection bug this replaces.

describe('scene3d ungroupMany', () => {
  it('dissolves a single group, freeing its children with world position preserved', () => {
    const outer = obj('outer')
    outer.position = [0, 2, 0]
    outer.rotation = [Math.PI / 5, Math.PI / 3, 0]
    outer.scale = [1.5, 1.5, 1.5]
    const group = createGroup([outer]) as SceneObject
    group.parentId = 'outer'
    group.position = [1, 0, 2]
    group.rotation = [0, Math.PI / 4, 0]
    const a = obj('a', group.id); a.position = [2, 0, 0]
    const b = obj('b', group.id); b.position = [0, 1, 1]
    const objects = [outer, group, a, b]
    const before = [worldPos(objects, 'a'), worldPos(objects, 'b')]

    const { objects: after, freedIds } = ungroupMany(objects, [group.id])

    expect(after.find(o => o.id === group.id)).toBeUndefined()
    expect(freedIds.sort()).toEqual(['a', 'b'])
    expect(after.find(o => o.id === 'a')!.parentId).toBe('outer')
    expect(after.find(o => o.id === 'b')!.parentId).toBe('outer')
    expectClose(worldPos(after, 'a'), before[0]!)
    expectClose(worldPos(after, 'b'), before[1]!)
  })

  // THE regression test. A and B are both groups, B nested inside A (A -> B -> D).
  // Selecting both and ungrouping must not report B's id as part of the new
  // selection — B is dissolved on its own iteration, same as A, so only D
  // survives. A naive "concatenate each group's freed children" loop (the bug
  // this replaces) reports [B.id, D.id]: a dead id sitting in the selection
  // that a `selectedIds.length >= 2` guard reads as "still two objects."
  it('ungrouping a group together with its own nested child group leaves only the true survivor', () => {
    const a = createGroup([]) as SceneObject
    a.id = 'a'; a.position = [1, 0, 0]
    const b = createGroup([]) as SceneObject
    b.id = 'b'; b.parentId = 'a'; b.position = [0, 2, 0]
    const d = obj('d', 'b'); d.position = [0, 0, 3]
    const objects = [a, b, d]
    const beforeD = worldPos(objects, 'd')

    const { objects: after, freedIds } = ungroupMany(objects, ['a', 'b'])

    expect(after.find(o => o.id === 'a')).toBeUndefined()
    expect(after.find(o => o.id === 'b')).toBeUndefined()
    expect(freedIds).toEqual(['d'])
    expect(freedIds).not.toContain('b')
    expectClose(worldPos(after, 'd'), beforeD)

    // Order-independence: selecting them in the opposite order must land on
    // the exact same surviving selection.
    const reversed = ungroupMany(objects, ['b', 'a'])
    expect(reversed.freedIds).toEqual(['d'])
  })

  it('ignores ids in groupIds that are not groups, or do not exist, without throwing', () => {
    const leaf = obj('leaf')
    const group = createGroup([leaf]) as SceneObject
    leaf.parentId = group.id
    const objects = [group, leaf]

    expect(() => ungroupMany(objects, ['leaf', 'ghost', group.id])).not.toThrow()
    const { objects: after, freedIds } = ungroupMany(objects, ['leaf', 'ghost', group.id])
    expect(after.find(o => o.id === group.id)).toBeUndefined()
    expect(freedIds).toEqual(['leaf'])
  })
})

// ── rebaseMany: the multi-selection gizmo's world→local conversion ───────────
// This is what the gizmo pivot's per-pointermove output goes through. It lives
// here rather than in the Vue surface precisely so the parents-before-children
// ordering — the subtlest rule in the multi-select drag — can be pinned.

import { rebaseMany, type LocalTransform } from '~/lib/scene3d/hierarchy'
import type { Vec3 } from '~/lib/scene3d/config'

/** Decompose a world matrix the way the gizmo does before reporting it. */
function trsOf(m: THREE.Matrix4): LocalTransform {
  const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3()
  m.decompose(p, q, s)
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return {
    position: [p.x, p.y, p.z] as Vec3,
    rotation: [e.x, e.y, e.z] as Vec3,
    scale: [s.x, s.y, s.z] as Vec3,
  }
}

/** What SceneInteraction emits after a drag that applied `delta` to the pivot:
 *  every selected root's NEW world transform. */
function draggedEntries(objects: SceneObject[], ids: string[], delta: THREE.Matrix4) {
  return ids.map(id => ({
    id,
    t: trsOf(new THREE.Matrix4().multiplyMatrices(delta, worldMatrixOf(objects, id))),
  }))
}

/** What the surface does with rebaseMany's output. */
function applyResults(objects: SceneObject[], results: { id: string; t: LocalTransform }[]): SceneObject[] {
  const byId = new Map(results.map(r => [r.id, r.t]))
  return objects.map(o => (byId.has(o.id) ? { ...o, ...byId.get(o.id)! } : o))
}

/** The world position `id` should end at: its old world position through `delta`. */
function expectedWorld(objects: SceneObject[], id: string, delta: THREE.Matrix4): [number, number, number] {
  const v = new THREE.Vector3().setFromMatrixPosition(
    new THREE.Matrix4().multiplyMatrices(delta, worldMatrixOf(objects, id)),
  )
  return [v.x, v.y, v.z]
}

/** A drag that both moves and TURNS the selection. A pure translation would let
 *  a naive subtraction-based rebase pass every assertion below. */
const dragDelta = new THREE.Matrix4()
  .makeRotationY(Math.PI / 2)
  .premultiply(new THREE.Matrix4().makeTranslation(0, 0, 5))

describe('scene3d rebaseMany', () => {
  it('takes root-level world transforms verbatim, and ignores unknown ids', () => {
    const a = obj('a'); a.position = [1, 0, 0]
    const b = obj('b'); b.position = [0, 0, 3]; b.rotation = [0, Math.PI / 4, 0]
    const objects = [a, b]
    const entries = [...draggedEntries(objects, ['a', 'b'], dragDelta), {
      id: 'ghost', t: { position: [9, 9, 9] as Vec3, rotation: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 },
    }]

    const results = rebaseMany(objects, entries)
    expect(results.map(r => r.id).sort()).toEqual(['a', 'b'])

    const after = applyResults(objects, results)
    expectClose(worldPos(after, 'a'), expectedWorld(objects, 'a', dragDelta))
    expectClose(worldPos(after, 'b'), expectedWorld(objects, 'b', dragDelta))
    // No parent to divide out, so the local IS the reported world transform.
    expectClose(results.find(r => r.id === 'a')!.t.position, expectedWorld(objects, 'a', dragDelta))
  })

  // THE test the parents-first ordering exists for. Applying one rigid transform
  // to both a parent and its own child does not change their RELATIONSHIP, so the
  // child's local must come out byte-for-byte what it went in as. Rebasing the
  // child against its parent's PRE-drag world instead bakes the delta into that
  // local, which the parent's own new transform then applies a second time — the
  // child ends up twice as far from where the gizmo put it. Reverse the ordering
  // inside rebaseMany and this test goes red on the very first assertion.
  it('leaves a child untouched when its own parent is dragged with it', () => {
    const p = obj('p'); p.position = [1, 0, 0]
    const c = obj('c', 'p'); c.position = [0, 2, 0]
    const objects = [p, c]

    const results = rebaseMany(objects, draggedEntries(objects, ['p', 'c'], dragDelta))
    const child = results.find(r => r.id === 'c')!.t
    expectClose(child.position, [0, 2, 0])
    expectClose(child.rotation, [0, 0, 0])
    expectClose(child.scale, [1, 1, 1])

    // …and both objects land exactly where the gizmo left them.
    const after = applyResults(objects, results)
    expectClose(worldPos(after, 'p'), expectedWorld(objects, 'p', dragDelta))
    expectClose(worldPos(after, 'c'), expectedWorld(objects, 'c', dragDelta))
  })

  // Array order must not matter either — the doc's object order is whatever
  // insertion happened to produce, so the ordering has to be DERIVED.
  it('is independent of the order the objects sit in the doc array', () => {
    const p = obj('p'); p.position = [1, 0, 0]
    const c = obj('c', 'p'); c.position = [0, 2, 0]
    const childFirst = rebaseMany([c, p], draggedEntries([c, p], ['c', 'p'], dragDelta))
    expectClose(childFirst.find(r => r.id === 'c')!.t.position, [0, 2, 0])
  })

  it('rebases through a rotated, non-uniformly scaled ancestor that is NOT selected', () => {
    const outer = obj('outer')
    outer.position = [5, 1, -2]
    outer.rotation = [Math.PI / 5, Math.PI / 3, 0]
    outer.scale = [2, 1, 3]
    const a = obj('a', 'outer'); a.position = [1, 0, 0]
    const b = obj('b', 'outer'); b.position = [0, 0, 2]; b.rotation = [0, Math.PI / 6, 0]
    const objects = [outer, a, b]

    const results = rebaseMany(objects, draggedEntries(objects, ['a', 'b'], dragDelta))
    const after = applyResults(objects, results)

    // Position is asserted, not rotation/scale: dividing a rotated delta by a
    // NON-UNIFORMLY scaled parent produces genuine shear, and THREE's decompose
    // drops shear silently — a TRS doc simply cannot express the linear part
    // exactly. The translation column survives that decompose intact, so the
    // objects still land where the gizmo put them, which is the invariant that
    // matters here.
    expectClose(worldPos(after, 'a'), expectedWorld(objects, 'a', dragDelta))
    expectClose(worldPos(after, 'b'), expectedWorld(objects, 'b', dragDelta))

    // Proves the rebase actually happened rather than the world being written
    // through: under this ancestor a local can never equal its own world.
    const localA = results.find(r => r.id === 'a')!.t.position
    expect(localA).not.toEqual(expectedWorld(objects, 'a', dragDelta))

    // The unselected ancestor is left alone.
    expect(after.find(o => o.id === 'outer')).toEqual(outer)
  })
})
