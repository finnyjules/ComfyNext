import { describe, it, expect } from 'vitest'
import { harmonyHues, harmonize, toDuotone, toStops, HARMONY_TYPES } from '~/lib/color/harmony'
import { hexToOklch } from '~/lib/color/convert'

const hueOf = (hex: string) => hexToOklch(hex)[2]
const lOf = (hex: string) => hexToOklch(hex)[0]
/** Smallest absolute angular distance between two hue degrees. */
const hueDist = (a: number, b: number) => { let d = Math.abs(((a - b) % 360) + 360) % 360; return d > 180 ? 360 - d : d }

describe('harmonyHues (pure angular color theory)', () => {
  it('complementary is base + 180°', () => {
    expect(harmonyHues(200, 'complementary')).toEqual([200, 20])
  })
  it('triadic is three hues 120° apart', () => {
    expect(harmonyHues(200, 'triadic')).toEqual([200, 320, 80])
  })
  it('split-complementary flanks the complement (±30°)', () => {
    expect(harmonyHues(200, 'split-complementary')).toEqual([200, 350, 50])
  })
  it('analogous steps ±30° then ±60° around the base', () => {
    expect(harmonyHues(200, 'analogous', 3)).toEqual([200, 230, 170])
    expect(harmonyHues(200, 'analogous', 5)).toEqual([200, 230, 170, 260, 140])
  })
  it('accented-analogous is an analogous run plus the complement as an accent', () => {
    expect(harmonyHues(200, 'accented-analogous', 4)).toEqual([200, 230, 170, 20])
  })
  it('tetradic (square) is four hues 90° apart', () => {
    expect(harmonyHues(200, 'tetradic')).toEqual([200, 290, 20, 110])
  })
  it('compound is two complementary pairs at unequal spacing', () => {
    expect(harmonyHues(200, 'compound')).toEqual([200, 230, 20, 50])
  })
  it('monochromatic keeps a single hue', () => {
    expect(harmonyHues(200, 'monochromatic', 3)).toEqual([200, 200, 200])
  })
  it('normalizes hues into [0,360) and wraps negative offsets', () => {
    expect(harmonyHues(10, 'analogous', 3)).toEqual([10, 40, 340])
  })
  it('exports every harmony type', () => {
    expect(HARMONY_TYPES).toContain('complementary')
    expect(HARMONY_TYPES.length).toBe(8)
  })
})

describe('harmonize (seed color → harmony swatches)', () => {
  const seed = '#3b82f6' // a mid blue

  it('returns natural-size palettes of valid hex colors', () => {
    const tri = harmonize(seed, 'triadic')
    expect(tri).toHaveLength(3)
    tri.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/))
  })
  it('keeps member 0 close to the seed hue', () => {
    expect(hueDist(hueOf(harmonize(seed, 'complementary')[0]!), hueOf(seed))).toBeLessThan(6)
  })
  it('places a complementary partner roughly opposite the seed', () => {
    const [a, b] = harmonize(seed, 'complementary')
    // Gamut clamping shifts hue a little; keep the tolerance generous.
    expect(hueDist(hueOf(a!), hueOf(b!))).toBeGreaterThan(150)
  })
  it('monochromatic is a strictly increasing lightness ramp', () => {
    // Single-hue-ness is proven at the angular level (see harmonyHues above);
    // sRGB round-trip hue is too noisy across a wide lightness range to assert
    // here. What matters for the ramp is monotonic lightness.
    const mono = harmonize(seed, 'monochromatic', 4)
    expect(mono).toHaveLength(4)
    for (let i = 1; i < mono.length; i++) {
      expect(lOf(mono[i]!)).toBeGreaterThan(lOf(mono[i - 1]!))
    }
  })
})

describe('toDuotone (harmony → 2-color duotone)', () => {
  it('returns a dark shadow and a light highlight for every harmony', () => {
    for (const type of HARMONY_TYPES) {
      const { shadow, highlight } = toDuotone(harmonize('#c0392b', type))
      expect(lOf(shadow)).toBeLessThan(0.45)
      expect(lOf(highlight)).toBeGreaterThan(0.75)
      expect(lOf(shadow)).toBeLessThan(lOf(highlight))
    }
  })
  it('monochromatic duotone shares one hue across shadow and highlight', () => {
    const { shadow, highlight } = toDuotone(harmonize('#3b82f6', 'monochromatic'))
    // Same OKLCH hue by construction; allow for sRGB round-trip drift on pale blue.
    expect(hueDist(hueOf(shadow), hueOf(highlight))).toBeLessThan(20)
  })
  it('falls back gracefully for a single-color input', () => {
    const { shadow, highlight } = toDuotone(['#3b82f6'])
    expect(lOf(shadow)).toBeLessThan(lOf(highlight))
  })
})

describe('toStops (harmony → N gradient stops)', () => {
  it('produces n stops with even positions spanning 0..1', () => {
    const stops = toStops(harmonize('#3b82f6', 'triadic'), 5)
    expect(stops).toHaveLength(5)
    expect(stops[0]!.pos).toBeCloseTo(0)
    expect(stops[4]!.pos).toBeCloseTo(1)
    for (let i = 1; i < stops.length; i++) expect(stops[i]!.pos).toBeGreaterThan(stops[i - 1]!.pos)
  })
  it('sorts colors by lightness ascending (dark → light) so the map preserves tone', () => {
    const stops = toStops(harmonize('#c0392b', 'tetradic'), 6)
    for (let i = 1; i < stops.length; i++) expect(lOf(stops[i]!.color)).toBeGreaterThanOrEqual(lOf(stops[i - 1]!.color) - 1e-6)
  })
  it('up-samples a small harmony to more stops', () => {
    const stops = toStops(harmonize('#3b82f6', 'complementary'), 7)
    expect(stops).toHaveLength(7)
    stops.forEach(s => expect(s.color).toMatch(/^#[0-9a-f]{6}$/))
  })
})
