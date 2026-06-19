import { describe, it, expect } from 'vitest'
import { mulberry32, hashSeed } from '../../app/lib/spacetype/rng'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(123); const b = mulberry32(123)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
  it('produces values in [0,1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 100; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
  it('different seeds diverge', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('hashSeed', () => {
  it('maps strings to stable 32-bit integers', () => {
    expect(hashSeed('THE')).toBe(hashSeed('THE'))
    expect(hashSeed('THE')).not.toBe(hashSeed('OF ALL'))
    expect(Number.isInteger(hashSeed('x'))).toBe(true)
  })
})
