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
