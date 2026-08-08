import { describe, it, expect } from 'vitest'
import type { TemplateV3, TierSpec, GenState, Tiers } from '~~/shared/template-grid/types'
import { TIER_ORDER, DEFAULT_TIER_LEVELS, tierEntries, autopopulateTiers, omitConsumedProps, normalizeTiers, appendTierItem } from '~~/shared/template-grid/generate/tiers'

describe('schema: tiers/gen/origin fields', () => {
  it('round-trips optional generation fields on a template', () => {
    const hero: TierSpec = { content: 'MAT + FEST', type: { fontWeight: 700 }, enabled: true }
    const gen: GenState = { staging: 'tower', theme: 'paper', seed: 4821, locks: { staging: true } }
    const tpl = {
      version: 3, id: 't1', name: 'T', master: '3x4',
      formats: { '3x4': { w: 1080, h: 1440 } },
      grid: { gutter: 16, margin: 48, baseline: 8, columns: 12, rows: 16 },
      typeScale: { base: 14, ratio: 1.5 },
      elements: [{ id: 'tier_hero', type: 'text', content: 'x', level: 'display', priority: 1,
        region: { col: 1, colSpan: 12, row: 2, rowSpan: 6 }, origin: 'staging' }],
      sections: [],
      tiers: { hero },
      gen,
    } as TemplateV3
    const back = JSON.parse(JSON.stringify(tpl)) as TemplateV3
    expect(back.tiers?.hero?.content).toBe('MAT + FEST')
    expect(back.gen?.seed).toBe(4821)
    expect(back.gen?.locks?.staging).toBe(true)
    expect(back.elements[0]?.origin).toBe('staging')
  })
})

describe('tier model', () => {
  it('orders tiers by importance', () => {
    expect(TIER_ORDER).toEqual(['hero', 'anchor', 'support', 'fineprint'])
  })
  it('maps each tier to a default level with descending scale', () => {
    const order = ['caption', 'body', 'subhead', 'headline', 'display']
    const idx = (t: keyof typeof DEFAULT_TIER_LEVELS) => order.indexOf(DEFAULT_TIER_LEVELS[t])
    expect(idx('hero')).toBeGreaterThan(idx('anchor'))
    expect(idx('anchor')).toBeGreaterThan(idx('support'))
    expect(idx('support')).toBeGreaterThanOrEqual(idx('fineprint'))
  })
  it('uses only 3 distinct default levels — support shares fineprint\'s size ("few sizes, big jumps"; hero/anchor carry explicit fontSize overrides from the drama system)', () => {
    expect(DEFAULT_TIER_LEVELS.support).toBe(DEFAULT_TIER_LEVELS.fineprint)
    expect(new Set(Object.values(DEFAULT_TIER_LEVELS)).size).toBe(3)
  })
  it('tierEntries returns only enabled tiers, in importance order', () => {
    const entries = tierEntries({ fineprint: { content: 'f' }, hero: { content: 'h' }, anchor: { content: 'a', enabled: false } })
    expect(entries.map(e => e.id)).toEqual(['hero', 'fineprint'])
  })
  it('autopopulates tiers from wired text sockets', () => {
    const t = autopopulateTiers({ text_layer_1: 'HERO', text_layer_2: 'DATE', text_layer_3: 'list' })
    expect(t.hero).toEqual([{ content: 'HERO' }])
    expect(t.anchor?.[0]?.content).toBe('DATE')
    expect(t.support?.[0]?.content).toBe('list')
    expect(t.fineprint).toBeUndefined()
  })
  it('tierEntries returns items arrays, in importance order, skipping disabled/empty items', () => {
    const entries = tierEntries({
      fineprint: { content: 'f' },
      hero: [{ content: 'h1' }, { content: '' }, { content: 'h2', enabled: false }, { content: 'h3' }],
      anchor: { content: 'a', enabled: false },
    })
    expect(entries.map(e => e.id)).toEqual(['hero', 'fineprint'])
    const heroEntry = entries.find(e => e.id === 'hero')!
    expect(heroEntry.items.map(i => i.content)).toEqual(['h1', 'h3'])
    const fineprintEntry = entries.find(e => e.id === 'fineprint')!
    expect(fineprintEntry.items).toEqual([{ content: 'f' }])
  })
})

describe('normalizeTiers', () => {
  it('wraps a round-1 single TierSpec into a one-item array', () => {
    const n = normalizeTiers({ hero: { content: 'HERO' } })
    expect(n.hero).toEqual([{ content: 'HERO' }])
  })
  it('passes an existing array through unchanged', () => {
    const n = normalizeTiers({ hero: [{ content: 'A' }, { content: 'B' }] })
    expect(n.hero).toEqual([{ content: 'A' }, { content: 'B' }])
  })
  it('drops empty arrays and tolerates undefined input', () => {
    const n = normalizeTiers({ hero: [], anchor: { content: 'A' } })
    expect(n.hero).toBeUndefined()
    expect(n.anchor).toEqual([{ content: 'A' }])
    expect(normalizeTiers(undefined)).toEqual({})
  })
})

describe('appendTierItem', () => {
  it('appends a second item to an existing round-1 single, preserving order, without mutating input', () => {
    const original: Tiers = { hero: { content: 'A' } }
    const next = appendTierItem(original, 'hero', { content: 'B' })
    expect(next.hero).toEqual([{ content: 'A' }, { content: 'B' }])
    // input untouched
    expect(original.hero).toEqual({ content: 'A' })
  })
  it('appends to an empty tier, creating a one-item list', () => {
    const next = appendTierItem({}, 'anchor', { content: 'X' })
    expect(next.anchor).toEqual([{ content: 'X' }])
  })
})

describe('omitConsumedProps (reopen dedup)', () => {
  it('removes props consumed by tiers, keeps the rest', () => {
    const tiers = { hero: { content: 'HERO' }, anchor: { content: 'DATE' } }
    const props = {
      text_layer_1: 'HERO',
      text_layer_2: 'DATE',
      text_layer_3: 'list',
      image_layer_1: 'https://example.com/a.png',
    }
    const out = omitConsumedProps(props, tiers)
    expect(out).toEqual({
      text_layer_3: 'list',
      image_layer_1: 'https://example.com/a.png',
    })
  })

  it('is a no-op when no tiers are seeded', () => {
    const props = { text_layer_1: 'HERO', image_layer_1: 'https://example.com/a.png' }
    expect(omitConsumedProps(props, {})).toEqual(props)
  })

  it('leaves a prop alone when its mapped tier is absent', () => {
    const props = { text_layer_1: 'HERO', text_layer_2: 'DATE' }
    // only anchor seeded — text_layer_1 (hero) stays, text_layer_2 (anchor) drops
    const out = omitConsumedProps(props, { anchor: { content: 'DATE' } })
    expect(out).toEqual({ text_layer_1: 'HERO' })
  })
})
