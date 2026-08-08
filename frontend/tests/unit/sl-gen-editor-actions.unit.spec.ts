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

  // -- Round-2a Task 8: theme actions + true-append tiers --------------------

  it('addTierItem APPENDS — two calls stage both items (round-1 overwrite regression)', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const idx0 = ctx.addTierItem('support', 'A')
    const idx1 = ctx.addTierItem('support', 'B')
    expect(idx0).toBe(1)   // 'support' already has one seeded item ('Food') from editorWithTiers
    expect(idx1).toBe(2)
    const t = ctx.template.value as TemplateV3
    const support = t.tiers?.support
    const items = Array.isArray(support) ? support : support ? [support] : []
    expect(items.map(i => i.content)).toEqual(['Food', 'A', 'B'])
    const els = t.elements.filter(e => e.id?.startsWith('tier_support_'))
    const byId = Object.fromEntries(els.map(e => [e.id, (e as any).content]))
    expect(byId.tier_support_0).toBe('Food')
    expect(byId.tier_support_1).toBe('A')
    expect(byId.tier_support_2).toBe('B')
  })

  it('addTierItem on a fresh tier appends starting at index 0', () => {
    const ctx = useGridEditor(makeStarterTemplate('append-fresh'))
    ctx.convertToV3()
    const idx0 = ctx.addTierItem('support', 'A')
    const idx1 = ctx.addTierItem('support', 'B')
    expect(idx0).toBe(0)
    expect(idx1).toBe(1)
    const t = ctx.template.value as TemplateV3
    const els = t.elements.filter(e => e.id?.startsWith('tier_support_'))
    const byId = Object.fromEntries(els.map(e => [e.id, (e as any).content]))
    expect(byId.tier_support_0).toBe('A')
    expect(byId.tier_support_1).toBe('B')
  })

  it('addTierItem defaults content to the capitalized tier id when omitted', () => {
    const ctx = useGridEditor(makeStarterTemplate('append-default'))
    ctx.convertToV3()
    ctx.addTierItem('support')
    const t = ctx.template.value as TemplateV3
    const support = t.tiers?.support
    const items = Array.isArray(support) ? support : support ? [support] : []
    expect(items[0]?.content).toBe('SUPPORT')
  })

  it('toggleAccentOnHero flips hero to accent, then back to the foreground token', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    expect(ctx.genAccentOnHero.value).toBe(false)
    ctx.toggleAccentOnHero()
    let t = ctx.template.value as TemplateV3
    let hero = t.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(ctx.genAccentOnHero.value).toBe(true)
    ctx.toggleAccentOnHero()
    t = ctx.template.value as TemplateV3
    hero = t.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.foreground }}')
    expect(ctx.genAccentOnHero.value).toBe(false)
  })

  it('toggleAccentOnHero holds the same staging/theme tuple', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const staging = (ctx.template.value as TemplateV3).gen!.staging
    const theme = (ctx.template.value as TemplateV3).gen!.theme
    ctx.toggleAccentOnHero()
    const t = ctx.template.value as TemplateV3
    expect(t.gen?.staging).toBe(staging)
    expect(t.gen?.theme).toBe(theme)
  })

  it('toggleAccentOnHero is undoable', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    expect(ctx.genAccentOnHero.value).toBe(false)
    ctx.toggleAccentOnHero()
    expect(ctx.genAccentOnHero.value).toBe(true)
    ctx.undo()
    expect(ctx.genAccentOnHero.value).toBe(false)
  })

  it('setBrandOverride writes template.brand and survives shuffleLayout', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setBrandOverride('background', '#ff00aa')
    let t = ctx.template.value as TemplateV3
    expect(t.brand?.background).toBe('#ff00aa')
    ctx.shuffleLayout()
    t = ctx.template.value as TemplateV3
    expect(t.brand?.background).toBe('#ff00aa')
  })

  it('setBrandOverride(null) restores the current theme\'s stamped value', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setTheme('blue')
    ctx.setBrandOverride('background', '#ff00aa')
    expect((ctx.template.value as TemplateV3).brand?.background).toBe('#ff00aa')
    ctx.setBrandOverride('background', null)
    const t = ctx.template.value as TemplateV3
    expect(t.brand?.background).toBe('#1d4ed8')   // theme 'blue' field
  })

  it('setBrandOverride is undoable', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const before = (ctx.template.value as TemplateV3).brand?.background
    ctx.setBrandOverride('background', '#ff00aa')
    expect((ctx.template.value as TemplateV3).brand?.background).toBe('#ff00aa')
    ctx.undo()
    expect((ctx.template.value as TemplateV3).brand?.background).toBe(before)
  })

  it('setBrandOverride on a cold-start template (no prior generate) is not discarded by the stamp guard', () => {
    const ctx = useGridEditor(makeStarterTemplate('cold-start-brand'))
    ctx.convertToV3()
    // No surpriseLayout/setTheme/etc. before this — `gen` doesn't exist yet.
    ctx.setBrandOverride('accent', '#123456')
    const t = ctx.template.value as TemplateV3
    expect(t.brand?.accent).toBe('#123456')
    ctx.shuffleLayout()
    const t2 = ctx.template.value as TemplateV3
    expect(t2.brand?.accent).toBe('#123456')
  })
})
