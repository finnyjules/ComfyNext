import { describe, it, expect } from 'vitest'
import { applyRepeat, REPEAT_IDX } from '~/lib/gradientfx/repeat'

const O = REPEAT_IDX.once, M = REPEAT_IDX.mirror, T = REPEAT_IDX.tile

describe('applyRepeat', () => {
  it('once is identity', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(applyRepeat(t, O, 4)).toBeCloseTo(t, 6)
  })

  it('tile ×3 produces 3 cycles (t=1/3 → 1.0 boundary → 0)', () => {
    expect(applyRepeat(0, T, 3)).toBeCloseTo(0, 6)
    expect(applyRepeat(1 / 6, T, 3)).toBeCloseTo(0.5, 6)
    expect(applyRepeat(1 / 3, T, 3)).toBeCloseTo(0, 6) // fract(1)=0
  })

  it('mirror ×2 reflects — symmetric about t=0.5', () => {
    for (const t of [0.1, 0.2, 0.35]) {
      expect(applyRepeat(t, M, 2)).toBeCloseTo(applyRepeat(1 - t, M, 2), 6)
    }
    expect(applyRepeat(0.5, M, 2)).toBeCloseTo(1, 6)  // peak at centre
    expect(applyRepeat(0, M, 2)).toBeCloseTo(0, 6)
  })

  it('count clamps to >= 1', () => {
    expect(applyRepeat(0.5, T, 0)).toBeCloseTo(0.5, 6) // n=max(1,0)=1 → fract(0.5)
  })
})
