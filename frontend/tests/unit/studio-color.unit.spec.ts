import { describe, it, expect } from 'vitest'
import { clampHex, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, rgbToOklch, oklchToRgb } from '../../app/components/vue-canvas/studio/color'

describe('clampHex', () => {
  it('normalizes, expands shorthand, and falls back to black', () => {
    expect(clampHex('#FFF')).toBe('#ffffff')
    expect(clampHex('AABBCC')).toBe('#aabbcc')
    expect(clampHex('nope')).toBe('#000000')
  })
})

describe('hex ↔ rgb', () => {
  it('round-trips', () => {
    expect(hexToRgb('#ff8a1f')).toEqual([255, 138, 31])
    expect(rgbToHex(255, 138, 31)).toBe('#ff8a1f')
    expect(rgbToHex(300, -5, 12.6)).toBe('#ff000d') // clamps + rounds
  })
})

describe('rgb ↔ hsv', () => {
  it('handles primaries and grays', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual([0, 1, 1])
    expect(rgbToHsv(0, 0, 0)).toEqual([0, 0, 0])
    const [h, s] = rgbToHsv(128, 128, 128)
    expect(h).toBe(0); expect(s).toBe(0)
  })
  it('round-trips a sample of colors back to the same hex', () => {
    for (const hex of ['#2b5cff', '#28e0ff', '#ff8a1f', '#ffd23b', '#7d5cff', '#101014']) {
      const [r, g, b] = hexToRgb(hex)
      const [h, s, v] = rgbToHsv(r, g, b)
      const [r2, g2, b2] = hsvToRgb(h, s, v)
      expect(rgbToHex(r2, g2, b2)).toBe(hex)
    }
  })
})

describe('rgb ↔ oklch', () => {
  it('puts white, black, and red where OKLab expects', () => {
    const [Lw] = rgbToOklch(255, 255, 255)
    expect(Lw).toBeCloseTo(1, 2)
    const [Lk, Ck] = rgbToOklch(0, 0, 0)
    expect(Lk).toBeCloseTo(0, 4); expect(Ck).toBeCloseTo(0, 4)
    const [, , Hr] = rgbToOklch(255, 0, 0)
    expect(Hr).toBeGreaterThan(20); expect(Hr).toBeLessThan(35) // red ≈ 29°
  })
  it('round-trips hex → oklch → hex', () => {
    for (const hex of ['#2b5cff', '#28e0ff', '#ff8a1f', '#ffd23b', '#7d5cff', '#101014']) {
      const [r, g, b] = hexToRgb(hex)
      const [L, C, H] = rgbToOklch(r, g, b)
      const [r2, g2, b2] = oklchToRgb(L, C, H)
      expect(rgbToHex(r2, g2, b2)).toBe(hex)
    }
  })
})
