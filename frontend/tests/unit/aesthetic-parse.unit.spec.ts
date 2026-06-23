import { describe, it, expect } from 'vitest'
import { parseAestheticOutput, cleanProfile } from '~~/server/api/cloud-train/aesthetic-parse'

describe('cleanProfile', () => {
  it('collapses whitespace and strips wrapping quotes', () => {
    expect(cleanProfile('  "Moody  and\n  grainy."  ')).toBe('Moody and grainy.')
  })
})

describe('parseAestheticOutput', () => {
  it('splits prose from a Keywords line', () => {
    const raw = 'Soft grainy film light with a muted palette.\nKeywords: grainy, muted palette, soft light'
    const r = parseAestheticOutput(raw)
    expect(r.aesthetic).toBe('Soft grainy film light with a muted palette.')
    expect(r.keywords).toEqual(['grainy', 'muted palette', 'soft light'])
  })

  it('is case-insensitive on the label and trims/drops empties', () => {
    const raw = 'Prose here.\n\nkeywords:  teal ,, warm grain ,  '
    const r = parseAestheticOutput(raw)
    expect(r.aesthetic).toBe('Prose here.')
    expect(r.keywords).toEqual(['teal', 'warm grain'])
  })

  it('de-duplicates keywords case-insensitively, first spelling wins', () => {
    const r = parseAestheticOutput('P.\nKeywords: Grain, grain, GRAIN, teal')
    expect(r.keywords).toEqual(['Grain', 'teal'])
  })

  it('returns empty keywords when no Keywords line is present', () => {
    const r = parseAestheticOutput('Just a flowing paragraph with no list.')
    expect(r.aesthetic).toBe('Just a flowing paragraph with no list.')
    expect(r.keywords).toEqual([])
  })

  it('caps keywords at 12', () => {
    const list = Array.from({ length: 20 }, (_, i) => `k${i}`).join(', ')
    const r = parseAestheticOutput(`P.\nKeywords: ${list}`)
    expect(r.keywords).toHaveLength(12)
  })
})
