import { describe, it, expect } from 'vitest'
import { fillSwatchKey, parseFillSwatchKey, readFillSwatch, writeFillSwatch } from '~/lib/spacetype/fillSwatchPath'
import { serializeFills } from '~/lib/spacetype/fillTile'

const twoFills = serializeFills([
  { type: 'solid', a: '#111111', b: '#222222', textColor: '#333333', angle: 45, density: 8 },
  { type: 'ombre', a: '#aaaaaa', b: '#bbbbbb', textColor: '#cccccc', angle: 90, density: 4 },
])

describe('fillSwatchKey / parseFillSwatchKey', () => {
  it('round-trips a swatch key', () => {
    const k = fillSwatchKey('fills', 1, 'textColor')
    expect(k).toBe('fills.1.textColor')
    expect(parseFillSwatchKey('fills', k)).toEqual({ index: 1, field: 'textColor' })
  })
  it('parses a/b/textColor', () => {
    expect(parseFillSwatchKey('fills', 'fills.0.a')).toEqual({ index: 0, field: 'a' })
    expect(parseFillSwatchKey('fills', 'fills.2.b')).toEqual({ index: 2, field: 'b' })
  })
  it('rejects flat param keys and foreign prefixes', () => {
    expect(parseFillSwatchKey('fills', 'typeHeight')).toBe(null)
    expect(parseFillSwatchKey('fills', 'bSideColor')).toBe(null)
    expect(parseFillSwatchKey('fills', 'fills.0.angle')).toBe(null) // not a colour field
    expect(parseFillSwatchKey('fills', 'fills.x.a')).toBe(null)      // non-numeric index
    expect(parseFillSwatchKey('fills', 'other.0.a')).toBe(null)      // wrong fill list key
  })
})

describe('readFillSwatch', () => {
  it('reads a swatch colour', () => {
    expect(readFillSwatch(twoFills, 0, 'a')).toBe('#111111')
    expect(readFillSwatch(twoFills, 1, 'textColor')).toBe('#cccccc')
  })
  it('returns null out of range', () => {
    expect(readFillSwatch(twoFills, 5, 'a')).toBe(null)
  })
})

describe('writeFillSwatch', () => {
  it('replaces one swatch and preserves the rest', () => {
    const next = writeFillSwatch(twoFills, 0, 'a', '#ff0000')
    expect(readFillSwatch(next, 0, 'a')).toBe('#ff0000')
    expect(readFillSwatch(next, 0, 'b')).toBe('#222222')       // sibling field untouched
    expect(readFillSwatch(next, 1, 'a')).toBe('#aaaaaa')       // other fill untouched
  })
  it('is a no-op for an out-of-range index (re-serializes unchanged)', () => {
    const next = writeFillSwatch(twoFills, 9, 'a', '#ff0000')
    expect(readFillSwatch(next, 0, 'a')).toBe('#111111')
    expect(readFillSwatch(next, 1, 'a')).toBe('#aaaaaa')
  })
})
