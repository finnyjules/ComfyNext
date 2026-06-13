import { describe, it, expect } from 'vitest'
import {
  VOICE_CATALOG, voiceMetaFor, voicesForOptions, mergeClonedVoices, galleryVoices,
  type VoiceMeta, type ClonedVoice,
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
  it('returns label, category, source and sample url for a known voice', () => {
    const m = voiceMetaFor('Wise_Woman')
    expect(m).toEqual<VoiceMeta>({
      id: 'Wise_Woman',
      label: 'Wise Woman',
      category: 'Female',
      source: 'default',
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

describe('mergeClonedVoices', () => {
  const cloned: ClonedVoice[] = [
    { id: 'voice_abc', name: 'My narrator', model: 'speech-02-hd', previewUrl: '/api/voice-preview-file?id=voice_abc', createdAt: '2026-06-13T00:00:00Z' },
    { id: 'voice_def', name: 'Grandpa', model: 'speech-02-hd', previewUrl: null },
  ]
  it('maps a cloned voice to a VoiceMeta with source=cloned and category=Cloned', () => {
    const [a] = mergeClonedVoices(cloned)
    expect(a).toEqual<VoiceMeta>({
      id: 'voice_abc',
      label: 'My narrator',
      category: 'Cloned',
      source: 'cloned',
      sampleUrl: '/api/voice-preview-file?id=voice_abc',
    })
  })
  it('carries through a null preview as a preview-less entry', () => {
    expect(mergeClonedVoices(cloned)[1]!.sampleUrl).toBeNull()
  })
})

describe('galleryVoices', () => {
  const cloned: ClonedVoice[] = [
    { id: 'voice_abc', name: 'My narrator', previewUrl: '/api/voice-preview-file?id=voice_abc' },
  ]
  it('lists known default voices (in options) followed by cloned voices', () => {
    const out = galleryVoices(['Casual_Guy', 'Wise_Woman', 'voice_abc'], cloned)
    expect(out.map(v => v.id)).toEqual(['Wise_Woman', 'Casual_Guy', 'voice_abc'])
    expect(out.map(v => v.source)).toEqual(['default', 'default', 'cloned'])
  })
  it('does not duplicate a cloned id that also appears in options', () => {
    const out = galleryVoices(['voice_abc'], cloned)
    expect(out.filter(v => v.id === 'voice_abc')).toHaveLength(1)
  })
  it('omits option ids that are neither known defaults nor cloned', () => {
    const out = galleryVoices(['Wise_Woman', 'ghost_id'], cloned)
    expect(out.map(v => v.id)).toEqual(['Wise_Woman', 'voice_abc'])
  })
})
