import { describe, it, expect } from 'vitest'
import { loopMultiplier } from '~/lib/spacetype/loop'
import { getEffect } from '~/lib/spacetype/effects'

describe('loopMultiplier', () => {
  it('returns 1 for empty rates', () => { expect(loopMultiplier([])).toBe(1) })
  it('integer rates → 1', () => { expect(loopMultiplier([2, -3])).toBe(1) })
  it('1.3 → 10', () => { expect(loopMultiplier([1.3])).toBe(10) })
  it('0.05 → 20', () => { expect(loopMultiplier([0.05])).toBe(20) })
  it('mixed → common k', () => { expect(loopMultiplier([0.5, 0.25])).toBe(4) })
  it('ignores zero rates', () => { expect(loopMultiplier([0, 1.5])).toBe(2) })
})

describe('cylinder loopRates', () => {
  it('includes wave + per-ring spin rates (covers the half-integer center)', () => {
    const cyl = getEffect('cylinder')
    const rates = cyl.loopRates!({ waveSpeed: 1, spinSpeed: 0, spinRingOffset: 0.05, count: 2 })
    // count=2 → center=0.5 → rings at ∓0.5*0.05 = ±0.025 ; plus waveSpeed 1
    expect(rates).toContain(1)
    expect(rates.some(r => Math.abs(Math.abs(r) - 0.025) < 1e-9)).toBe(true)
  })

  // The live preview now spans k = loopMultiplier(loopRates) loops and drives an unwrapped
  // t01 = frame / base (0..k). This seams ONLY if every rate × k is integral — verify the
  // contract holds for a fractional spin config, and that a single loop (k=1) would NOT seam.
  it('k makes every cylinder rate land on a whole cycle (preview seam contract)', () => {
    const cyl = getEffect('cylinder')
    const rates = cyl.loopRates!({ waveSpeed: 0.5, spinSpeed: 0.3, spinRingOffset: 0, count: 3 })
    const k = loopMultiplier(rates)
    expect(k).toBeGreaterThan(1)                                   // single-loop preview would jump
    for (const r of rates) expect(Math.abs(r * k - Math.round(r * k))).toBeLessThan(1e-3)
  })
})
