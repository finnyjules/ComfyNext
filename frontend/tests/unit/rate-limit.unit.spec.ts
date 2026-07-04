import { beforeEach, describe, expect, it } from 'vitest'
import { _resetRateLimits, takeToken } from '../../server/lib/rateLimit'

describe('takeToken', () => {
  beforeEach(() => _resetRateLimits())

  it('allows up to max calls in a window', () => {
    for (let i = 0; i < 5; i++) expect(takeToken('a', 5, 60_000, 1_000)).toBe(true)
    expect(takeToken('a', 5, 60_000, 1_000)).toBe(false)
  })
  it('resets after the window elapses', () => {
    for (let i = 0; i < 5; i++) takeToken('a', 5, 60_000, 1_000)
    expect(takeToken('a', 5, 60_000, 1_000)).toBe(false)
    expect(takeToken('a', 5, 60_000, 62_000)).toBe(true)
  })
  it('tracks keys independently', () => {
    for (let i = 0; i < 5; i++) takeToken('a', 5, 60_000, 1_000)
    expect(takeToken('b', 5, 60_000, 1_000)).toBe(true)
  })
})
