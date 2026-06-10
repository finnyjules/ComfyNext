import { describe, expect, it } from 'vitest'
import { resolveTokens } from '~~/shared/template-grid/tokens'

describe('resolveTokens', () => {
  it('substitutes props and brand scopes', () => {
    expect(resolveTokens('{{ props.headline }}', { headline: 'Brew bold' })).toBe('Brew bold')
    expect(resolveTokens('{{ brand.primary }}', {}, { primary: '#E2362B' })).toBe('#E2362B')
  })
  it('preserves type for whole-string tokens', () => {
    expect(resolveTokens('{{ props.count }}', { count: 42 })).toBe(42)
  })
  it('coerces mixed strings and blanks missing tokens', () => {
    expect(resolveTokens('Score: {{ props.count }}', { count: 42 })).toBe('Score: 42')
    expect(resolveTokens('x {{ props.missing }} y', {})).toBe('x  y')
  })
  it('returns non-strings untouched', () => {
    expect(resolveTokens(7, {})).toBe(7)
  })
})
