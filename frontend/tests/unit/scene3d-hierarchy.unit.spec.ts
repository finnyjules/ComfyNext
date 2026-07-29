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
  } as SceneObject
}

describe('scene3d hierarchy', () => {
  it('lists roots and direct children', () => {
    const objects = [obj('g'), obj('a', 'g'), obj('b', 'g'), obj('c')]
    expect(rootObjects(objects).map(o => o.id)).toEqual(['g', 'c'])
    expect(childrenOf(objects, 'g').map(o => o.id)).toEqual(['a', 'b'])
    expect(childrenOf(objects, 'c')).toEqual([])
  })

  it('collects descendants depth-first, excluding the object itself', () => {
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
    expect(() => orderParentsFirst(objects)).not.toThrow()
  })

  it('breaks a three-object cycle', () => {
    const objects = [obj('a', 'c'), obj('b', 'a'), obj('c', 'b')]
    sanitizeHierarchy(objects)
    expect(objects.filter(o => o.parentId)).toHaveLength(2)
    expect(orderParentsFirst(objects)).toHaveLength(3)
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
