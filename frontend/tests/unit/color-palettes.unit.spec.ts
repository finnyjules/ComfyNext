import { describe, it, expect } from 'vitest'
import { CURATED_PALETTES, palettesByType } from '~/lib/color/palettes'
import { HARMONY_TYPES } from '~/lib/color/harmony'

describe('curated palettes', () => {
  it('are all valid: named, typed, ≥2 valid hex colors', () => {
    expect(CURATED_PALETTES.length).toBeGreaterThan(0)
    for (const p of CURATED_PALETTES) {
      expect(p.name).toBeTruthy()
      expect(HARMONY_TYPES).toContain(p.type)
      expect(p.colors.length).toBeGreaterThanOrEqual(2)
      p.colors.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    }
  })

  it('cover every harmony type so no gallery row is empty', () => {
    for (const type of HARMONY_TYPES) {
      expect(palettesByType(type).length).toBeGreaterThan(0)
    }
  })

  it('palettesByType returns only that type', () => {
    for (const p of palettesByType('triadic')) expect(p.type).toBe('triadic')
  })
})
