import { describe, it, expect } from 'vitest'
import {
  Theme,
  THEMES,
  THEME_PALETTE,
  getTheme,
  relLuminance,
  resolveInk,
  contrastRatio,
  SURFACE_TO_THEME,
  BRAND_AXIS_KEYS,
  themeBrandDefaults,
} from '../../shared/template-grid/generate/themes'

describe('Smart Layout themes module', () => {
  describe('Theme registry', () => {
    it('exports 7 themes with exact ids and fields', () => {
      expect(THEMES).toHaveLength(7)

      const expectedThemes = [
        { id: 'black', name: 'Black', field: '#000000', defaultAccent: '#dd2200' },
        { id: 'white', name: 'White', field: '#ffffff', defaultAccent: '#dd2200' },
        { id: 'paper', name: 'Paper', field: '#f2f0ef', defaultAccent: '#dd2200' },
        { id: 'red', name: 'Red', field: '#dd2200', defaultAccent: '#f2f0ef' },
        { id: 'orange', name: 'Orange', field: '#fc461f', defaultAccent: '#000000' },
        { id: 'green', name: 'Green', field: '#2e6f40', defaultAccent: '#f2f0ef' },
        { id: 'blue', name: 'Blue', field: '#1d4ed8', defaultAccent: '#f2f0ef' },
      ]

      expectedThemes.forEach((expected, i) => {
        const theme = THEMES[i]
        expect(theme.id).toBe(expected.id)
        expect(theme.field).toBe(expected.field)
        expect(theme.defaultAccent).toBe(expected.defaultAccent)
      })
    })

    it('THEME_PALETTE contains the 7 field hexes in THEMES order', () => {
      expect(THEME_PALETTE).toHaveLength(7)
      expect(THEME_PALETTE).toEqual([
        '#000000', // black
        '#ffffff', // white
        '#f2f0ef', // paper
        '#dd2200', // red
        '#fc461f', // orange
        '#2e6f40', // green
        '#1d4ed8', // blue
      ])
    })

    it('getTheme returns the theme by id', () => {
      expect(getTheme('black')).toEqual(THEMES[0])
      expect(getTheme('white')).toEqual(THEMES[1])
      expect(getTheme('paper')).toEqual(THEMES[2])
      expect(getTheme('unknown')).toBeUndefined()
    })
  })

  describe('relLuminance', () => {
    it('calculates WCAG relative luminance for white', () => {
      const lum = relLuminance('#ffffff')
      expect(lum).toBeCloseTo(1, 2)
    })

    it('calculates WCAG relative luminance for black', () => {
      const lum = relLuminance('#000000')
      expect(lum).toBeCloseTo(0, 2)
    })

    it('calculates WCAG relative luminance for mid-gray', () => {
      const lum = relLuminance('#808080')
      expect(lum).toBeGreaterThan(0.1)
      expect(lum).toBeLessThan(0.5)
    })

    it('supports #rgb shorthand', () => {
      // #fff = #ffffff
      const lum1 = relLuminance('#fff')
      const lum2 = relLuminance('#ffffff')
      expect(lum1).toBeCloseTo(lum2, 2)
    })

    it('supports #rrggbb format', () => {
      const lum = relLuminance('#aabbcc')
      expect(typeof lum).toBe('number')
      expect(lum).toBeGreaterThanOrEqual(0)
      expect(lum).toBeLessThanOrEqual(1)
    })

    it('calculates luminance for off-white (#f2f0ef)', () => {
      const lum = relLuminance('#f2f0ef')
      expect(lum).toBeGreaterThan(0.8)
    })

    it('calculates luminance for red (#dd2200)', () => {
      const lum = relLuminance('#dd2200')
      expect(lum).toBeLessThan(0.2)
    })

    // Round-2a final-fix 1: relLuminance is TOTAL — never throws, even on
    // unparseable input (rgb()/free-text from the Brand popover, malformed
    // hex). A StudioColor #rrggbbaa (8-digit) is a REAL case (not just
    // malformed-input defense): the picker always emits an alpha suffix.
    it('never throws on malformed or non-hex input — returns NaN', () => {
      expect(() => relLuminance('rgb(0,0,0)')).not.toThrow()
      expect(Number.isNaN(relLuminance('rgb(0,0,0)'))).toBe(true)
      expect(() => relLuminance('#11')).not.toThrow()
      expect(Number.isNaN(relLuminance('#11'))).toBe(true)
      expect(() => relLuminance('not-a-color')).not.toThrow()
      expect(Number.isNaN(relLuminance('not-a-color'))).toBe(true)
      expect(() => relLuminance('')).not.toThrow()
      expect(Number.isNaN(relLuminance(''))).toBe(true)
    })

    it('strips a trailing alpha pair — #rrggbbaa treated as its #rrggbb', () => {
      expect(relLuminance('#ffffffff')).toBeCloseTo(relLuminance('#ffffff'), 6)
      expect(relLuminance('#dd2200ff')).toBeCloseTo(relLuminance('#dd2200'), 6)
      expect(relLuminance('#dd220080')).toBeCloseTo(relLuminance('#dd2200'), 6)
    })

    it('strips a trailing alpha nibble — #rgba treated as its #rgb', () => {
      expect(relLuminance('#ffff')).toBeCloseTo(relLuminance('#fff'), 6)
    })
  })

  describe('resolveInk', () => {
    it('returns dark ink (#111111) for light fields', () => {
      expect(resolveInk('#f2f0ef')).toBe('#111111')
      expect(resolveInk('#ffffff')).toBe('#111111')
    })

    it('returns light ink (#f2f0ef) for dark fields', () => {
      expect(resolveInk('#000000')).toBe('#f2f0ef')
      expect(resolveInk('#dd2200')).toBe('#f2f0ef')
      expect(resolveInk('#2e6f40')).toBe('#f2f0ef')
      expect(resolveInk('#1d4ed8')).toBe('#f2f0ef')
    })

    it('uses luminance threshold of 0.45', () => {
      // A field just below the threshold should get light ink
      const darkField = '#dd2200' // luminance ≈ 0.18
      expect(resolveInk(darkField)).toBe('#f2f0ef')

      // A field just above the threshold should get dark ink
      const lightField = '#f2f0ef' // luminance ≈ 0.88
      expect(resolveInk(lightField)).toBe('#111111')
    })
  })

  describe('contrastRatio', () => {
    it('calculates contrast ratio for two colors', () => {
      const ratio = contrastRatio('#111111', '#f2f0ef')
      // (L_max + 0.05) / (L_min + 0.05)
      // Both are high-contrast colors, should be > 12
      expect(ratio).toBeGreaterThan(12)
    })

    it('is symmetric in which direction the ratio is calculated', () => {
      const ratio1 = contrastRatio('#111111', '#f2f0ef')
      const ratio2 = contrastRatio('#f2f0ef', '#111111')
      expect(ratio1).toBeCloseTo(ratio2, 2)
    })

    it('returns 1 for identical colors', () => {
      const ratio = contrastRatio('#ffffff', '#ffffff')
      expect(ratio).toBeCloseTo(1, 2)
    })

    it('returns high contrast for black and white', () => {
      const ratio = contrastRatio('#000000', '#ffffff')
      expect(ratio).toBeGreaterThan(20)
    })
  })

  describe('resolveInk / contrastRatio never throw on malformed input (relLuminance is total)', () => {
    it('resolveInk falls back to light ink instead of throwing', () => {
      expect(() => resolveInk('rgb(0,0,0)')).not.toThrow()
      expect(resolveInk('rgb(0,0,0)')).toBe('#f2f0ef')
    })
    it('contrastRatio returns NaN (not a throw) when either colour is unparseable', () => {
      expect(() => contrastRatio('rgb(0,0,0)', '#ffffff')).not.toThrow()
      expect(Number.isNaN(contrastRatio('rgb(0,0,0)', '#ffffff'))).toBe(true)
    })
  })

  describe('themeBrandDefaults (the ONE "what does this theme stamp" helper)', () => {
    it('returns background/foreground/accent matching the theme fields', () => {
      const blue = getTheme('blue')!
      expect(themeBrandDefaults(blue)).toEqual({
        background: '#1d4ed8', foreground: resolveInk('#1d4ed8'), accent: '#f2f0ef',
      })
    })
    it('BRAND_AXIS_KEYS lists exactly the three axis keys', () => {
      expect(BRAND_AXIS_KEYS).toEqual(['background', 'foreground', 'accent'])
    })
  })

  describe('SURFACE_TO_THEME migration map', () => {
    it('maps all round-1 surfaces to round-2 themes', () => {
      expect(SURFACE_TO_THEME).toEqual({
        flat: 'paper',
        holographic: 'paper',
        tint: 'red',
        'split-field': 'black',
        'duotone-photo': 'black',
      })
    })
  })
})
