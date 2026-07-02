import { describe, expect, it } from 'vitest'
import {
  healRefImages, parseCharacterRecord, slugifyCharacterName, validRefFilename,
  type CharacterRecord,
} from '~~/server/utils/characterRegistry'

function rec(over: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    name: 'Reva', slug: 'reva', refImages: ['a.png', 'b.png'], coverIndex: 0,
    loraName: null, trigger: null, notes: '', createdAt: 't', updatedAt: 't', ...over,
  }
}

describe('slugifyCharacterName', () => {
  it('lowercases, hyphenates, strips unsafe chars', () => {
    expect(slugifyCharacterName('Reva Marlowe')).toBe('reva-marlowe')
    expect(slugifyCharacterName('  Dr. Núñez!  ')).toBe('dr-nunez')
  })
  it('returns empty for names with no usable chars', () => {
    expect(slugifyCharacterName('///')).toBe('')
  })
})

describe('parseCharacterRecord', () => {
  it('parses a full record and trusts the given slug over the file field', () => {
    const raw = JSON.stringify(rec({ slug: 'stale-slug' }))
    expect(parseCharacterRecord(raw, 'reva')?.slug).toBe('reva')
  })
  it('defaults missing fields (old/partial records hydrate safely)', () => {
    const r = parseCharacterRecord('{"name":"X"}', 'x')
    expect(r).toMatchObject({ name: 'X', slug: 'x', refImages: [], coverIndex: 0, loraName: null, notes: '' })
  })
  it('returns null for non-objects and invalid JSON', () => {
    expect(parseCharacterRecord('null', 'x')).toBeNull()
    expect(parseCharacterRecord('{bad', 'x')).toBeNull()
  })
  it('drops non-string and path-escaping ref filenames on parse', () => {
    const raw = JSON.stringify({ name: 'X', refImages: ['ok.png', '../evil.png', 5, 'sub/dir.png'] })
    expect(parseCharacterRecord(raw, 'x')?.refImages).toEqual(['ok.png'])
  })
})

describe('validRefFilename', () => {
  it('accepts plain filenames, rejects traversal/separators/empty', () => {
    expect(validRefFilename('char-reva_1.png')).toBe(true)
    expect(validRefFilename('../x.png')).toBe(false)
    expect(validRefFilename('a/b.png')).toBe(false)
    expect(validRefFilename('a\\b.png')).toBe(false)
    expect(validRefFilename('')).toBe(false)
  })
})

describe('healRefImages', () => {
  it('drops refs whose file is gone and clamps coverIndex', () => {
    const { record, dropped } = healRefImages(rec({ coverIndex: 1 }), f => f === 'b.png')
    expect(record.refImages).toEqual(['b.png'])
    expect(record.coverIndex).toBe(0)
    expect(dropped).toBe(1)
  })
  it('no-ops when all files exist', () => {
    const { record, dropped } = healRefImages(rec(), () => true)
    expect(record.refImages).toEqual(['a.png', 'b.png'])
    expect(dropped).toBe(0)
  })
})
