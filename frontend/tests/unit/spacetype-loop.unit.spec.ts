import { describe, it, expect } from 'vitest'
import { loopMultiplier } from '~/lib/spacetype/loop'
import { getEffect } from '~/lib/spacetype/effects'

describe('loopMultiplier', () => {
  it('returns 1 when loopKeys is empty/absent', () => {
    expect(loopMultiplier({ s: 1.3 }, [])).toBe(1)
    expect(loopMultiplier({ s: 1.3 }, undefined)).toBe(1)
  })
  it('integer speeds → 1', () => {
    expect(loopMultiplier({ s: 2, t: -3 }, ['s', 't'])).toBe(1)
  })
  it('1.3 → 10 (13 whole cycles)', () => {
    expect(loopMultiplier({ s: 1.3 }, ['s'])).toBe(10)
  })
  it('0.05 → 20', () => {
    expect(loopMultiplier({ s: 0.05 }, ['s'])).toBe(20)
  })
  it('multiple keys → common k', () => {
    // 0.5 needs k=2, 0.25 needs k=4 → common 4
    expect(loopMultiplier({ a: 0.5, b: 0.25 }, ['a', 'b'])).toBe(4)
  })
  it('zero speed contributes nothing', () => {
    expect(loopMultiplier({ a: 0, b: 1.5 }, ['a', 'b'])).toBe(2)
  })
})

it('cylinder loopKeys are all real control keys', () => {
  const cyl = getEffect('cylinder')
  const keys = new Set(cyl.controls.map(c => c.key))
  for (const lk of cyl.loopKeys ?? []) expect(keys.has(lk), lk).toBe(true)
})
