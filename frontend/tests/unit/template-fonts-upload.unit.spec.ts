import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_EXTS, MAX_FONT_BYTES, slugifyFamily, sniffFontType, upsertManifest, validateUpload,
  type UploadedFont,
} from '~~/server/templates/fonts'

/** First 4+ bytes for each font signature, padded out to a plausible header. */
function header(sig: number[]): Uint8Array {
  return new Uint8Array([...sig, ...new Array(16).fill(0)])
}
const TTF = header([0x00, 0x01, 0x00, 0x00])
const TTF_TRUE = header([0x74, 0x72, 0x75, 0x65]) // 'true'
const TTCF = header([0x74, 0x74, 0x63, 0x66])     // 'ttcf'
const OTF = header([0x4f, 0x54, 0x54, 0x4f])      // 'OTTO'
const WOFF = header([0x77, 0x4f, 0x46, 0x46])     // 'wOFF'
const WOFF2 = header([0x77, 0x4f, 0x46, 0x32])    // 'wOF2'
const JUNK = header([0x89, 0x50, 0x4e, 0x47])     // PNG

describe('slugifyFamily', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugifyFamily('Acme Grotesk')).toBe('acme-grotesk')
  })
  it('strips punctuation and trims dashes', () => {
    expect(slugifyFamily('  LIV Golf™ 2025!! ')).toBe('liv-golf-2025')
  })
  it('falls back to "font" for empty/garbage', () => {
    expect(slugifyFamily('   ')).toBe('font')
    expect(slugifyFamily('™™')).toBe('font')
  })
})

describe('sniffFontType', () => {
  it('recognises ttf signatures', () => {
    expect(sniffFontType(TTF)).toBe('ttf')
    expect(sniffFontType(TTF_TRUE)).toBe('ttf')
    expect(sniffFontType(TTCF)).toBe('ttf')
  })
  it('recognises otf, woff, woff2', () => {
    expect(sniffFontType(OTF)).toBe('otf')
    expect(sniffFontType(WOFF)).toBe('woff')
    expect(sniffFontType(WOFF2)).toBe('woff2')
  })
  it('returns null for non-font bytes', () => {
    expect(sniffFontType(JUNK)).toBeNull()
    expect(sniffFontType(new Uint8Array([0x00, 0x01]))).toBeNull()
  })
})

describe('validateUpload', () => {
  it('accepts a real ttf within the size cap', () => {
    expect(validateUpload({ ext: '.ttf', size: 50_000, bytes: TTF })).toEqual({ ok: true })
  })
  it('accepts otf and woff', () => {
    expect(validateUpload({ ext: '.otf', size: 1000, bytes: OTF }).ok).toBe(true)
    expect(validateUpload({ ext: '.woff', size: 1000, bytes: WOFF }).ok).toBe(true)
  })
  it('rejects an unaccepted extension (incl. .woff2)', () => {
    expect(ACCEPTED_EXTS).not.toContain('.woff2')
    const r = validateUpload({ ext: '.woff2', size: 1000, bytes: WOFF2 })
    expect(r.ok).toBe(false)
  })
  it('rejects a woff2 disguised with a .ttf extension (would crash satori)', () => {
    const r = validateUpload({ ext: '.ttf', size: 1000, bytes: WOFF2 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/woff2/i)
  })
  it('rejects unrecognised bytes even with a good extension', () => {
    const r = validateUpload({ ext: '.ttf', size: 1000, bytes: JUNK })
    expect(r.ok).toBe(false)
  })
  it('rejects files over the size cap', () => {
    const r = validateUpload({ ext: '.ttf', size: MAX_FONT_BYTES + 1, bytes: TTF })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/large|size|big/i)
  })
})

describe('upsertManifest', () => {
  it('mirrors a brand-new family\'s single weight to both 400 and 700', () => {
    const out = upsertManifest([], { family: 'Acme', slug: 'acme', weight: '400', file: 'acme-400.ttf' })
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      family: 'Acme', slug: 'acme',
      weights: { '400': 'acme-400.ttf', '700': 'acme-400.ttf' },
    })
  })
  it('a real second weight replaces the mirror without touching the other', () => {
    const one = upsertManifest([], { family: 'Acme', slug: 'acme', weight: '400', file: 'acme-400.ttf' })
    const two = upsertManifest(one, { family: 'Acme', slug: 'acme', weight: '700', file: 'acme-700.ttf' })
    expect(two[0].weights).toEqual({ '400': 'acme-400.ttf', '700': 'acme-700.ttf' })
  })
  it('re-uploading the same weight overwrites just that file', () => {
    const one = upsertManifest([], { family: 'Acme', slug: 'acme', weight: '400', file: 'acme-400.ttf' })
    const two = upsertManifest(one, { family: 'Acme', slug: 'acme', weight: '400', file: 'acme-400.otf' })
    expect(two).toHaveLength(1)
    expect(two[0].weights['400']).toBe('acme-400.otf')
    // 700 still mirrors the original 400 (unchanged)
    expect(two[0].weights['700']).toBe('acme-400.ttf')
  })
  it('keeps families distinct by slug and preserves order', () => {
    let m: UploadedFont[] = []
    m = upsertManifest(m, { family: 'Acme', slug: 'acme', weight: '400', file: 'acme-400.ttf' })
    m = upsertManifest(m, { family: 'Beta', slug: 'beta', weight: '400', file: 'beta-400.woff' })
    expect(m.map(f => f.slug)).toEqual(['acme', 'beta'])
  })
})
