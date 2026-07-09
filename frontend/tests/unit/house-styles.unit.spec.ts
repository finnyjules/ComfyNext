import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  HOUSE_STYLES, USE_CASE_TAGS, VERTICALS,
  houseStyleById, houseStylesForTag, houseStyleStyleBlock,
  isReplicateModelRef, WEIGHTS_TAR_RE,
} from '~/data/house-styles'

const publicDir = fileURLToPath(new URL('../../public', import.meta.url))

describe('house-styles catalog integrity', () => {
  it('has unique ids', () => {
    const ids = HOUSE_STYLES.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry is complete and valid', () => {
    for (const s of HOUSE_STYLES) {
      expect(s.id, s.id).toMatch(/^[a-z0-9-]+$/)
      expect(s.label.trim().length, s.id).toBeGreaterThan(0)
      expect(s.useCases.length, s.id).toBeGreaterThan(0)
      for (const t of s.useCases) expect(USE_CASE_TAGS, `${s.id} tag ${t}`).toContain(t)
      expect(s.trigger.trim().length, s.id).toBeGreaterThan(0)
      // tasteProfile REQUIRED — trigger-only styles land weak (spec §Risks)
      expect(s.tasteProfile.trim().length, s.id).toBeGreaterThan(40)
      expect(isReplicateModelRef(s.replicateModel), `${s.id} model ${s.replicateModel}`).toBe(true)
      expect(s.replicateModel, s.id).not.toContain(':') // version hash stripped
      expect(s.weightsUrl, s.id).toMatch(WEIGHTS_TAR_RE)
      expect(s.thumbnails.length, s.id).toBe(4)
      expect(s.examplePrompts.length, s.id).toBeGreaterThan(0)
    }
  })

  it('every thumbnail file exists on disk', () => {
    for (const s of HOUSE_STYLES) {
      for (const t of s.thumbnails) {
        expect(t, s.id).toMatch(new RegExp(`^/house-styles/${s.id}/thumb-[1-4]\\.webp$`))
        expect(existsSync(`${publicDir}${t}`), `${s.id}: missing ${t}`).toBe(true)
      }
    }
  })

  it('vertical overlay only references known tags', () => {
    for (const v of VERTICALS) for (const t of v.tags) expect(USE_CASE_TAGS).toContain(t)
  })

  it('helpers behave', () => {
    expect(houseStyleById('__nope__')).toBeUndefined()
    expect(houseStylesForTag(USE_CASE_TAGS[0]).every(s => s.useCases.includes(USE_CASE_TAGS[0]))).toBe(true)
    expect(houseStyleStyleBlock({ tasteProfile: 'Bold linocut.', trigger: 'rough_cut' }))
      .toBe('Bold linocut. rough_cut,')
    expect(houseStyleStyleBlock({ tasteProfile: 'Bold linocut.', trigger: '' })).toBe('Bold linocut.')
  })

  it('isReplicateModelRef mirrors the Python gate', () => {
    expect(isReplicateModelRef('finnyjules/jules-rough-cut')).toBe(true)
    expect(isReplicateModelRef('owner/model/version')).toBe(true)
    expect(isReplicateModelRef('https://replicate.delivery/a/b/trained_model.tar')).toBe(false)
    expect(isReplicateModelRef('owner/model.safetensors')).toBe(false)
    expect(isReplicateModelRef('huggingface.co/owner/model')).toBe(false)
    expect(isReplicateModelRef('hf.co/owner/model')).toBe(false)
    expect(isReplicateModelRef('civitai.com/models/123')).toBe(false)
    expect(isReplicateModelRef('single-segment')).toBe(false)
    expect(isReplicateModelRef('')).toBe(false)
  })
})
