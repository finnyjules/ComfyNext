import { describe, it, expect, beforeEach } from 'vitest'
import { parseLibraryFontValue, setLibraryFaceResolver, fontSourceUrl, fontDisplayName } from '../../app/lib/scene3d/outlines'
import { outlineFontValue } from '../../app/lib/spacetype/effects/loft'

describe('parseLibraryFontValue', () => {
  it('parses family, weight, italic', () => {
    expect(parseLibraryFontValue('local:PP Mori')).toEqual({ family: 'PP Mori' })
    expect(parseLibraryFontValue('local:PP Mori@700')).toEqual({ family: 'PP Mori', weight: 700 })
    expect(parseLibraryFontValue('local:PP Mori@700i')).toEqual({ family: 'PP Mori', weight: 700, italic: true })
    expect(parseLibraryFontValue('google:Inter@400')).toBeNull()
  })
})

describe('fontSourceUrl for local tokens', () => {
  beforeEach(() => setLibraryFaceResolver((family, weight) => `pangram-fake-${weight ?? 'x'}`))
  it('resolves via the registered resolver to the route', () => {
    expect(fontSourceUrl('local:PP Mori@700')).toBe('/api/library-font/pangram-fake-700')
  })
  it('unresolved token falls through to the raw value (fails the fetch cleanly)', () => {
    setLibraryFaceResolver(() => null)
    expect(fontSourceUrl('local:PP Mori@700')).toBe('local:PP Mori@700')
  })
})

describe('fontDisplayName + outlineFontValue', () => {
  it('names a local token by family', () => {
    expect(fontDisplayName('local:PP Editorial New@900')).toBe('PP Editorial New')
  })
  it('outlineFontValue leaves a local token untouched (no google: prefix)', () => {
    expect(outlineFontValue('local:PP Mori@700')).toBe('local:PP Mori@700')
  })
})
