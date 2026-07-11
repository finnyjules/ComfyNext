import { describe, it, expect } from 'vitest'
import { effectiveBrand, paletteSlug, virtualPalette, brandSwatches } from '../../shared/brand/resolve'
import type { BrandKit } from '../../shared/brand/types'

const VIRIDIAN = { id: 'e1', name: 'Deep Viridian', hex: '#2A8C6E' }
const CORAL = { id: 'e2', name: 'Coral', hex: '#FF6B57' }

describe('paletteSlug', () => {
  it('lowercases and joins words with underscores', () => {
    expect(paletteSlug('Deep Viridian')).toBe('deep_viridian')
    expect(paletteSlug('Coral')).toBe('coral')
  })
  it('collapses repeats and trims edge separators', () => {
    expect(paletteSlug('  Neon -- Pink!! ')).toBe('neon_pink')
    expect(paletteSlug('Accent 2')).toBe('accent_2')
  })
  it('empty/symbol-only names slug to the empty string', () => {
    expect(paletteSlug('—')).toBe('')
  })
})

describe('virtualPalette', () => {
  it('derives entries + role mapping from legacy flat fields', () => {
    const { entries, roles } = virtualPalette({ primary: '#111111', background: '#000000' })
    expect(entries).toEqual([
      { id: 'legacy-primary', name: 'Primary', hex: '#111111' },
      { id: 'legacy-background', name: 'Background', hex: '#000000' },
    ])
    expect(roles).toEqual({ primary: 'legacy-primary', background: 'legacy-background' })
  })
  it('returns empty for kits with a real palette or no colors', () => {
    expect(virtualPalette({ palette: [VIRIDIAN] }).entries).toEqual([])
    expect(virtualPalette({}).entries).toEqual([])
    expect(virtualPalette(undefined).entries).toEqual([])
  })
})

describe('brandSwatches', () => {
  it('prefers palette entries, with names', () => {
    expect(brandSwatches({ palette: [VIRIDIAN, CORAL], primary: '#999999' }))
      .toEqual([{ name: 'Deep Viridian', hex: '#2A8C6E' }, { name: 'Coral', hex: '#FF6B57' }])
  })
  it('falls back to the virtual palette for legacy kits', () => {
    expect(brandSwatches({ accent: '#A3E635' })).toEqual([{ name: 'Accent', hex: '#A3E635' }])
  })
  it('skips palette entries missing a name or hex, and handles no kit', () => {
    expect(brandSwatches({ palette: [{ id: 'x', name: '', hex: '#fff' }, { id: 'y', name: 'Ok', hex: '' }, VIRIDIAN] }))
      .toEqual([{ name: 'Deep Viridian', hex: '#2A8C6E' }])
    expect(brandSwatches(undefined)).toEqual([])
  })
})

describe('effectiveBrand — palette & roles', () => {
  it('materializes role keys from roles→palette by id', () => {
    const kit: BrandKit = { palette: [VIRIDIAN, CORAL], roles: { background: 'e1', primary: 'e2' } }
    const b = effectiveBrand(undefined, kit)
    expect(b.background).toBe('#2A8C6E')
    expect(b.primary).toBe('#FF6B57')
  })
  it('renaming an entry does not break its role (id-referenced)', () => {
    const kit: BrandKit = { palette: [{ ...VIRIDIAN, name: 'Renamed' }], roles: { background: 'e1' } }
    expect(effectiveBrand(undefined, kit).background).toBe('#2A8C6E')
  })
  it('unmapped roles fall back to legacy flat values', () => {
    const kit: BrandKit = { palette: [VIRIDIAN], roles: { background: 'e1' }, primary: '#123456' }
    const b = effectiveBrand(undefined, kit)
    expect(b.primary).toBe('#123456')
  })
  it('dangling role ids (deleted entry) are ignored', () => {
    const kit: BrandKit = { palette: [VIRIDIAN], roles: { primary: 'gone' } }
    expect(effectiveBrand(undefined, kit).primary).toBeUndefined()
  })
  it('exposes flat palette token keys for explicit palettes', () => {
    const b = effectiveBrand(undefined, { palette: [VIRIDIAN] }) as unknown as Record<string, unknown>
    expect(b['palette.deep_viridian']).toBe('#2A8C6E')
  })
  it('legacy kits (no explicit palette) mint no flat palette.* token keys', () => {
    const b = effectiveBrand(undefined, { primary: '#111111' }) as unknown as Record<string, unknown>
    expect(Object.keys(b).some(k => k.startsWith('palette.'))).toBe(false)
  })
  it('a later layer palette replaces the whole array; roles merge per-role', () => {
    const b = effectiveBrand(
      { palette: [CORAL], roles: { primary: 'e2', accent: 'e2' } },
      { palette: [VIRIDIAN], roles: { primary: 'e1' } },
    )
    expect(b.palette).toEqual([VIRIDIAN])
    expect(b.primary).toBe('#2A8C6E')   // e1 in the winning palette
    expect(b.accent).toBeUndefined()    // e2 no longer exists in the winning palette
  })
})
