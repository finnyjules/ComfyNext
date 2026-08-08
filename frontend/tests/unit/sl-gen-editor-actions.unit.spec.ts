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
  it('setSurface holds the staging (axis independence)', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const staging = (ctx.template.value as TemplateV3).gen!.staging
    ctx.setSurface('tint')
    const t = ctx.template.value as TemplateV3
    expect(t.gen?.staging).toBe(staging)
    expect(t.gen?.surface).toBe('tint')
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
    expect(t.tiers?.hero?.content).toBe('BIG NEWS')
  })
})
