import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MODEL_COSTS, PRICE_BOOK_VERSION, costForModel, priceGraph } from '../../server/utils/priceBook'

describe('price book: graph pricer (unchanged spike behavior)', () => {
  it('base render + premium node', () => {
    const p = priceGraph({
      1: { class_type: 'SaveImage' },
      2: { class_type: 'GenerateVideoNode' },
    })
    expect(p.credits).toBe(61)
    expect(p.version).toBe(PRICE_BOOK_VERSION)
  })

  it('no output node → zero credits', () => {
    expect(priceGraph({ 1: { class_type: 'KSampler' } }).credits).toBe(0)
  })
})

describe('price book: model costs', () => {
  it('looks up a known model and returns null for unknown', () => {
    expect(costForModel('meta/sam-2')).toMatchObject({ usd: 0.022, credits: 4 })
    expect(costForModel('does-not/exist')).toBeNull()
  })

  it('never prices an action below provider cost', () => {
    for (const [model, c] of Object.entries(MODEL_COSTS)) {
      const costInCredits = Math.max(1, Math.ceil(c.usd * 100))
      expect(c.credits, `${model} priced below cost`).toBeGreaterThanOrEqual(costInCredits)
    }
  })

  it('markup stays within the strategy band (≤3×, floor-priced entries exempt)', () => {
    for (const [model, c] of Object.entries(MODEL_COSTS)) {
      if (c.usd * 100 < 1) continue // floor of 1 credit on sub-cent actions
      expect(c.credits, `${model} markup looks like a typo`).toBeLessThanOrEqual(Math.ceil(c.usd * 100 * 3))
    }
  })

  it('credits are positive integers', () => {
    for (const [model, c] of Object.entries(MODEL_COSTS)) {
      expect(Number.isInteger(c.credits) && c.credits >= 1, model).toBe(true)
    }
  })
})

describe('price book: coverage of the codebase', () => {
  // Every provider model slug that appears in server code must be priced —
  // an unpriced model is unmetered spend waiting for Stage 4.
  const serverRoot = fileURLToPath(new URL('../../server', import.meta.url))
  const SLUG = /'((?:black-forest-labs|fal-ai|meta|bytedance|recraft-ai|ostris|lucataco|minimax|krea|851-labs)\/[a-z0-9./-]+)'/g
  // Non-inference references that legitimately appear in code without a price
  // (none today; add slugs here with a reason if one appears):
  const EXEMPT = new Set<string>([])

  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, acc)
      else if (p.endsWith('.ts')) acc.push(p)
    }
    return acc
  }

  it('every model slug in server/ has a price entry', () => {
    const found = new Set<string>()
    for (const file of walk(serverRoot)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(SLUG)) found.add(m[1])
    }
    expect(found.size).toBeGreaterThan(10) // the scan itself must be alive
    const unpriced = [...found].filter(s => !MODEL_COSTS[s] && !EXEMPT.has(s))
    expect(unpriced, `unpriced model slugs: ${unpriced.join(', ')}`).toEqual([])
  })
})
