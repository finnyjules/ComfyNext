import { describe, it, expect } from 'vitest'
import { useGridEditor } from '~/composables/useGridEditor'
import { makeStarterTemplate } from '~~/shared/template-grid/starter'
import type { TemplateV3 } from '~~/shared/template-grid/types'

function editorWithTiers() {
  const ctx = useGridEditor(makeStarterTemplate('gen-test'))
  ctx.convertToV3()
  ;(ctx.template.value as TemplateV3).tiers = {
    hero: { content: 'MAT + FEST' }, anchor: { content: '15—26' },
    support: { content: 'Food' }, fineprint: { content: 'Hall 3' },
  }
  return ctx
}

describe('useGridEditor generation actions', () => {
  it('surprise fills the canvas with staging elements and stamps gen', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    expect(t.elements.some(e => e.origin === 'staging')).toBe(true)
    expect(t.gen?.staging).toBeTruthy()
  })
  it('setTheme holds the staging (axis independence)', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const staging = (ctx.template.value as TemplateV3).gen!.staging
    ctx.setTheme('red')
    const t = ctx.template.value as TemplateV3
    expect(t.gen?.staging).toBe(staging)
    expect(t.gen?.theme).toBe('red')
  })
  it('shuffle is undoable', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const before = JSON.stringify((ctx.template.value as TemplateV3).elements)
    ctx.shuffleLayout()
    ctx.undo()
    expect(JSON.stringify((ctx.template.value as TemplateV3).elements)).toBe(before)
  })
  it('addTierItem adds a hero-tier text element', () => {
    const ctx = useGridEditor(makeStarterTemplate('add-test'))
    ctx.convertToV3()
    ctx.addTierItem('hero', 'BIG NEWS')
    const t = ctx.template.value as TemplateV3
    expect(t.tiers?.hero?.[0]?.content).toBe('BIG NEWS')
  })
  it('surpriseLayout marks the doc dirty', () => {
    const ctx = editorWithTiers()
    ctx.dirty.value = false // reset past setup's own dirty-setting (convertToV3)
    ctx.surpriseLayout()
    expect(ctx.dirty.value).toBe(true)
  })
  it('shuffleLayout marks the doc dirty', () => {
    const ctx = editorWithTiers()
    ctx.dirty.value = false // reset past setup's own dirty-setting (convertToV3)
    ctx.shuffleLayout()
    expect(ctx.dirty.value).toBe(true)
  })
  it('setStaging preserves accentOnHero on regeneration', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    t.gen = { ...t.gen!, accentOnHero: true }
    ctx.setStaging('frame')
    const t2 = ctx.template.value as TemplateV3
    const hero = t2.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(t2.gen?.accentOnHero).toBe(true)
  })
  it('setTheme preserves accentOnHero on regeneration', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    t.gen = { ...t.gen!, accentOnHero: true }
    ctx.setTheme('blue')
    const t2 = ctx.template.value as TemplateV3
    const hero = t2.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(t2.gen?.accentOnHero).toBe(true)
  })
  it('setTierType preserves accentOnHero on regeneration', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    t.gen = { ...t.gen!, accentOnHero: true }
    ctx.setTierType('anchor', { letterSpacing: -1 })
    const t2 = ctx.template.value as TemplateV3
    const hero = t2.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(t2.gen?.accentOnHero).toBe(true)
  })
  it('addTierItem preserves accentOnHero on regeneration', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    t.gen = { ...t.gen!, accentOnHero: true }
    ctx.addTierItem('support', 'More food')
    const t2 = ctx.template.value as TemplateV3
    const hero = t2.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(t2.gen?.accentOnHero).toBe(true)
  })
})
