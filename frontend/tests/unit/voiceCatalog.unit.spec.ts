import { describe, it, expect } from 'vitest'
import {
  VOICE_CATALOG, voiceMetaFor, voicesForOptions, type VoiceMeta,
} from '~/lib/voiceCatalog'

describe('VOICE_CATALOG', () => {
  it('covers all 17 MiniMax system voices with unique ids', () => {
    expect(VOICE_CATALOG).toHaveLength(17)
    const ids = new Set(VOICE_CATALOG.map(v => v.id))
    expect(ids.size).toBe(17)
  })
  it('buckets every voice into a known category', () => {
    for (const v of VOICE_CATALOG) {
      expect(['Female', 'Male', 'Character']).toContain(v.category)
    }
  })
})

describe('voiceMetaFor', () => {
  it('returns label, category and sample url for a known voice', () => {
    const m = voiceMetaFor('Wise_Woman')
    expect(m).toEqual<VoiceMeta>({
      id: 'Wise_Woman',
      label: 'Wise Woman',
      category: 'Female',
      sampleUrl: '/voice-samples/Wise_Woman.mp3',
    })
  })
  it('humanizes lowercase and numeric id segments', () => {
    expect(voiceMetaFor('Inspirational_girl').label).toBe('Inspirational Girl')
    expect(voiceMetaFor('Sweet_Girl_2').label).toBe('Sweet Girl 2')
    expect(voiceMetaFor('Deep_Voice_Man').label).toBe('Deep Voice Man')
  })
  it('falls back to a preview-less humanized entry for an unknown id', () => {
    const m = voiceMetaFor('Totally_New_Voice')
    expect(m.label).toBe('Totally New Voice')
    expect(m.category).toBe('Character')
    expect(m.sampleUrl).toBeNull()
  })
})

describe('voicesForOptions', () => {
  it('keeps catalog order regardless of option order', () => {
    const out = voicesForOptions(['Casual_Guy', 'Wise_Woman'])
    expect(out.map(v => v.id)).toEqual(['Wise_Woman', 'Casual_Guy'])
  })
  it('excludes catalog voices that are not in the options', () => {
    const out = voicesForOptions(['Wise_Woman'])
    expect(out.map(v => v.id)).toEqual(['Wise_Woman'])
  })
  it('appends unknown option ids as preview-less entries after the known ones', () => {
    const out = voicesForOptions(['Mystery_X', 'Wise_Woman'])
    expect(out.map(v => v.id)).toEqual(['Wise_Woman', 'Mystery_X'])
    expect(out[1]!.sampleUrl).toBeNull()
  })
})
