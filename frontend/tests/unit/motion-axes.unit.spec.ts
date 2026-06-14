import { describe, it, expect } from 'vitest'
import { interpolateAxes, axesToVariationSettings } from '../../app/lib/motion/axes'

describe('interpolateAxes', () => {
  const base = { wght: 400 }
  it('no keyframes → static axes', () => {
    expect(interpolateAxes([], 0.5, base)).toEqual({ wght: 400 })
  })
  it('interpolates linearly between two keyframes', () => {
    const kf = [{ t: 0, axes: { wght: 100 } }, { t: 1, axes: { wght: 900 }, ease: 'none' }]
    expect(interpolateAxes(kf, 0.5, base).wght).toBeCloseTo(500, 3)
  })
  it('clamps before first / after last', () => {
    const kf = [{ t: 0.25, axes: { wght: 200 } }, { t: 0.75, axes: { wght: 800 } }]
    expect(interpolateAxes(kf, 0, base).wght).toBe(200)
    expect(interpolateAxes(kf, 1, base).wght).toBe(800)
  })
  it('missing axis holds its static value', () => {
    const kf = [{ t: 0, axes: { wght: 100 } }, { t: 1, axes: { wght: 900 } }]
    expect(interpolateAxes(kf, 0.5, { wght: 400, wdth: 75 }).wdth).toBe(75)
  })
})

describe('axesToVariationSettings', () => {
  it('formats CSS font-variation-settings', () => {
    expect(axesToVariationSettings({ wght: 600, wdth: 80 })).toBe('"wght" 600, "wdth" 80')
  })
  it('empty → empty string', () => {
    expect(axesToVariationSettings({})).toBe('')
  })
})

describe('interpolateAxes per-keyframe ease', () => {
  const kfs = [
    { t: 0, axes: { wght: 0 }, ease: 'power2.in' },
    { t: 1, axes: { wght: 100 } },
  ]
  it('applies the FROM-keyframe ease to the segment (power2.in at mid)', () => {
    // linear would give 50 at t=0.5; power2.in (t^2) gives 25.
    expect(interpolateAxes(kfs, 0.5, {}).wght).toBeCloseTo(25, 4)
  })
  it('still linear when no ease set', () => {
    const lin = [{ t: 0, axes: { wght: 0 } }, { t: 1, axes: { wght: 100 } }]
    expect(interpolateAxes(lin, 0.5, {}).wght).toBeCloseTo(50, 4)
  })
  it('endpoints unaffected by ease', () => {
    expect(interpolateAxes(kfs, 0, {}).wght).toBeCloseTo(0, 4)
    expect(interpolateAxes(kfs, 1, {}).wght).toBeCloseTo(100, 4)
  })
})
