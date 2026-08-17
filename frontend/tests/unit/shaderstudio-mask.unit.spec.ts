// frontend/tests/unit/shaderstudio-mask.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { defaultMask } from '~/lib/shaderstudio/types'
import { maskUniforms, sampleMask, MASK_SHAPE_IDX } from '~/lib/shaderstudio/mask'

describe('sampleMask (JS mirror of the GLSL maskValue)', () => {
  it('radius: ~1 at center, ~0 far outside, monotonic across the feathered edge', () => {
    const m = { ...defaultMask(), shape: 'radius' as const, cx: 0.5, cy: 0.5, size: 0.3, feather: 0.3 }
    expect(sampleMask(m, 0.5, 0.5, 1)).toBeCloseTo(1, 5)          // dead center
    expect(sampleMask(m, 0.95, 0.5, 1)).toBeCloseTo(0, 5)         // far outside
    // Walking outward from center, the value never increases.
    let prev = Infinity
    for (let u = 0.5; u <= 0.95; u += 0.02) {
      const v = sampleMask(m, u, 0.5, 1)
      expect(v).toBeLessThanOrEqual(prev + 1e-9)
      prev = v
    }
  })

  it('radius stays circular under a non-1 aspect ratio (wide image)', () => {
    // A wide image (ar=2) must not stretch the circle: a point at the same *pixel*
    // distance up vs. sideways should give ~equal mask values.
    const m = { ...defaultMask(), shape: 'radius' as const, cx: 0.5, cy: 0.5, size: 0.3, feather: 0.2, aspect: 1 }
    const ar = 2
    const side = sampleMask(m, 0.5 + 0.1 / ar, 0.5, ar) // 0.1 image-height to the right
    const up = sampleMask(m, 0.5, 0.5 + 0.1, ar)        // 0.1 image-height up
    expect(side).toBeCloseTo(up, 5)
  })

  it('band: full inside the strip, zero well outside it, independent of x', () => {
    const m = { ...defaultMask(), shape: 'band' as const, cx: 0.5, cy: 0.5, size: 0.1, feather: 0.2, angle: 0 }
    // On the band centerline the value is 1 regardless of horizontal position.
    expect(sampleMask(m, 0.1, 0.5, 1)).toBeCloseTo(1, 5)
    expect(sampleMask(m, 0.9, 0.5, 1)).toBeCloseTo(1, 5)
    // Far above/below the strip → 0.
    expect(sampleMask(m, 0.5, 0.9, 1)).toBeCloseTo(0, 5)
  })

  it('invert returns 1 - value everywhere', () => {
    const base = { ...defaultMask(), shape: 'radius' as const, size: 0.3, feather: 0.3 }
    for (const [u, v] of [[0.5, 0.5], [0.7, 0.5], [0.9, 0.2]] as const) {
      const on = sampleMask({ ...base, invert: false }, u, v, 1)
      const off = sampleMask({ ...base, invert: true }, u, v, 1)
      expect(off).toBeCloseTo(1 - on, 5)
    }
  })

  it('never returns NaN when size or feather collapse to 0', () => {
    const m = { ...defaultMask(), shape: 'radius' as const, size: 0, feather: 0 }
    const v = sampleMask(m, 0.5, 0.5, 1)
    expect(Number.isNaN(v)).toBe(false)
  })
})

describe('maskUniforms', () => {
  it('flattens a mask to flat scalar uniforms with the shape index', () => {
    const m = { ...defaultMask(), shape: 'band' as const, cx: 0.25, cy: 0.75, size: 0.2, aspect: 1.5, angle: 0.5, feather: 0.4, invert: true }
    const u = maskUniforms(m)
    expect(u.u_maskShape).toBe(MASK_SHAPE_IDX.band)
    expect(u.u_maskCx).toBe(0.25)
    expect(u.u_maskCy).toBe(0.75)
    expect(u.u_maskSize).toBe(0.2)
    expect(u.u_maskAspect).toBe(1.5)
    expect(u.u_maskAngle).toBe(0.5)
    expect(u.u_maskFeather).toBe(0.4)
    expect(u.u_maskInvert).toBe(1)
  })
})
