import { describe, it, expect } from 'vitest'
import { reconcileLoops, effectiveLoopSeconds } from '~/lib/compositor/loopReconcile'

describe('effectiveLoopSeconds', () => {
  it('is base duration times the whole-cycle multiplier', () => {
    expect(effectiveLoopSeconds(6, 1)).toBe(6)
    expect(effectiveLoopSeconds(6, 2)).toBe(12)
  })
  it('floors k at 1 and clamps negative durations', () => {
    expect(effectiveLoopSeconds(6, 0)).toBe(6)
    expect(effectiveLoopSeconds(-3, 2)).toBe(0)
  })
})

describe('reconcileLoops', () => {
  it('passes a single animated slot through unchanged', () => {
    expect(reconcileLoops([{ seconds: 6, fps: 30 }])).toEqual({ duration: 6, fps: 30, capped: false })
  })
  it('takes the LCM so both slots complete whole cycles (6s + 4s = 12s)', () => {
    expect(reconcileLoops([{ seconds: 6, fps: 30 }, { seconds: 4, fps: 30 }]))
      .toEqual({ duration: 12, fps: 30, capped: false })
  })
  it('handles coprime lengths (6s + 7s = 42s, under the cap)', () => {
    expect(reconcileLoops([{ seconds: 6, fps: 30 }, { seconds: 7, fps: 30 }]))
      .toEqual({ duration: 42, fps: 30, capped: false })
  })
  it('uses a shared frame base when fps differ (6s@30 + 4s@24 = 12s@30)', () => {
    expect(reconcileLoops([{ seconds: 6, fps: 30 }, { seconds: 4, fps: 24 }]))
      .toEqual({ duration: 12, fps: 30, capped: false })
  })
  it('resolves fractional seconds through the frame base (4.5s@30 = 4.5s)', () => {
    expect(reconcileLoops([{ seconds: 4.5, fps: 30 }])).toEqual({ duration: 4.5, fps: 30, capped: false })
  })
  it('caps an exploding LCM to whole multiples of the longest slot, flagged', () => {
    // lcm(180,210,150)=6300 frames = 210s @30 > 60s cap.
    // longest=210 frames; capFrames=1800; mult=floor(1800/210)=8 → 1680/30 = 56s.
    const r = reconcileLoops([{ seconds: 6, fps: 30 }, { seconds: 7, fps: 30 }, { seconds: 5, fps: 30 }])
    expect(r).toEqual({ duration: 56, fps: 30, capped: true })
  })
  it('is empty-safe (no animated slots → zero duration)', () => {
    expect(reconcileLoops([])).toEqual({ duration: 0, fps: 1, capped: false })
  })
})
