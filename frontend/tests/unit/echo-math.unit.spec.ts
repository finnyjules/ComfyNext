import { describe, it, expect } from 'vitest'
import { easeSpacing, rampScalar, driftQ, wrapFade, perspScale } from '../../app/lib/spacetype/echoMath'

describe('easeSpacing', () => {
  it('is identity at the endpoints regardless of curve', () => {
    for (const c of [-1, -0.5, 0, 0.5, 1]) {
      expect(easeSpacing(0, c)).toBeCloseTo(0, 6)
      expect(easeSpacing(1, c)).toBeCloseTo(1, 6)
    }
  })
  it('curve 0 is linear', () => {
    expect(easeSpacing(0.5, 0)).toBeCloseTo(0.5, 6)
    expect(easeSpacing(0.25, 0)).toBeCloseTo(0.25, 6)
  })
  it('ease-out (curve>0) starts slow: mid value below linear', () => {
    expect(easeSpacing(0.5, 1)).toBeLessThan(0.5)
  })
  it('ease-in (curve<0) starts fast: mid value above linear', () => {
    expect(easeSpacing(0.5, -1)).toBeGreaterThan(0.5)
  })
  it('clamps the curve and the input', () => {
    expect(easeSpacing(2, 5)).toBeCloseTo(1, 6)
    expect(easeSpacing(-1, -5)).toBeCloseTo(0, 6)
  })
})

describe('rampScalar', () => {
  it('returns base at t=0 and end at t=1', () => {
    expect(rampScalar(2, 10, 0)).toBe(2)
    expect(rampScalar(2, 10, 1)).toBe(10)
  })
  it('interpolates linearly and clamps t', () => {
    expect(rampScalar(0, 8, 0.25)).toBe(2)
    expect(rampScalar(0, 8, 2)).toBe(8)
    expect(rampScalar(0, 8, -1)).toBe(0)
  })
})

describe('driftQ', () => {
  it('at frac 0 echo j sits at slot j+1', () => {
    expect(driftQ(0, 0, 6)).toBeCloseTo(1, 6)
    expect(driftQ(5, 0, 6)).toBeCloseTo(6, 6)
  })
  it('advances by frac and wraps within (0, count]', () => {
    expect(driftQ(5, 0.5, 6)).toBeCloseTo(0.5, 6) // 6 + 0.5 wraps -> 0.5
  })
  it('is periodic: frac=count returns to the start arrangement', () => {
    expect(driftQ(2, 6, 6)).toBeCloseTo(driftQ(2, 0, 6), 6)
  })
  it('result is always in (0, count]', () => {
    for (let f = 0; f < 1; f += 0.13) {
      for (let j = 0; j < 6; j++) {
        const q = driftQ(j, f, 6)
        expect(q).toBeGreaterThan(0)
        expect(q).toBeLessThanOrEqual(6)
      }
    }
  })
})

describe('wrapFade', () => {
  it('is 1 in the middle and 0 at the very edges', () => {
    expect(wrapFade(0.5, 0.2)).toBeCloseTo(1, 6)
    expect(wrapFade(0, 0.2)).toBeCloseTo(0, 6)
    expect(wrapFade(1, 0.2)).toBeCloseTo(0, 6)
  })
  it('zone 0 disables fading', () => {
    expect(wrapFade(0, 0)).toBe(1)
  })
})

describe('perspScale', () => {
  it('is 1 at z=0 for any perspective', () => {
    expect(perspScale(0, 0)).toBeCloseTo(1, 6)
    expect(perspScale(0, 1)).toBeCloseTo(1, 6)
  })
  it('perspective=1 leaves world size unchanged (natural perspective from the camera)', () => {
    expect(perspScale(3, 1)).toBeCloseTo(1, 6)
  })
  it('perspective=0 shrinks copies pushed toward the camera (cancels apparent growth)', () => {
    expect(perspScale(3, 0, 14)).toBeCloseTo((14 - 3) / 14, 6)
  })
})
