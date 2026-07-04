import { describe, it, expect } from 'vitest'
import { scrubValue } from '~/lib/studio/scrub'

const base = { min: 0, max: 100, step: 1 }

describe('scrubValue', () => {
  it('maps half the default scrub distance to half the range', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 130 })).toBe(50)
  })
  it('clamps at both ends', () => {
    expect(scrubValue({ ...base, startValue: 90, deltaPx: 1000 })).toBe(100)
    expect(scrubValue({ ...base, startValue: 10, deltaPx: -1000 })).toBe(0)
  })
  it('snaps to step', () => {
    expect(scrubValue({ min: 0, max: 100, step: 5, startValue: 0, deltaPx: 130 })).toBe(50)
    expect(scrubValue({ min: 0, max: 100, step: 5, startValue: 0, deltaPx: 26 })).toBe(10)
  })
  it('shift-fine scales the delta down', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 260, fine: true })).toBe(15)
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 260, fine: false })).toBe(100)
  })
  it('honours a per-control scrubPx override', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 130, scrubPx: 130 })).toBe(100)
  })
  it('handles a negative-min (bipolar) range and negative delta', () => {
    expect(scrubValue({ min: -100, max: 100, step: 1, startValue: 0, deltaPx: -130 })).toBe(-130 / 260 * 200)
  })
  it('never emits float dust', () => {
    const v = scrubValue({ min: 0, max: 1, step: 0.01, startValue: 0.1, deltaPx: 5, scrubPx: 260 })
    expect(v).toBe(Number(v.toFixed(6)))
  })
})
