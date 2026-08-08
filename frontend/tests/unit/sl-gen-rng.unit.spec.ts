import { describe, it, expect } from 'vitest'
import { makeRng, hashSeed } from '~~/shared/template-grid/generate/rng'

describe('seeded rng', () => {
  it('is deterministic for the same seed', () => {
    const a = makeRng(42), b = makeRng(42)
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })
  it('differs across seeds', () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next())
  })
  it('salt changes the stream', () => {
    expect(makeRng(7, 'staging').next()).not.toBe(makeRng(7, 'surface').next())
  })
  it('int is in range and pick returns a member', () => {
    const r = makeRng(9)
    for (let i = 0; i < 50; i++) { const n = r.int(5); expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(5) }
    expect(['a', 'b', 'c']).toContain(makeRng(3).pick(['a', 'b', 'c']))
  })
})
