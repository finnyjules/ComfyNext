import { describe, it, expect } from 'vitest'
import { easeOutCubic, tweenValue, shouldAnimateWalletChange } from '../../app/lib/countTween'

describe('easeOutCubic', () => {
  it('hits exact endpoints and clamps outside 0..1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(-0.5)).toBe(0)
    expect(easeOutCubic(1.5)).toBe(1)
  })

  it('is monotonically increasing', () => {
    let last = -1
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOutCubic(t)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
  })
})

describe('tweenValue', () => {
  it('lands exactly on the target at progress 1 (no rounding drift)', () => {
    expect(tweenValue(9000, 8998, 1)).toBe(8998)
    expect(tweenValue(0, 481, 1)).toBe(481)
  })

  it('starts exactly at the source', () => {
    expect(tweenValue(9000, 8998, 0)).toBe(9000)
  })

  it('counts DOWN for a debit and UP for a top-up', () => {
    const mid = tweenValue(9000, 8500, 0.5)
    expect(mid).toBeLessThan(9000)
    expect(mid).toBeGreaterThan(8500)
    const up = tweenValue(1000, 8200, 0.5)
    expect(up).toBeGreaterThan(1000)
    expect(up).toBeLessThan(8200)
  })

  it('returns integers throughout', () => {
    for (let t = 0; t <= 1; t += 0.1) {
      expect(Number.isInteger(tweenValue(9000, 8477, t))).toBe(true)
    }
  })
})

describe('shouldAnimateWalletChange', () => {
  it('animates only between two different real balances', () => {
    expect(shouldAnimateWalletChange(9000, 8998)).toBe(true)
    expect(shouldAnimateWalletChange(null, 9000)).toBe(false)   // first paint jumps
    expect(shouldAnimateWalletChange(9000, null)).toBe(false)   // sign-out jumps
    expect(shouldAnimateWalletChange(9000, 9000)).toBe(false)   // no-op refresh
    expect(shouldAnimateWalletChange(null, null)).toBe(false)
  })
})
