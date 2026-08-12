import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetRateLimits, assertRateLimit, takeToken } from '../../server/lib/rateLimit'

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
  it('honors a custom window: a 10-minute window does not reset after 60s', () => {
    for (let i = 0; i < 3; i++) expect(takeToken('c', 3, 600_000, 1_000)).toBe(true)
    expect(takeToken('c', 3, 600_000, 61_000)).toBe(false)
    expect(takeToken('c', 3, 600_000, 601_000)).toBe(true)
  })
})

describe('assertRateLimit', () => {
  beforeEach(() => {
    _resetRateLimits()
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  function fakeEvent(ip = '1.2.3.4') {
    return { node: { req: { socket: { remoteAddress: ip } } } } as any
  }

  it('honors a custom windowMs parameter — a 10-minute window stays exhausted past 60s', () => {
    const event = fakeEvent()
    for (let i = 0; i < 3; i++) assertRateLimit(event, 'training-tier', 3, 600_000)
    // Past the default 60s window, but well within the custom 10-minute window: still blocked.
    vi.setSystemTime(61_000)
    expect(() => assertRateLimit(event, 'training-tier', 3, 600_000)).toThrow(/training-tier/)
    // Past the custom 10-minute window: allowed again.
    vi.setSystemTime(601_000)
    expect(() => assertRateLimit(event, 'training-tier', 3, 600_000)).not.toThrow()
  })

  it('throws a 429 with the route name in the message when exceeded', () => {
    const event = fakeEvent('9.9.9.9')
    for (let i = 0; i < 3; i++) assertRateLimit(event, 'training-tier', 3, 600_000)
    try {
      assertRateLimit(event, 'training-tier', 3, 600_000)
      throw new Error('expected assertRateLimit to throw')
    }
    catch (err: any) {
      expect(err.statusCode).toBe(429)
      expect(err.message).toMatch(/training-tier/)
    }
  })
})
