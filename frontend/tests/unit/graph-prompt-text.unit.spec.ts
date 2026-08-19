import { describe, it, expect } from 'vitest'
import { extractGraphPromptText, extractProviderPromptText } from '../../server/utils/graphPromptText'

describe('extractGraphPromptText', () => {
  it('joins prompt-bearing string inputs, skips links + non-prompt fields', () => {
    const g = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a red cat' } },
      '2': { class_type: 'GenerateImageNode', inputs: { prompt: 'a dog', model: 'flux', seed: 5 } },
      '3': { class_type: 'KSampler', inputs: { positive: ['1', 0], negative: 'blurry' } },
    }
    const t = extractGraphPromptText(g as any)
    expect(t).toContain('a red cat'); expect(t).toContain('a dog'); expect(t).toContain('blurry')
    expect(t).not.toContain('flux'); expect(t).not.toContain('5')
  })
  it('empty graph → empty string', () => { expect(extractGraphPromptText({} as any)).toBe('') })
  it('tolerates a nullish graph → empty string', () => {
    expect(extractGraphPromptText(null as any)).toBe('')
    expect(extractGraphPromptText(undefined as any)).toBe('')
  })
})

describe('extractProviderPromptText', () => {
  it('prefers the prompt field', () => {
    expect(extractProviderPromptText({ prompt: 'a red cat', width: 512 })).toBe('a red cat')
  })
  it('falls back to the text field when prompt is absent', () => {
    expect(extractProviderPromptText({ text: 'a dog', steps: 20 })).toBe('a dog')
  })
  it('joins the string values when there is no obvious prompt field', () => {
    const t = extractProviderPromptText({ style: 'noir', subject: 'a fox', seed: 3 })
    expect(t).toContain('noir'); expect(t).toContain('a fox'); expect(t).not.toContain('3')
  })
  it('tolerates a nullish input → empty string', () => {
    expect(extractProviderPromptText(null as any)).toBe('')
    expect(extractProviderPromptText(undefined as any)).toBe('')
  })
})
