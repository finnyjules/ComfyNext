import { describe, it, expect } from 'vitest'
import { sanitize, estimateBatch } from '~/lib/collection/generate'

describe('sanitize', () => {
  it('lowercases and hyphenates non-alphanumerics', () => {
    expect(sanitize('France 2026!')).toBe('france-2026-')
  })
  it('collapses runs of separators into one hyphen', () => {
    expect(sanitize('a   b---c')).toBe('a-b-c')
  })
  it('truncates to 40 chars', () => {
    const long = 'x'.repeat(60)
    expect(sanitize(long)).toHaveLength(40)
  })
})

describe('estimateBatch', () => {
  it('labels free renders with a rough time estimate', () => {
    expect(estimateBatch(2)).toEqual({ label: '2 renders · free · ~3s' })
  })
  it('rounds up fractional seconds', () => {
    expect(estimateBatch(1)).toEqual({ label: '1 renders · free · ~2s' })
  })
  it('scales with item count', () => {
    expect(estimateBatch(10).label).toContain('10 renders')
    expect(estimateBatch(10).label).toContain('~12s')
  })
})
