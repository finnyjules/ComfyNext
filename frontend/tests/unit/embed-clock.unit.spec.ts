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

  // The sign-correction branch: a negative elapsed value must wrap forward into
  // [0, 1), not produce a negative result or a mirrored one. Without this,
  // deleting the ternary in clock.ts still passes the suite.
  it('wraps a negative elapsed time forward into the loop', () => {
    expect(t01At(-15_000, 30)).toBeCloseTo(0.5, 6)
    expect(t01At(-1_000, 30)).toBeCloseTo(29 / 30, 6)
  })

  it('keeps negative elapsed times in [0, 1)', () => {
    for (const ms of [-1, -29_999, -30_000, -45_000, -1_234_567]) {
      const v = t01At(ms, 30)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
