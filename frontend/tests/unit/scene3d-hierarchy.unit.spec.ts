import { describe, it, expect } from 'vitest'
import {
  rootObjects, childrenOf, descendantIds, orderParentsFirst, sanitizeHierarchy,
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

import * as THREE from 'three'
import { worldMatrixOf, groupObjects, ungroupObject } from '~/lib/scene3d/hierarchy'
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
