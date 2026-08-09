import { describe, it, expect } from 'vitest'
import { librariesByFoundry, libraryFontUrl, resolveLibraryFace, libraryFamily, libraryToken } from '../../app/data/library-fonts'

describe('library catalog', () => {
  it('groups families under both foundries', () => {
    const groups = librariesByFoundry()
    const ids = groups.map(g => g.foundry.id)
    expect(ids).toContain('pangram')
    expect(ids).toContain('off-type')
    for (const g of groups) expect(g.families.length).toBeGreaterThan(0)
  })
  it('builds a route url from a face id', () => {
    expect(libraryFontUrl('pangram-ppmori-book')).toBe('/api/library-font/pangram-ppmori-book')
  })
  it('resolveLibraryFace picks nearest weight and honours italic', () => {
    const fam = librariesByFoundry().flatMap(g => g.families).find(f => f.faces.length > 2)!
    const target = fam.faces[Math.floor(fam.faces.length / 2)]!
    const got = resolveLibraryFace(fam.family, target.weight, target.italic)
    expect(got?.weight).toBe(target.weight)
    expect(got?.italic).toBe(target.italic)
  })
  it('resolveLibraryFace falls back to a real face for an off-scale weight', () => {
    const fam = librariesByFoundry().flatMap(g => g.families)[0]!
    const got = resolveLibraryFace(fam.family, 9999, false)
    expect(got).not.toBeNull()
  })
  it('returns null for an unknown family', () => {
    expect(libraryFamily('No Such Family 123')).toBeNull()
    expect(resolveLibraryFace('No Such Family 123', 400)).toBeNull()
  })
  it('builds local: tokens', () => {
    expect(libraryToken('PP Mori')).toBe('local:PP Mori')
    expect(libraryToken('PP Mori', 700)).toBe('local:PP Mori@700')
    expect(libraryToken('PP Mori', 700, true)).toBe('local:PP Mori@700i')
  })
})
