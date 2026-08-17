import { describe, it, expect } from 'vitest'
import { hexToRgb, buildRampLut } from '~/lib/gradientfx/ramp'
import type { ColorStop } from '~/lib/gradientfx/types'

describe('hexToRgb alpha', () => {
  it('parses the alpha byte of an 8-digit hex', () => {
    expect(hexToRgb('#ff000080').a).toBe(0x80)
    expect(hexToRgb('#00000000').a).toBe(0)
    expect(hexToRgb('#ffffffff').a).toBe(255)
  })
  it('defaults alpha to 255 for 6- and 3-digit hex', () => {
    expect(hexToRgb('#ff0000').a).toBe(255)
    expect(hexToRgb('#f00').a).toBe(255)
  })
  it('still parses rgb correctly regardless of alpha', () => {
    const c = hexToRgb('#12345680')
    expect([c.r, c.g, c.b]).toEqual([0x12, 0x34, 0x56])
  })
})

describe('buildRampLut alpha', () => {
  it('carries stop alpha into the LUT A channel (not hardcoded 255)', () => {
    // transparent-red → opaque-red: alpha should ramp 0 → 255 across the LUT
    const stops: ColorStop[] = [{ color: '#ff000000', pos: 0 }, { color: '#ff0000ff', pos: 1 }]
    const lut = buildRampLut(stops)
    expect(lut[3]).toBe(0)              // first texel alpha = 0 (transparent)
    expect(lut[255 * 4 + 3]).toBe(255) // last texel alpha = 255 (opaque)
    expect(lut[128 * 4 + 3]).toBeGreaterThan(100) // midpoint alpha ~127
    expect(lut[128 * 4 + 3]).toBeLessThan(155)
  })
  it('opaque (6-digit) stops still produce a fully opaque ramp', () => {
    const lut = buildRampLut([{ color: '#000000', pos: 0 }, { color: '#ffffff', pos: 1 }])
    for (let i = 0; i < 256; i++) expect(lut[i * 4 + 3]).toBe(255)
  })
})
