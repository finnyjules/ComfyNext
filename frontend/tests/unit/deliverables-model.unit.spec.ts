import { describe, it, expect } from 'vitest'
import {
  addSingle, group, ungroup, rename, remove, reorder, reorderWithinSet,
  removeFromSet, dissolveIfUnderTwo, isPresent, refKey, makeDeliverableId,
  type ArtifactRef, type DeliverableItem,
} from '~/lib/deliverables/model'

const ref = (f: string, sub = ''): ArtifactRef => ({ filename: f, subfolder: sub, media: 'image' })
let seq = 0
const mk = () => makeDeliverableId(++seq)

describe('deliverables model', () => {
  it('addSingle appends and defaults name from filename', () => {
    const list = addSingle([], ref('hero.png'), '', mk)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'single', name: 'hero.png' })
  })

  it('addSingle is a no-op for an already-present ref (same subfolder+filename)', () => {
    const a = addSingle([], ref('hero.png', 'out'), 'Hero', mk)
    const b = addSingle(a, ref('hero.png', 'out'), 'Hero again', mk)
    expect(b).toBe(a) // unchanged reference
  })

  it('isPresent detects refs inside sets', () => {
    let list = addSingle([], ref('a.png'), 'A', mk)
    list = addSingle(list, ref('b.png'), 'B', mk)
    list = group(list, [list[0]!.id, list[1]!.id], 'Set', mk)
    expect(isPresent(list, ref('a.png'))).toBe(true)
    expect(isPresent(list, ref('c.png'))).toBe(false)
  })

  it('group collects singles into a set at the first member position and requires >=2', () => {
    let list = addSingle([], ref('a.png'), 'A', mk)
    list = addSingle(list, ref('b.png'), 'B', mk)
    const one = group(list, [list[0]!.id], 'Solo', mk)
    expect(one).toBe(list) // <2 valid singles → unchanged
    const set = group(list, [list[0]!.id, list[1]!.id], 'Pair', mk)
    expect(set).toHaveLength(1)
    expect(set[0]).toMatchObject({ kind: 'set', name: 'Pair' })
    expect((set[0] as any).items.map((r: ArtifactRef) => r.filename)).toEqual(['a.png', 'b.png'])
  })

  it('ungroup restores members as top-level singles at the set position', () => {
    let list = addSingle([], ref('a.png'), 'A', mk)
    list = addSingle(list, ref('b.png'), 'B', mk)
    list = group(list, [list[0]!.id, list[1]!.id], 'Pair', mk)
    const flat = ungroup(list, list[0]!.id)
    expect(flat).toHaveLength(2)
    expect(flat.every(i => i.kind === 'single')).toBe(true)
  })

  it('removeFromSet dissolves a set that drops to one member', () => {
    let list = addSingle([], ref('a.png'), 'A', mk)
    list = addSingle(list, ref('b.png'), 'B', mk)
    list = group(list, [list[0]!.id, list[1]!.id], 'Pair', mk)
    const after = removeFromSet(list, list[0]!.id, 1)
    expect(after).toHaveLength(1)
    expect(after[0]!.kind).toBe('single')
  })

  it('reorder moves an item', () => {
    let list = addSingle([], ref('a.png'), 'A', mk)
    list = addSingle(list, ref('b.png'), 'B', mk)
    const moved = reorder(list, 0, 1)
    expect(moved.map(i => i.name)).toEqual(['B', 'A'])
  })

  it('rename and remove are pure', () => {
    const list = addSingle([], ref('a.png'), 'A', mk)
    const renamed = rename(list, list[0]!.id, 'Zed')
    expect(renamed[0]!.name).toBe('Zed')
    expect(list[0]!.name).toBe('A') // original untouched
    expect(remove(renamed, renamed[0]!.id)).toHaveLength(0)
  })

  it('reorderWithinSet reorders members correctly', () => {
    let list = addSingle([], ref('a.png'), 'A', mk)
    list = addSingle(list, ref('b.png'), 'B', mk)
    list = addSingle(list, ref('c.png'), 'C', mk)
    list = group(list, [list[0]!.id, list[1]!.id, list[2]!.id], 'Trio', mk)
    const setId = list[0]!.id
    const moved = reorderWithinSet(list, setId, 0, 2)
    expect((moved[0] as any).items.map((r: ArtifactRef) => r.filename)).toEqual(['b.png', 'c.png', 'a.png'])
  })

  it('rename with an unknown id returns the same list reference', () => {
    const list = addSingle([], ref('a.png'), 'A', mk)
    expect(rename(list, 'unknown-id', 'x')).toBe(list)
  })

  it('reorderWithinSet with from === to returns the same list reference', () => {
    let list = addSingle([], ref('a.png'), 'A', mk)
    list = addSingle(list, ref('b.png'), 'B', mk)
    list = group(list, [list[0]!.id, list[1]!.id], 'Pair', mk)
    const setId = list[0]!.id
    expect(reorderWithinSet(list, setId, 0, 0)).toBe(list)
  })

  it('reorderWithinSet with an unknown set id returns the same list reference', () => {
    let list = addSingle([], ref('a.png'), 'A', mk)
    list = addSingle(list, ref('b.png'), 'B', mk)
    list = group(list, [list[0]!.id, list[1]!.id], 'Pair', mk)
    expect(reorderWithinSet(list, 'unknown-set', 0, 1)).toBe(list)
  })

  it('removeFromSet with an unknown set id returns the same list reference', () => {
    const list = addSingle([], ref('a.png'), 'A', mk)
    expect(removeFromSet(list, 'unknown-set', 0)).toBe(list)
  })

  it('addSingle never regenerates an id already in the list after removals', () => {
    let list = addSingle([], ref('a.png'), 'A', mk)
    list = addSingle(list, ref('b.png'), 'B', mk)
    list = addSingle(list, ref('c.png'), 'C', mk)
    const existingIds = list.map(i => i.id)

    // Remove early items, then add a new single with a real unique-id generator.
    list = remove(list, list[0]!.id)
    list = remove(list, list[0]!.id)
    const remainingIds = new Set(list.map(i => i.id))

    list = addSingle(list, ref('d.png'), 'D', mk)
    const newItem = list[list.length - 1]!
    expect(existingIds).not.toContain(newItem.id)
    expect(remainingIds.has(newItem.id)).toBe(false)
  })
})
