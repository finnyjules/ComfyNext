// frontend/tests/unit/price-book.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { priceGraph, PRICE_BOOK_VERSION } from '~~/server/utils/priceBook'

const render = { '1': { class_type: 'KSampler' }, '2': { class_type: 'SaveImage' } }

describe('priceGraph', () => {
  it('charges the base render once for a plain image graph', () => {
    const p = priceGraph(render)
    expect(p.credits).toBe(1)
    expect(p.version).toBe(PRICE_BOOK_VERSION)
    expect(p.breakdown).toEqual([{ action: 'base_render', credits: 1 }])
  })

  it('adds premium per-action costs on top of the base render', () => {
    const p = priceGraph({ ...render, '3': { class_type: 'EditImageNode' } })
    expect(p.credits).toBe(13) // 1 base + 12 NB2 edit
    expect(p.breakdown).toContainEqual({ action: 'EditImageNode', credits: 12 })
  })

  it('does not charge a base render when the graph has no output node', () => {
    expect(priceGraph({ '1': { class_type: 'CheckpointLoaderSimple' } }).credits).toBe(0)
  })

  it('is deterministic regardless of node-key order', () => {
    const a = priceGraph({ '9': { class_type: 'SaveImage' }, '1': { class_type: 'KSampler' } })
    const b = priceGraph({ '1': { class_type: 'KSampler' }, '9': { class_type: 'SaveImage' } })
    expect(a).toEqual(b)
  })
})
