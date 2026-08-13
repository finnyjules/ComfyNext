import { describe, it, expect } from 'vitest'
import { sanitizeCaption } from '../../app/lib/wardrobe/dress'

describe('sanitizeCaption', () => {
  it('passes a clean phrase through unchanged', () => {
    expect(sanitizeCaption('sleeveless navy tank, tailored black trousers'))
      .toBe('sleeveless navy tank, tailored black trousers')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeCaption('  cream linen shirt  ')).toBe('cream linen shirt')
  })

  it('strips wrapping straight and smart quotes', () => {
    expect(sanitizeCaption('"olive utility jacket"')).toBe('olive utility jacket')
    expect(sanitizeCaption('“olive utility jacket”')).toBe('olive utility jacket')
    expect(sanitizeCaption("'olive utility jacket'")).toBe('olive utility jacket')
  })

  it('strips a trailing period', () => {
    expect(sanitizeCaption('charcoal wool coat.')).toBe('charcoal wool coat')
  })

  it('caps length around 90 chars', () => {
    const long = 'a'.repeat(150)
    const out = sanitizeCaption(long)
    expect(out).not.toBeNull()
    expect(out!.length).toBeLessThanOrEqual(90)
  })

  it('rejects an empty string', () => {
    expect(sanitizeCaption('')).toBeNull()
  })

  it('rejects a whitespace-only string', () => {
    expect(sanitizeCaption('   ')).toBeNull()
  })

  it('rejects multi-line output', () => {
    expect(sanitizeCaption('Here is the outfit:\nnavy tank, black trousers')).toBeNull()
  })

  it('rejects null/undefined', () => {
    expect(sanitizeCaption(null)).toBeNull()
    expect(sanitizeCaption(undefined)).toBeNull()
  })

  it('returns null when stripping quotes/period leaves nothing', () => {
    expect(sanitizeCaption('".."')).toBeNull()
  })
})
