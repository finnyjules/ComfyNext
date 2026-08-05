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
  // Legacy option. Shift means `coarse` now, in both the drag and the arrow keys;
  // `fine` survives only so an unmigrated caller compiles.
  it('fine scales the delta down', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 260, fine: true })).toBe(15)
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 260, fine: false })).toBe(100)
  })
  it('shift-coarse keeps the travel rate but lands on a ten-step grid', () => {
    // 130px of 260 is half of 0..100 → 50 either way; the grid shows at 34px, which
    // is 13.07 raw: on the normal grid that snaps to 13, on the coarse one to 10.
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 130, coarse: true })).toBe(50)
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 34 })).toBe(13)
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 34, coarse: true })).toBe(10)
  })
  it('coarse-drags on the same grid a shift-arrow jumps by', () => {
    // KEY_COARSE_STEPS worth of a 0.01 step is 0.1 — the drag must not invent its own.
    const v = scrubValue({ min: 0, max: 1, step: 0.01, startValue: 0, deltaPx: 44, coarse: true })
    expect(v).toBe(0.2)
    expect(v).toBe(Number(v.toFixed(6)))
  })
  it('honours a per-control scrubPx override', () => {
    expect(scrubValue({ ...base, startValue: 0, deltaPx: 130, scrubPx: 130 })).toBe(100)
  })
  it('handles a negative-min (bipolar) range and negative delta', () => {
    expect(scrubValue({ min: -100, max: 100, step: 1, startValue: 0, deltaPx: -130 })).toBe(-130 / 260 * 200)
  })
  it('never emits float dust', () => {
    // Use inputs that trigger IEEE 754 accumulation error: 0.1 * 3 = 0.30000000000000004
    // min:0 max:1 step:0.1, deltaPx:65 → raw:0.25 → Math.round(0.25/0.1)*0.1 → 0.30000000000000004
    const v = scrubValue({ min: 0, max: 1, step: 0.1, startValue: 0, deltaPx: 65, scrubPx: 260 })
    // Must return clean 0.3, not the dusty 0.30000000000000004
    expect(v).toBe(0.3)
    // Verify it's strictly equal to the toFixed clean round (test fails if strip is removed)
    expect(v).toBe(Number(v.toFixed(6)))
  })
})
