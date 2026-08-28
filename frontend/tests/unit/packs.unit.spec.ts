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
  it('covers lines are derived from the live price book, not hand-kept', () => {
    // Starter: 1,000 cr at flux-dev 5 cr → ~200 images; seedance clip 90 cr → ~11 clips.
    // If the book reprices either unit, these figures must move with it — the
    // assertion checks shape (both units present, counts descend the ladder).
    for (const p of PACKS) expect(p.covers).toMatch(/^Covers ~[\d,]+ image renders, or ~\d+ video clips$/)
    const images = PACKS.map(p => Number(p.covers.match(/~([\d,]+) image/)![1]!.replace(/,/g, '')))
    expect(images).toEqual([...images].sort((a, b) => a - b))
    expect(images[0]).toBeGreaterThan(0)
  })
  it('looks up by id and rejects unknown ids', () => {
    expect(packById('creator')?.credits).toBe(2750)
    expect(packById('mega')).toBeNull()
  })
})

// Smoke the Stripe client module: the import itself must resolve (a wrong-cwd
// install once left `stripe` uninstalled and this file unimportable), and the
// no-key path must fail loudly rather than construct a broken client.
import { getStripe, __setStripeForTests } from '../../server/utils/stripeClient'

describe('getStripe', () => {
  it('throws a clear error without STRIPE_SECRET_KEY', () => {
    __setStripeForTests(null)
    const prev = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    try {
      expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY/)
    } finally {
      if (prev !== undefined) process.env.STRIPE_SECRET_KEY = prev
      __setStripeForTests(null)
    }
  })
})
