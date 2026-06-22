import { describe, expect, it } from 'vitest'
import { snapDitherScale, stylizeUniforms } from '~/lib/texturefx/stylize'

describe('snapDitherScale', () => {
  it('snaps so cells-across is a multiple of the pattern period', () => {
    // pattern 1 (Bayer 4×4, period 4): 1/scale rounded to a multiple of 4
    const s = snapDitherScale(1, 0.012) // 1/0.012 ≈ 83.3 → 84 (mult of 4)
    expect(Math.round(1 / s) % 4).toBe(0)
    // pattern 8 (blue noise, period 64)
    const b = snapDitherScale(8, 0.012) // → multiple of 64
    expect(Math.round(1 / b) % 64).toBe(0)
    // pattern 2 (Fine 8×8, period 8)
    const f = snapDitherScale(2, 0.012)
    expect(Math.round(1 / f) % 8).toBe(0)
  })
  it('never returns a degenerate scale (cells-across >= period)', () => {
    const s = snapDitherScale(8, 0.05) // 1/0.05 = 20 < 64 → clamp to 64
    expect(Math.round(1 / s)).toBe(64)
  })
})

describe('stylizeUniforms', () => {
  it('dither maps params (snapped scale + pattern value + colored flag)', () => {
    const u = stylizeUniforms('dither', { ditherPattern: 'Bayer 4×4', ditherScale: 0.012, ditherLevels: 3, ditherColor: 'mono' } as any)
    expect(u.u_pattern).toBe(1)
    expect(Math.round(1 / u.u_scale) % 4).toBe(0)
    expect(u.u_levels).toBe(3)
    expect(u.u_colored).toBe(0)
  })
  it('dither defaults colored to 1 when not mono', () => {
    const u = stylizeUniforms('dither', { ditherPattern: 'Blue noise', ditherScale: 0.02, ditherLevels: 4, ditherColor: 'color' } as any)
    expect(u.u_pattern).toBe(8)
    expect(u.u_colored).toBe(1)
  })
  it('posterize + duotone map their params', () => {
    expect(stylizeUniforms('posterize', { posterizeLevels: 6 } as any).u_levels).toBe(6)
    const d = stylizeUniforms('duotone', { duoShadow: 0.6, duoLight: 0.1, duoContrast: 0.5 } as any)
    expect(d).toEqual({ u_shadowHue: 0.6, u_lightHue: 0.1, u_contrast: 0.5 })
  })
  it('none / unknown kind yields no uniforms', () => {
    expect(stylizeUniforms('none', {} as any)).toEqual({})
  })
})
