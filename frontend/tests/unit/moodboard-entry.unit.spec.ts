import { describe, expect, it } from 'vitest'
import { validateMoodboardEntry, MOODBOARD_ID_RE, MOODBOARD_FOLDER_RE } from '../../shared/taste/moodboard'

const good = {
  id: 'pastel-miami', name: 'Pastel Miami', createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z', folder: 'moodboard_1786000000000',
  reading: { summary: 'sun-bleached pastel', palette: [{ name: 'Blush', hex: '#F6C1CB' }], avoids: ['neon'] },
}

describe('validateMoodboardEntry', () => {
  it('accepts a well-formed entry and round-trips it', () => {
    expect(validateMoodboardEntry(structuredClone(good))).toEqual(good)
  })
  it('rejects a traversal id, a bad folder, and a bad hex', () => {
    expect(() => validateMoodboardEntry({ ...good, id: '../etc' })).toThrow(/id/)
    expect(() => validateMoodboardEntry({ ...good, folder: 'lora_dataset_1' })).toThrow(/folder/)
    expect(() => validateMoodboardEntry({ ...good, reading: { ...good.reading, palette: [{ name: 'X', hex: 'red' }] } })).toThrow(/hex/)
  })
  it('rejects an empty summary — a moodboard never saves without a reading', () => {
    expect(() => validateMoodboardEntry({ ...good, reading: { ...good.reading, summary: ' ' } })).toThrow(/summary/)
  })
  it('regexes are anchored (broken control: unanchored would pass these)', () => {
    expect(MOODBOARD_ID_RE.test('a/../b')).toBe(false)
    expect(MOODBOARD_FOLDER_RE.test('xmoodboard_1x')).toBe(false)
  })
})
