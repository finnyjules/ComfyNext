import { describe, it, expect } from 'vitest'
import { pruneWiredSlotFlags, insertStackKeyAbove, pruneSlotKeyedRecord } from '~/lib/compositor/wiredSlots'

describe('pruneWiredSlotFlags', () => {
  it('drops flags for slots that no longer have a wire', () => {
    expect(pruneWiredSlotFlags([2, 5], [1, 2])).toEqual([2])
  })
  it('returns null when every flagged slot is still live (no write needed)', () => {
    expect(pruneWiredSlotFlags([2], [1, 2])).toBeNull()
  })
  it('returns null for an empty flag list', () => {
    expect(pruneWiredSlotFlags([], [1])).toBeNull()
  })
  it('drops everything when no slots are wired', () => {
    expect(pruneWiredSlotFlags([2, 3], [])).toEqual([])
  })
  it('preserves the original order of surviving entries', () => {
    expect(pruneWiredSlotFlags([5, 1, 3], [1, 5])).toEqual([5, 1])
  })
})

describe('insertStackKeyAbove', () => {
  it('inserts directly above the anchor (array is bottom→top)', () => {
    expect(insertStackKeyAbove(['w:1', 'w:2', 'l:a'], 'l:new', 'w:2'))
      .toEqual(['w:1', 'w:2', 'l:new', 'l:a'])
  })
  it('appends to the top when the anchor is absent', () => {
    expect(insertStackKeyAbove(['w:1'], 'l:new', 'w:9')).toEqual(['w:1', 'l:new'])
  })
  it('moves the key rather than duplicating it when already present', () => {
    expect(insertStackKeyAbove(['l:new', 'w:1'], 'l:new', 'w:1')).toEqual(['w:1', 'l:new'])
  })
  it('does not mutate the input array', () => {
    const order = ['w:1', 'w:2']
    insertStackKeyAbove(order, 'l:new', 'w:1')
    expect(order).toEqual(['w:1', 'w:2'])
  })
})

describe('pruneSlotKeyedRecord', () => {
  const parseW = (key: string) => {
    const m = /^w:(\d+)$/.exec(key)
    return m ? Number(m[1]) : null
  }
  const parseBare = (key: string) => (/^\d+$/.test(key) ? Number(key) : null)

  it("drops a w:<slot> entry whose slot isn't live, keeps live ones", () => {
    const rec = { 'w:1': { maskUrl: 'a' }, 'w:2': { maskUrl: 'b' } }
    expect(pruneSlotKeyedRecord(rec, [1], parseW)).toEqual({ 'w:1': { maskUrl: 'a' } })
  })

  it('returns null when every entry is live (no write)', () => {
    const rec = { 'w:1': { maskUrl: 'a' } }
    expect(pruneSlotKeyedRecord(rec, [1, 2], parseW)).toBeNull()
  })

  it('returns null for an empty record', () => {
    expect(pruneSlotKeyedRecord({}, [1], parseW)).toBeNull()
  })

  it("keeps keys that parseSlot doesn't recognize (e.g. a junk key)", () => {
    const rec = { 'w:1': { maskUrl: 'a' }, junk: { maskUrl: 'z' } }
    expect(pruneSlotKeyedRecord(rec, [], parseW)).toEqual({ junk: { maskUrl: 'z' } })
  })

  it('does not mutate the input object', () => {
    const rec = { 'w:1': { maskUrl: 'a' }, 'w:2': { maskUrl: 'b' } }
    pruneSlotKeyedRecord(rec, [1], parseW)
    expect(rec).toEqual({ 'w:1': { maskUrl: 'a' }, 'w:2': { maskUrl: 'b' } })
  })

  it('works with a bare-number key parser (the cloners case)', () => {
    const rec = { '1': { seed: 1 }, '2': { seed: 2 } }
    expect(pruneSlotKeyedRecord(rec, [2], parseBare)).toEqual({ '2': { seed: 2 } })
  })
})
