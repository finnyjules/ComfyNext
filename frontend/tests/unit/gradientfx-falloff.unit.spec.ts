import { describe, it, expect } from 'vitest'
import { buildRampLut } from '~/lib/gradientfx/ramp'
import type { ColorStop } from '~/lib/gradientfx/types'

const BW: ColorStop[] = [{ color: '#000000', pos: 0 }, { color: '#ffffff', pos: 1 }]

describe('buildRampLut falloff', () => {
  it('default (linear) is byte-identical to the no-arg call — golden parity', () => {
    const a = buildRampLut(BW)
    const b = buildRampLut(BW, 'linear')
    expect(Buffer.from(b)).toEqual(Buffer.from(a))
  })

  it('linear ramp is ~linear at the midpoint (127±1)', () => {
    const lut = buildRampLut(BW, 'linear')
    expect(lut[128 * 4]).toBeGreaterThanOrEqual(126)
    expect(lut[128 * 4]).toBeLessThanOrEqual(129)
  })

  it('ease/smooth pin the endpoints and stay monotonic', () => {
    for (const f of ['ease', 'smooth'] as const) {
      const lut = buildRampLut(BW, f)
      expect(lut[0]).toBe(0)
      expect(lut[255 * 4]).toBe(255)
      let prev = -1
      for (let i = 0; i < 256; i++) { const v = lut[i * 4]!; expect(v).toBeGreaterThanOrEqual(prev); prev = v }
    }
  })

  it('smooth pushes the midpoint toward the linear value but flattens the shoulders', () => {
    const lin = buildRampLut(BW, 'linear')
    const sm = buildRampLut(BW, 'smooth')
    // near the low shoulder (t≈0.25), smootherstep sits BELOW linear
    expect(sm[64 * 4]!).toBeLessThan(lin[64 * 4]!)
    // near the high shoulder (t≈0.75), it sits ABOVE linear
    expect(sm[192 * 4]!).toBeGreaterThan(lin[192 * 4]!)
  })
})
