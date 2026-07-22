import { describe, it, expect } from 'vitest'
import {
  buildSketchPilePayload, refreshSketchPile, stackItemWidth, keptCardPosition, planKeptCard,
  SKETCH_PROP, MAX_SKETCH_ITEMS, STACK_ITEM_MIN_W, STACK_ITEM_MAX_W, KEEP_CARD_SIZE, KEEP_GAP,
} from '~/lib/sketch/sketchPile'

describe('buildSketchPilePayload', () => {
  it('builds a payload with items from images, capped at 4', () => {
    const p = buildSketchPilePayload({
      prompt: 'a dog', seed: 7, sourceNodeId: '12',
      images: ['a', 'b', 'c', 'd', 'e'],
    })
    expect(p.prompt).toBe('a dog')
    expect(p.seed).toBe(7)
    expect(p.sourceNodeId).toBe('12')
    expect(p.items).toEqual([{ image: 'a' }, { image: 'b' }, { image: 'c' }, { image: 'd' }])
    expect(p.keptCount).toBe(0)
    expect(p.loading).toBeUndefined()
  })

  it('supports the empty skeleton (loading) form', () => {
    const p = buildSketchPilePayload({ prompt: 'x', seed: 1, sourceNodeId: '3', loading: true })
    expect(p.items).toEqual([])
    expect(p.loading).toBe(true)
  })
})

describe('refreshSketchPile', () => {
  const base = buildSketchPilePayload({ prompt: 'old', seed: 1, sourceNodeId: '3', images: ['x'] })

  it('replaces items, clears loading, preserves sourceNodeId/keptCount', () => {
    const withKept = { ...base, keptCount: 2, loading: true }
    const next = refreshSketchPile(withKept, { images: ['a', 'b'] })
    expect(next.items).toEqual([{ image: 'a' }, { image: 'b' }])
    expect(next.loading).toBe(false)
    expect(next.keptCount).toBe(2)
    expect(next.sourceNodeId).toBe('3')
    expect(next.prompt).toBe('old') // untouched when not passed
  })

  it('updates prompt/seed when passed and caps at MAX_SKETCH_ITEMS', () => {
    const next = refreshSketchPile(base, { images: ['a', 'b', 'c', 'd', 'e'], prompt: 'new', seed: 9 })
    expect(next.items).toHaveLength(MAX_SKETCH_ITEMS)
    expect(next.prompt).toBe('new')
    expect(next.seed).toBe(9)
  })

  it('can enter the loading state keeping stale items for the shimmer swap', () => {
    const next = refreshSketchPile(base, { images: [], loading: true })
    expect(next.loading).toBe(true)
    expect(next.items).toEqual([]) // re-roll passes [] — overlay shows 4 shimmer slots
  })

  it('does not mutate the input payload', () => {
    refreshSketchPile(base, { images: ['z'] })
    expect(base.items).toEqual([{ image: 'x' }])
  })
})

describe('stackItemWidth', () => {
  it('passes through in-range widths and clamps outside', () => {
    expect(stackItemWidth(200)).toBe(200)
    expect(stackItemWidth(40)).toBe(STACK_ITEM_MIN_W)
    expect(stackItemWidth(900)).toBe(STACK_ITEM_MAX_W)
  })
})

describe('keptCardPosition', () => {
  it('marches a keeper column down the left of the pile', () => {
    const pile = { x: 1000, y: 500 }
    expect(keptCardPosition(pile, 0)).toEqual({ x: 1000 - (KEEP_CARD_SIZE + KEEP_GAP + 40), y: 500 })
    expect(keptCardPosition(pile, 2)).toEqual({ x: 1000 - (KEEP_CARD_SIZE + KEEP_GAP + 40), y: 500 + 2 * (KEEP_CARD_SIZE + KEEP_GAP) })
  })
})

describe('SKETCH_PROP', () => {
  it('is the documented property key', () => {
    expect(SKETCH_PROP).toBe('sailor_sketch')
  })
})

describe('planKeptCard', () => {
  const pile = { x: 1000, y: 500 }
  const payload = { ...buildSketchPilePayload({ prompt: 'x', seed: 1, sourceNodeId: '3', images: ['a', 'b'] }), keptCount: 1 }

  it('plans a PLAIN Image card (no sketch properties) at the keeper-column slot', () => {
    const plan = planKeptCard(pile, payload, 1)
    expect(plan).toEqual({
      nodeType: 'Image',
      image: 'b',
      position: keptCardPosition(pile, 1), // uses the CURRENT keptCount slot
      nextKeptCount: 2,
    })
    // A plain card by construction: the plan carries no properties bag at all,
    // so the impure half can't accidentally stamp sketch identity onto it.
    expect('properties' in (plan as any)).toBe(false)
  })

  it('returns null for an out-of-range or missing item', () => {
    expect(planKeptCard(pile, payload, 5)).toBeNull()
    expect(planKeptCard(pile, payload, -1)).toBeNull()
    const empty = buildSketchPilePayload({ prompt: 'x', seed: 1, sourceNodeId: '3', loading: true })
    expect(planKeptCard(pile, empty, 0)).toBeNull()
  })
})
