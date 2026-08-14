import { describe, it, expect } from 'vitest'
import { PACKS, packById } from '../../server/utils/packs'

describe('credit packs (pricing decision 2026-08-13)', () => {
  it('is exactly the decided ladder', () => {
    expect(PACKS.map(p => [p.id, p.usd, p.credits])).toEqual([
      ['starter', 10, 1000],
      ['creator', 25, 2750],
      ['studio', 60, 7200],
    ])
  })
  it('bonus arithmetic is self-consistent (1cr = $0.01 fixed, bonus on top)', () => {
    for (const p of PACKS) {
      expect(p.baseCredits).toBe(p.usd * 100)
      expect(p.bonusCredits).toBe(p.credits - p.baseCredits)
      expect(p.bonusCredits).toBeGreaterThanOrEqual(0)
    }
  })
  it('looks up by id and rejects unknown ids', () => {
    expect(packById('creator')?.credits).toBe(2750)
    expect(packById('mega')).toBeNull()
  })
})
