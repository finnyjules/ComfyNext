import { describe, it, expect } from 'vitest'
import { stripSketchProperties, vacateSketchSlot } from '~/lib/draft/keepSketchCard'

describe('stripSketchProperties', () => {
  it('removes all sketch-identity keys, keeps everything else', () => {
    const r = stripSketchProperties({
      sketchOutput: true,
      sketchSourceId: '123',
      sketchSlot: 2,
      sketchLoading: false,
      sketchPrompt: 'a cat',
      sketchSeed: 42,
      locked: true,
      seedLocks: { seed: true },
    })
    expect(r).toEqual({ locked: true, seedLocks: { seed: true } })
  })

  it('is a no-op on a plain (non-sketch) properties bag', () => {
    expect(stripSketchProperties({ locked: false })).toEqual({ locked: false })
  })

  it('handles undefined/null input', () => {
    expect(stripSketchProperties(undefined)).toEqual({})
    expect(stripSketchProperties(null)).toEqual({})
  })

  it('does not mutate the input object', () => {
    const input = { sketchOutput: true, kept: 1 }
    stripSketchProperties(input)
    expect(input).toEqual({ sketchOutput: true, kept: 1 })
  })
})

describe('vacateSketchSlot', () => {
  it('vacates the slot as a HOLE, leaving array length and other slots intact', () => {
    const cardIds = ['id-0', 'id-1', 'id-2', 'id-3']
    const result = vacateSketchSlot(cardIds, 1, 'id-1')
    // Regression guard for the old `.filter(id => id !== cardId)` bug: that
    // shifted id-2/id-3 down into slots 1/2, corrupting the positional
    // slot→id mapping planSketchCardsAt relies on. A hole must NOT reindex.
    expect(result).toEqual(['id-0', null, 'id-2', 'id-3'])
    expect(result).toHaveLength(4)
  })

  it('vacates slot 0 without disturbing slots 1-3', () => {
    const cardIds = ['id-0', 'id-1', 'id-2', 'id-3']
    const result = vacateSketchSlot(cardIds, 0, 'id-0')
    expect(result).toEqual([null, 'id-1', 'id-2', 'id-3'])
  })

  it('is a no-op when the slot no longer holds the given cardId (stale event)', () => {
    const cardIds = ['id-0', 'id-1', 'id-2', 'id-3']
    const result = vacateSketchSlot(cardIds, 1, 'stale-id')
    expect(result).toEqual(['id-0', 'id-1', 'id-2', 'id-3'])
  })

  it('is a no-op when the slot is out of range', () => {
    const cardIds = ['id-0', 'id-1']
    const result = vacateSketchSlot(cardIds, 5, 'id-0')
    expect(result).toEqual(['id-0', 'id-1'])
  })

  it('does not mutate the input array', () => {
    const cardIds = ['id-0', 'id-1', 'id-2', 'id-3']
    vacateSketchSlot(cardIds, 2, 'id-2')
    expect(cardIds).toEqual(['id-0', 'id-1', 'id-2', 'id-3'])
  })
})
