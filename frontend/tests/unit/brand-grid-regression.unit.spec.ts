import { describe, it, expect } from 'vitest'
import { effectiveBrand } from '../../shared/brand/resolve'
import { resolveTokens } from '../../shared/template-grid/tokens'

describe('grid brand resolution with the shared merge', () => {
  const template = { primary: '#111111', fontDisplay: 'Poppins' }
  it('no active kit + no wired ⇒ template defaults verbatim (regression)', () => {
    const b = effectiveBrand(template, undefined, undefined)
    expect(resolveTokens('{{ brand.primary }}', {}, b)).toBe('#111111')
    expect(resolveTokens('{{ brand.fontDisplay }}', {}, b)).toBe('Poppins')
  })
  it('active kit slots between template and wired', () => {
    const b = effectiveBrand(template, { primary: '#E2362B' }, { primary: '#00FF00' })
    expect(resolveTokens('{{ brand.primary }}', {}, b)).toBe('#00FF00')
    const noWire = effectiveBrand(template, { primary: '#E2362B' })
    expect(resolveTokens('{{ brand.primary }}', {}, noWire)).toBe('#E2362B')
  })
  it('accent2 resolves through tokens', () => {
    const b = effectiveBrand(undefined, { accent2: '#22D3EE' })
    expect(resolveTokens('{{ brand.accent2 }}', {}, b)).toBe('#22D3EE')
  })
})
