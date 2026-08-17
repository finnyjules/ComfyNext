import { describe, it, expect } from 'vitest'
import { matchesShowWhen } from '../../app/lib/shaderfx/showWhen'

describe('matchesShowWhen', () => {
  const read = (vals: Record<string, number>) => (u: string) => vals[u] ?? 0
  it('absent → always visible', () => {
    expect(matchesShowWhen(undefined, read({}))).toBe(true)
  })
  it('scalar equals with float rounding', () => {
    const sw = { uniform: 'u_mode', equals: 1 }
    expect(matchesShowWhen(sw, read({ u_mode: 1.0 }))).toBe(true)
    expect(matchesShowWhen(sw, read({ u_mode: 0.0 }))).toBe(false)
  })
  it('array equals', () => {
    const sw = { uniform: 'u_shape', equals: [14, 15] }
    expect(matchesShowWhen(sw, read({ u_shape: 15 }))).toBe(true)
    expect(matchesShowWhen(sw, read({ u_shape: 3 }))).toBe(false)
  })
})
