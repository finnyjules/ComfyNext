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
})
