import { describe, it, expect } from 'vitest'
import type { TemplateV3, TierSpec, GenState } from '~~/shared/template-grid/types'

describe('schema: tiers/gen/origin fields', () => {
  it('round-trips optional generation fields on a template', () => {
    const hero: TierSpec = { content: 'MAT + FEST', type: { fontWeight: 700 }, enabled: true }
    const gen: GenState = { staging: 'tower', surface: 'holographic', seed: 4821, locks: { staging: true } }
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
