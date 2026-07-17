import { describe, it, expect } from 'vitest'
import { applyFiltersRGB, isIdentityFilters, hueRotateMatrix } from '../../shared/timeline/filters'

// Reference-implementation tests — the Python twin
// (tests-unit/comfy_extras_test/timeline_filters_test.py) asserts the SAME
// numbers. Change the two together.
describe('applyFiltersRGB', () => {
  const px: [number, number, number] = [0.25, 0.5, 0.75]

  it('identity passes through', () => {
    expect(isIdentityFilters(undefined)).toBe(true)
    expect(isIdentityFilters({ brightness: 0, contrast: 1, saturation: 1, hue: 0, temperature: 0 })).toBe(true)
    expect(applyFiltersRGB(px, undefined)).toEqual([0.25, 0.5, 0.75])
  })

  it('brightness is additive and clamps', () => {
    expect(applyFiltersRGB(px, { brightness: 0.1 })).toEqual([0.35, 0.6, 0.85])
    expect(applyFiltersRGB(px, { brightness: 0.5 })[2]).toBe(1)
    expect(applyFiltersRGB(px, { brightness: -0.3 })[0]).toBe(0)
  })

  it('contrast pivots at 0.5', () => {
    const [r, g, b] = applyFiltersRGB(px, { contrast: 2 })
    expect(r).toBeCloseTo(0.0)
    expect(g).toBeCloseTo(0.5)
    expect(b).toBeCloseTo(1.0)
  })

  it('saturation 0 collapses to Rec.709 luma', () => {
    const luma = 0.2126 * 0.25 + 0.7152 * 0.5 + 0.0722 * 0.75
    const out = applyFiltersRGB(px, { saturation: 0 })
    for (const c of out) expect(c).toBeCloseTo(luma)
  })

  it('hue 120° cycles a pure red toward green (SVG hueRotate semantics)', () => {
    const out = applyFiltersRGB([1, 0, 0], { hue: 120 })
    expect(out[1]).toBeGreaterThan(out[0])   // green now dominates
    // exact pinned value from the spec matrix at 120°:
    // r' = 0.213 + cos(120°)*0.787 - sin(120°)*0.213 = 0.213 - 0.3935 - 0.18447 = clamped 0
    expect(out[0]).toBeCloseTo(0)
    expect(out[1]).toBeCloseTo(0.213 - Math.cos(Math.PI * 2 / 3) * 0.213 + Math.sin(Math.PI * 2 / 3) * 0.143)
  })

  it('hue matrix at 0° is identity', () => {
    const m = hueRotateMatrix(0)
    expect(m[0]).toBeCloseTo(1); expect(m[4]).toBeCloseTo(1); expect(m[8]).toBeCloseTo(1)
    expect(m[1]).toBeCloseTo(0); expect(m[2]).toBeCloseTo(0)
  })

  it('temperature warms red / cools blue multiplicatively', () => {
    const [r, , b] = applyFiltersRGB(px, { temperature: 1 })
    expect(r).toBeCloseTo(0.25 * 1.2)
    expect(b).toBeCloseTo(0.75 * 0.8)
  })

  it('applies in the documented order (brightness before contrast)', () => {
    // 0.25 +0.5 → 0.75 clamped; contrast 2 → (0.75-0.5)*2+0.5 = 1.0
    // (contrast-first would give (0.25-0.5)*2+0.5 = 0 → +0.5 = 0.5)
    expect(applyFiltersRGB([0.25, 0.25, 0.25], { brightness: 0.5, contrast: 2 })[0]).toBeCloseTo(1)
  })
})
