import { describe, it, expect } from 'vitest'
import { planSketchCardsAt, sketchPadCardId } from '~/lib/sketch/planSketchCardsAt'

describe('planSketchCardsAt', () => {
  it('stacks the options vertically with slot 0 at the anchor', () => {
    const plans = planSketchCardsAt({ x: 100, y: 50 }, ['a', 'b', 'c', 'd'], [])
    expect(plans.map(p => p.position)).toEqual([
      { x: 100, y: 50 },        // slot 0
      { x: 100, y: 274 },       // slot 1: +224 (200+24)
      { x: 100, y: 498 },       // slot 2
      { x: 100, y: 722 },       // slot 3
    ])
    expect(plans.map(p => p.id)).toEqual([
      sketchPadCardId(0), sketchPadCardId(1), sketchPadCardId(2), sketchPadCardId(3),
    ])
    expect(plans.every(p => !p.reuse)).toBe(true)
  })

  it('reuses existing ids per slot and marks reuse', () => {
    const plans = planSketchCardsAt({ x: 0, y: 0 }, ['a', 'b'], ['keepme-0', 'keepme-1'])
    expect(plans[0].id).toBe('keepme-0')
    expect(plans[0].reuse).toBe(true)
    expect(plans[1].id).toBe('keepme-1')
  })

  it('caps at 4 images', () => {
    const plans = planSketchCardsAt({ x: 0, y: 0 }, ['a', 'b', 'c', 'd', 'e'], [])
    expect(plans).toHaveLength(4)
  })

  it('sketchPadCardId is stable per slot', () => {
    expect(sketchPadCardId(2)).toBe('sketch-out-sketch-pad-2')
  })
})
