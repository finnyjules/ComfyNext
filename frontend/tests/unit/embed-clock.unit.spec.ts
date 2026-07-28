import { describe, it, expect } from 'vitest'
import { t01At } from '~/lib/embed/clock'

describe('t01At', () => {
  it('is 0 at the start', () => {
    expect(t01At(0, 30)).toBe(0)
  })

  it('is 0.5 at the halfway point', () => {
    expect(t01At(15_000, 30)).toBeCloseTo(0.5, 6)
  })

  it('wraps at the loop boundary rather than reaching 1', () => {
    expect(t01At(30_000, 30)).toBe(0)
    expect(t01At(45_000, 30)).toBeCloseTo(0.5, 6)
  })

  it('stays in [0, 1) for very long runs', () => {
    const v = t01At(9_999_999, 30)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThan(1)
  })

  it('returns 0 for a non-positive duration instead of dividing by zero', () => {
    expect(t01At(1234, 0)).toBe(0)
    expect(t01At(1234, -5)).toBe(0)
  })
})
