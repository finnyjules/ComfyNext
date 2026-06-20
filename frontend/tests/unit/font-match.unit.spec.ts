import { describe, it, expect } from 'vitest'
import { normalizeFamily, groundSuggestions } from '~~/server/utils/fontMatch'

const CATALOG = [
  { family: 'Roboto', category: 'sans' },
  { family: 'DM Serif Display', category: 'serif' },
  { family: 'Bebas Neue', category: 'display' },
  { family: 'Playfair Display', category: 'serif' },
]

describe('normalizeFamily', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeFamily('  DM   Serif  Display ')).toBe('dm serif display')
    expect(normalizeFamily('Roboto')).toBe('roboto')
  })
})

describe('groundSuggestions', () => {
  it('keeps exact matches and uses the catalog canonical spelling + category', () => {
    const out = groundSuggestions([{ family: 'roboto', reason: 'clean sans' }], CATALOG)
    expect(out).toEqual([{ family: 'Roboto', reason: 'clean sans', category: 'sans' }])
  })

  it('matches case- and whitespace-insensitively', () => {
    const out = groundSuggestions([{ family: 'bebas  neue', reason: 'bold' }], CATALOG)
    expect(out[0].family).toBe('Bebas Neue')
  })

  it('fuzzy-matches a partial name to the catalog family', () => {
    const out = groundSuggestions([{ family: 'DM Serif', reason: 'elegant' }], CATALOG)
    expect(out[0].family).toBe('DM Serif Display')
  })

  it('drops families that do not exist in the catalog', () => {
    const out = groundSuggestions([
      { family: 'Helvetica Neue', reason: 'classic' },
      { family: 'Roboto', reason: 'clean' },
    ], CATALOG)
    expect(out.map(s => s.family)).toEqual(['Roboto'])
  })

  it('dedupes when two suggestions ground to the same family', () => {
    const out = groundSuggestions([
      { family: 'Playfair Display', reason: 'a' },
      { family: 'playfair  display', reason: 'b' },
    ], CATALOG)
    expect(out).toHaveLength(1)
    expect(out[0].family).toBe('Playfair Display')
  })

  it('drops a single vague token instead of over-grounding it', () => {
    // "Neue" substring-matches "Bebas Neue" but is too vague to trust.
    const out = groundSuggestions([{ family: 'Neue', reason: 'x' }], CATALOG)
    expect(out).toEqual([])
  })

  it('ignores malformed suggestion entries', () => {
    const out = groundSuggestions([
      { family: '', reason: 'x' } as any,
      null as any,
      { reason: 'no family' } as any,
      { family: 'Roboto', reason: 'ok' },
    ], CATALOG)
    expect(out.map(s => s.family)).toEqual(['Roboto'])
  })
})
