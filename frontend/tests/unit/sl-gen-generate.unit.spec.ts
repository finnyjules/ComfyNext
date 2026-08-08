import { describe, it, expect } from 'vitest'
import { generate, shuffle, surprise } from '~~/shared/template-grid/generate/generate'
import type { TemplateV3, ElementV2 } from '~~/shared/template-grid/types'

function base(): TemplateV3 {
  return {
    version: 3, id: 't', name: 'T', master: '3x4',
    formats: { '3x4': { w: 1080, h: 1440 } },
    grid: { gutter: 16, margin: 48, baseline: 8, columns: 12, rows: 16 },
    typeScale: { base: 14, ratio: 1.5 },
    background: {},
    elements: [],
    sections: [],
    tiers: {
      hero: { content: 'MAT + FEST' },
      anchor: { content: '15—26 June' },
      support: { content: 'Street food' },
      fineprint: { content: 'Slakthus' },
    },
  }
}

describe('generate orchestrator', () => {
  it('emits staging elements, sets the surface background, and stamps gen', () => {
    const t = generate(base(), { staging: 'tower', surface: 'holographic', seed: 100 })
    expect(t.elements.length).toBeGreaterThan(0)
    expect(t.elements.every(e => e.origin === 'staging')).toBe(true)
    expect(t.background?.fill).toContain('linear-gradient')
    expect(t.gen).toMatchObject({ staging: 'tower', surface: 'holographic', seed: 100 })
  })
  it('is deterministic for the same tuple', () => {
    const a = generate(base(), { staging: 'split', surface: 'flat', seed: 7 })
    const b = generate(base(), { staging: 'split', surface: 'flat', seed: 7 })
    expect(JSON.stringify(a.elements)).toBe(JSON.stringify(b.elements))
  })
  it('preserves freeform elements across a re-roll', () => {
    let t = generate(base(), { staging: 'tower', surface: 'flat', seed: 1 })
    const freeform: ElementV2 = { id: 'note', type: 'text', content: 'hand-added', level: 'body',
      priority: 9, region: { col: 1, colSpan: 3, row: 14, rowSpan: 1 }, origin: 'freeform' }
    t = { ...t, elements: [...t.elements, freeform] }
    const rolled = shuffle(t)
    expect(rolled.elements.find(e => e.id === 'note')?.origin).toBe('freeform')
  })
  it('tier type overrides survive a re-roll', () => {
    const t0 = generate(base(), { staging: 'tower', surface: 'flat', seed: 1 })
    const withType: TemplateV3 = { ...t0, tiers: { ...t0.tiers, hero: { content: 'MAT + FEST', type: { letterSpacing: -3 } } } }
    const rolled = surprise(withType)
    const hero = rolled.elements.find(e => e.id === 'tier_hero') as any
    expect(hero.style.letterSpacing).toBe(-3)
  })
  it('shuffle keeps a locked staging but may change the seed', () => {
    const t = generate(base(), { staging: 'frame', surface: 'flat', seed: 1 })
    const locked: TemplateV3 = { ...t, gen: { ...t.gen!, locks: { staging: true } } }
    const rolled = shuffle(locked)
    expect(rolled.gen?.staging).toBe('frame')
  })
})
