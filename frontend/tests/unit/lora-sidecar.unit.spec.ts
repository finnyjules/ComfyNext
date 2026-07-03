import { describe, it, expect } from 'vitest'
import { sidecarAesthetic, buildLoraPrompt, parseSidecar } from '~~/server/utils/loraPrompt'

describe('parseSidecar', () => {
  it('parses a normal object sidecar', () => {
    expect(parseSidecar('{"name":"x","kind":"style"}')).toEqual({ name: 'x', kind: 'style' })
  })

  it('returns {} for the JSON literal null (JSON.parse("null") is a valid null, not a throw)', () => {
    // This is the crash vector: a sidecar file whose entire content is `null`.
    expect(parseSidecar('null')).toEqual({})
  })

  it('returns {} for non-object JSON (array, string, number, bool)', () => {
    expect(parseSidecar('[1,2,3]')).toEqual({})
    expect(parseSidecar('"hi"')).toEqual({})
    expect(parseSidecar('42')).toEqual({})
    expect(parseSidecar('true')).toEqual({})
  })

  it('returns {} for invalid/empty JSON without throwing', () => {
    expect(parseSidecar('{ broken')).toEqual({})
    expect(parseSidecar('')).toEqual({})
  })
})

describe('sidecarAesthetic', () => {
  it('reads the older `aesthetic` key', () => {
    expect(sidecarAesthetic({ aesthetic: 'warm florals, cobalt blue' })).toBe('warm florals, cobalt blue')
  })

  it('falls back to `taste_profile` (newer cloud-trained sidecars)', () => {
    expect(sidecarAesthetic({ taste_profile: 'high-contrast linocut, acidic greens' }))
      .toBe('high-contrast linocut, acidic greens')
  })

  it('prefers `aesthetic` over `taste_profile` when both present', () => {
    expect(sidecarAesthetic({ aesthetic: 'A', taste_profile: 'B' })).toBe('A')
  })

  it('skips a blank `aesthetic` and uses `taste_profile` (a `??` chain would not)', () => {
    expect(sidecarAesthetic({ aesthetic: '   ', taste_profile: 'linocut' })).toBe('linocut')
    expect(sidecarAesthetic({ aesthetic: '', taste_profile: 'linocut' })).toBe('linocut')
  })

  it('trims the returned value', () => {
    expect(sidecarAesthetic({ aesthetic: '  punk-zine  ' })).toBe('punk-zine')
  })

  it('returns "" for missing keys, empty meta, null, or non-string values', () => {
    expect(sidecarAesthetic({ trigger: 'x' })).toBe('')
    expect(sidecarAesthetic({})).toBe('')
    expect(sidecarAesthetic(null)).toBe('')
    expect(sidecarAesthetic(undefined)).toBe('')
    expect(sidecarAesthetic({ aesthetic: 123 as unknown as string })).toBe('')
  })

  it('composes into a LoRA prompt for a taste_profile-only LoRA', () => {
    const meta = { trigger: 'rough_cut_revival', taste_profile: 'high-contrast linocut' }
    const prompt = buildLoraPrompt(String(meta.trigger), sidecarAesthetic(meta), 'a portrait')
    expect(prompt).toBe('high-contrast linocut rough_cut_revival, a portrait')
  })
})
