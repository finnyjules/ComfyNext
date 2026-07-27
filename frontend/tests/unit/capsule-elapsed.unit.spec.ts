import { describe, it, expect } from 'vitest'
import { fmtSec, elapsedSince } from '~/lib/canvas/elapsed'

describe('fmtSec', () => {
  it('shows one decimal under ten seconds', () => {
    expect(fmtSec(0)).toBe('0.0s')
    expect(fmtSec(8.44)).toBe('8.4s')
    expect(fmtSec(9.99)).toBe('10.0s')
  })

  it('rounds to whole seconds from ten to sixty', () => {
    expect(fmtSec(10)).toBe('10s')
    expect(fmtSec(42.4)).toBe('42s')
  })

  it('switches to minutes at sixty seconds', () => {
    expect(fmtSec(60)).toBe('1m 0s')
    expect(fmtSec(72)).toBe('1m 12s')
    expect(fmtSec(3600)).toBe('60m 0s')
  })

  // Documents existing CanvasStatusBar behaviour, carried over deliberately:
  // 59.6s rounds to "60s" rather than "1m 0s". Do not "fix" this here — the
  // status bar and the capsule must agree, and changing it is a separate call.
  it('keeps the inherited rounding seam at 59.5s', () => {
    expect(fmtSec(59.6)).toBe('60s')
  })
})

describe('elapsedSince', () => {
  it('returns zero for a missing start', () => {
    expect(elapsedSince(null, 1000)).toBe(0)
    expect(elapsedSince(undefined, 1000)).toBe(0)
    expect(elapsedSince(0, 1000)).toBe(0)
  })

  it('returns seconds between the stamps', () => {
    expect(elapsedSince(1_000, 13_500)).toBe(12.5)
  })

  it('never returns negative for a clock that went backwards', () => {
    expect(elapsedSince(5_000, 1_000)).toBe(0)
  })
})
