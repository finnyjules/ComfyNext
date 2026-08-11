import { describe, it, expect } from 'vitest'
import { gradientMapInPlace, duotoneInPlace, hexToRgb, type GradientMapStop } from '~/lib/compositor/postEffects'

// Build a 1-pixel RGBA buffer at a given grey level.
function px(v: number): Uint8ClampedArray {
  return new Uint8ClampedArray([v, v, v, 255])
}
const BW: GradientMapStop[] = [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }]

describe('gradientMapInPlace', () => {
  it('maps a mid-grey through a 2-stop ramp to the interpolated colour', () => {
    // ramp black→red; mid-grey (lum 0.5) → ~ (128,0,0)
    const d = px(128)
    gradientMapInPlace(d, [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ff0000' }], 0, 1)
    expect(d[0]).toBeGreaterThan(120); expect(d[0]).toBeLessThan(140)
    expect(d[1]).toBe(0); expect(d[2]).toBe(0)
    expect(d[3]).toBe(255) // alpha untouched
  })

  it('mix=0 is a no-op', () => {
    const d = px(90)
    gradientMapInPlace(d, BW, 0, 0)
    expect(Array.from(d)).toEqual([90, 90, 90, 255])
  })

  it('empty stops is a no-op', () => {
    const d = px(90)
    gradientMapInPlace(d, [], 0, 1)
    expect(Array.from(d)).toEqual([90, 90, 90, 255])
  })

  it('a single stop is a flat tint', () => {
    const d = px(200)
    gradientMapInPlace(d, [{ pos: 0.3, color: '#00ff00' }], 0, 1)
    expect(Array.from(d)).toEqual([0, 255, 0, 255])
  })

  it('handles unsorted input stops (sorts internally)', () => {
    const a = px(128), b = px(128)
    gradientMapInPlace(a, [{ pos: 1, color: '#ffffff' }, { pos: 0, color: '#000000' }], 0, 1)
    gradientMapInPlace(b, BW, 0, 1)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('parity with duotone: black→white 2-stop at contrast 0, mix 1 == duotoneInPlace', () => {
    for (const v of [0, 40, 128, 200, 255]) {
      const g = px(v), dt = px(v)
      gradientMapInPlace(g, [{ pos: 0, color: '#101010' }, { pos: 1, color: '#f0d0b0' }], 0, 1)
      duotoneInPlace(dt, hexToRgb('#101010'), hexToRgb('#f0d0b0'), 1)
      expect(Array.from(g)).toEqual(Array.from(dt))
    }
  })
})
