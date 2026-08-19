import { describe, it, expect } from 'vitest'
import { wiredLoopFrameArg } from '~/lib/spacetype/loop'

describe('wiredLoopFrameArg', () => {
  it('k=1 spans [0,1) — one base loop (backward compatible)', () => {
    expect(wiredLoopFrameArg(0, 30, 6, 1)).toBe(0)
    expect(wiredLoopFrameArg(0.5, 30, 6, 1)).toBeCloseTo(0.5, 5)     // 90/180
    expect(wiredLoopFrameArg(0.999, 30, 6, 1)).toBeLessThan(1)
  })
  it('k=2 spans [0,2) — mid-loop t01 lands a full base loop in (native speed, not half)', () => {
    // total=360 base frames; t01=0.5 → frame 180 → 180/180 = 1.0 (start of 2nd base loop)
    expect(wiredLoopFrameArg(0.5, 30, 6, 2)).toBeCloseTo(1.0, 5)
    expect(wiredLoopFrameArg(0.25, 30, 6, 2)).toBeCloseTo(0.5, 5)
  })
  it('wraps t01 into [0,1) so the k-loop seams only at the boundary', () => {
    expect(wiredLoopFrameArg(1, 30, 6, 2)).toBe(0)        // full wrap → back to start
    expect(wiredLoopFrameArg(-0.25, 30, 6, 2)).toBeCloseTo(wiredLoopFrameArg(0.75, 30, 6, 2), 5)
  })
})
