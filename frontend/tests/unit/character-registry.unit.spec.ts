import { describe, expect, it } from 'vitest'
import {
  healRefImages, parseCharacterRecord, slugifyCharacterName, validRefFilename,
  type CharacterRecord,
  type CharacterVariant,
} from '~~/server/utils/characterRegistry'

function V(over: Partial<CharacterVariant> = {}): CharacterVariant {
  return {
    id: 'default', label: 'Default', descriptor: '', refImages: ['a.png'], coverIndex: 0, ...over,
  }
}

function rec(over: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    name: 'Reva', slug: 'reva', variants: [V()],
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
    expect(r).toMatchObject({ name: 'X', slug: 'x', variants: [{ id: 'default', label: 'Default', descriptor: '', refImages: [], coverIndex: 0 }], loraName: null, notes: '' })
  })
  it('returns null for non-objects and invalid JSON', () => {
    expect(parseCharacterRecord('null', 'x')).toBeNull()
    expect(parseCharacterRecord('{bad', 'x')).toBeNull()
  })
  it('drops non-string and path-escaping ref filenames on parse', () => {
    const raw = JSON.stringify({ name: 'X', refImages: ['ok.png', '../evil.png', 5, 'sub/dir.png'] })
    expect(parseCharacterRecord(raw, 'x')?.variants[0]!.refImages).toEqual(['ok.png'])
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
  it('drops refs whose file is gone and clamps coverIndex in each variant', () => {
    const { record, dropped } = healRefImages(rec({ variants: [V({ refImages: ['a.png', 'b.png'], coverIndex: 1 })] }), f => f === 'b.png')
    expect(record.variants[0]!.refImages).toEqual(['b.png'])
    expect(record.variants[0]!.coverIndex).toBe(0)
    expect(dropped).toBe(1)
  })
  it('no-ops when all files exist', () => {
    const { record, dropped } = healRefImages(rec({ variants: [V({ refImages: ['a.png', 'b.png'] })] }), () => true)
    expect(record.variants[0]!.refImages).toEqual(['a.png', 'b.png'])
    expect(dropped).toBe(0)
  })
})

describe('variant migration', () => {
  it('legacy top-level refImages hydrate into a Default variant', () => {
    const raw = JSON.stringify({ name: 'X', refImages: ['a.png', 'b.png'], coverIndex: 1 })
    const r = parseCharacterRecord(raw, 'x')!
    expect(r.variants).toEqual([{ id: 'default', label: 'Default', descriptor: '', refImages: ['a.png', 'b.png'], coverIndex: 1 }])
    expect(r).not.toHaveProperty('refImages')
  })
  it('records with neither shape get one empty Default variant', () => {
    expect(parseCharacterRecord('{"name":"X"}', 'x')!.variants).toEqual([
      { id: 'default', label: 'Default', descriptor: '', refImages: [], coverIndex: 0 },
    ])
  })
  it('variant refs are hygiene-filtered and coverIndex clamped per variant', () => {
    const raw = JSON.stringify({ name: 'X', variants: [
      { id: 'default', label: 'Default', descriptor: '', refImages: ['ok.png', '../evil.png'], coverIndex: 5 },
      { id: 'v1', label: 'Raincoat', descriptor: 'yellow raincoat', refImages: ['r.png'], coverIndex: 0 },
    ] })
    const r = parseCharacterRecord(raw, 'x')!
    expect(r.variants[0]!.refImages).toEqual(['ok.png'])
    expect(r.variants[0]!.coverIndex).toBe(0)
    expect(r.variants[1]!.label).toBe('Raincoat')
  })
  it('a default variant is always present and first', () => {
    const raw = JSON.stringify({ name: 'X', variants: [{ id: 'v1', label: 'B', descriptor: '', refImages: [], coverIndex: 0 }] })
    const r = parseCharacterRecord(raw, 'x')!
    expect(r.variants[0]!.id).toBe('default')
    expect(r.variants).toHaveLength(2)
  })
})

describe('healRefImages across variants', () => {
  it('drops vanished refs in every variant and reports the total', () => {
    const record = parseCharacterRecord(JSON.stringify({ name: 'X', variants: [
      V({ refImages: ['a.png', 'b.png'], coverIndex: 1 }),
      V({ id: 'v1', label: 'Alt', refImages: ['c.png'] }),
    ] }), 'x')!
    const { record: healed, dropped } = healRefImages(record, f => f === 'b.png')
    expect(healed.variants[0]!.refImages).toEqual(['b.png'])
    expect(healed.variants[0]!.coverIndex).toBe(0)
    expect(healed.variants[1]!.refImages).toEqual([])
    expect(dropped).toBe(2)
  })
})
