import { describe, it, expect } from 'vitest'
import { pruneWiredSlotFlags, insertStackKeyAbove } from '~/lib/compositor/wiredSlots'

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
