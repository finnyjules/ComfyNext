import { describe, it, expect } from 'vitest'
import { planSketchCards, sketchCardId } from '~/lib/sketch/planSketchCards'

const source = { id: '42', position: { x: 100, y: 200 }, width: 220 }

describe('planSketchCards', () => {
  it('lays out a 2x2 grid to the right of the source', () => {
    const images = ['/view?filename=a.png&type=temp', '/view?filename=b.png&type=temp', '/view?filename=c.png&type=temp', '/view?filename=d.png&type=temp']
    const plans = planSketchCards(source, images, [])
    const sx = 100 + 220 + 80 // 400
    const sy = 200
    expect(plans.map(p => p.position)).toEqual([
      { x: sx, y: sy },
      { x: sx + 200 + 24, y: sy },
      { x: sx, y: sy + 200 + 24 },
      { x: sx + 200 + 24, y: sy + 200 + 24 },
    ])
  })

  it('maps each image to its slot in order', () => {
    const images = ['a', 'b', 'c', 'd']
    const plans = planSketchCards(source, images, [])
    expect(plans.map(p => p.image)).toEqual(['a', 'b', 'c', 'd'])
    expect(plans.map(p => p.slot)).toEqual([0, 1, 2, 3])
  })

  it('mints deterministic ids when no existing cards', () => {
    const plans = planSketchCards(source, ['a', 'b'], [])
    expect(plans.map(p => p.id)).toEqual([
      sketchCardId('42', 0),
      sketchCardId('42', 1),
    ])
    expect(plans.every(p => p.reuse === false)).toBe(true)
  })

  it('reuses existing card ids by slot when present', () => {
    const existing = ['card-a', 'card-b', '', 'card-d']
    const plans = planSketchCards(source, ['a', 'b', 'c', 'd'], existing)
    expect(plans[0]).toMatchObject({ id: 'card-a', reuse: true })
    expect(plans[1]).toMatchObject({ id: 'card-b', reuse: true })
    // slot 2 has no existing id (falsy empty string) -> mint
    expect(plans[2]).toMatchObject({ id: sketchCardId('42', 2), reuse: false })
    expect(plans[3]).toMatchObject({ id: 'card-d', reuse: true })
  })

  it('mints fresh ids for slots beyond the existing registry length', () => {
    const plans = planSketchCards(source, ['a', 'b', 'c'], ['card-a'])
    expect(plans[0]).toMatchObject({ id: 'card-a', reuse: true })
    expect(plans[1]).toMatchObject({ id: sketchCardId('42', 1), reuse: false })
    expect(plans[2]).toMatchObject({ id: sketchCardId('42', 2), reuse: false })
  })

  it('caps at 4 images even if more are provided', () => {
    const images = ['a', 'b', 'c', 'd', 'e', 'f']
    const plans = planSketchCards(source, images, [])
    expect(plans).toHaveLength(4)
    expect(plans.map(p => p.image)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('produces fewer plans when fewer than 4 images are given', () => {
    const plans = planSketchCards(source, ['only-one'], [])
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ slot: 0, image: 'only-one' })
  })

  it('produces no plans for an empty image list', () => {
    expect(planSketchCards(source, [], [])).toEqual([])
  })

  it('sketchCardId is deterministic per source+slot', () => {
    expect(sketchCardId('42', 0)).toBe(sketchCardId('42', 0))
    expect(sketchCardId('42', 0)).not.toBe(sketchCardId('42', 1))
    expect(sketchCardId('42', 0)).not.toBe(sketchCardId('7', 0))
  })
})
