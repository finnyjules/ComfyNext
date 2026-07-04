import { describe, it, expect } from 'vitest'
import { buildCopyAssistPrompt, copyAssistSchema, clampCount } from '~~/server/lib/copyAssist'
import type { CopyAssistRequest } from '~~/server/lib/copyAssist'

describe('buildCopyAssistPrompt', () => {
  const base: CopyAssistRequest = {
    apiKey: 'x',
    mode: 'variations',
    text: 'Summer sale ends soon, grab it now.',
  }

  it('always includes the length rule and ad-copy register', () => {
    const p = buildCopyAssistPrompt(base)
    expect(p).toContain('±20%')
    expect(p).toContain('ad-copy')
    expect(p.toLowerCase()).toContain('no surrounding quotes')
    expect(p.toLowerCase()).toContain('numbering')
  })

  it('variations mode: preserve intent/tone, vary hook', () => {
    const p = buildCopyAssistPrompt(base)
    expect(p).toContain(base.text)
    expect(p.toLowerCase()).toContain('intent')
    expect(p.toLowerCase()).toContain('hook')
  })

  it('brief mode: uses brief text and optional brandTone/otherTexts', () => {
    const req: CopyAssistRequest = {
      apiKey: 'x',
      mode: 'brief',
      text: '',
      brief: 'Launch our new eco-friendly water bottle',
      context: { brandTone: 'playful and bold', otherTexts: ['Stay hydrated.', 'Drink up.'] },
    }
    const p = buildCopyAssistPrompt(req)
    expect(p).toContain('Launch our new eco-friendly water bottle')
    expect(p).toContain('playful and bold')
    expect(p).toContain('Stay hydrated.')
    expect(p).toContain('Drink up.')
  })

  it('brief mode: works without optional context', () => {
    const req: CopyAssistRequest = {
      apiKey: 'x',
      mode: 'brief',
      text: '',
      brief: 'Announce a flash sale',
    }
    const p = buildCopyAssistPrompt(req)
    expect(p).toContain('Announce a flash sale')
  })

  it('translate mode: marketing localization, one option per language, tags language', () => {
    const req: CopyAssistRequest = {
      apiKey: 'x',
      mode: 'translate',
      text: 'Grab it before it is gone.',
      languages: ['fr', 'de', 'es'],
    }
    const p = buildCopyAssistPrompt(req)
    expect(p.toLowerCase()).toContain('localiz')
    expect(p.toLowerCase()).toContain('not literal translation')
    expect(p).toContain('fr')
    expect(p).toContain('de')
    expect(p).toContain('es')
    expect(p.toLowerCase()).toContain('language')
  })
})

describe('copyAssistSchema', () => {
  it('variations/brief: language not required on option items', () => {
    const schema: any = copyAssistSchema('variations')
    expect(schema.properties.options.items.required).toEqual(['text'])
    expect(schema.properties.options.items.properties.language).toBeDefined()
  })

  it('translate: language required on option items', () => {
    const schema: any = copyAssistSchema('translate')
    expect(schema.properties.options.items.required).toEqual(expect.arrayContaining(['text', 'language']))
  })

  it('is a strict json schema (no open objects)', () => {
    const schema: any = copyAssistSchema('brief')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.options.items.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['options'])
  })
})

describe('clampCount', () => {
  it('defaults to 5', () => {
    expect(clampCount({ apiKey: 'x', mode: 'variations', text: 'hi' })).toBe(5)
  })

  it('clamps to [1, 8]', () => {
    expect(clampCount({ apiKey: 'x', mode: 'variations', text: 'hi', count: 0 })).toBe(1)
    expect(clampCount({ apiKey: 'x', mode: 'variations', text: 'hi', count: -3 })).toBe(1)
    expect(clampCount({ apiKey: 'x', mode: 'variations', text: 'hi', count: 20 })).toBe(8)
    expect(clampCount({ apiKey: 'x', mode: 'variations', text: 'hi', count: 3 })).toBe(3)
  })

  it('translate mode: languages.length wins over count', () => {
    expect(clampCount({ apiKey: 'x', mode: 'translate', text: 'hi', languages: ['fr', 'de', 'es'], count: 2 })).toBe(3)
  })

  it('translate mode: clamps languages.length to 8', () => {
    const languages = ['fr', 'de', 'es', 'it', 'pt', 'nl', 'ja', 'en', 'ru']
    expect(clampCount({ apiKey: 'x', mode: 'translate', text: 'hi', languages })).toBe(8)
  })
})
