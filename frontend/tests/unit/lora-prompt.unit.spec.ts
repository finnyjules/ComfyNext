import { describe, it, expect } from 'vitest'
import { buildLoraPrompt, promptAesthetic } from '../../server/utils/loraPrompt'

describe('buildLoraPrompt', () => {
  it('composes aesthetic + trigger + prompt', () => {
    expect(buildLoraPrompt('mystyle', 'oil paint, warm', 'a red car'))
      .toBe('oil paint, warm mystyle, a red car')
  })
  it('omits a missing trigger', () => {
    expect(buildLoraPrompt('', 'oil paint', 'a red car')).toBe('oil paint a red car')
  })
  it('omits a missing aesthetic', () => {
    expect(buildLoraPrompt('mystyle', '', 'a red car')).toBe('mystyle, a red car')
  })
  it('trims and tolerates all-empty', () => {
    expect(buildLoraPrompt('  ', '  ', '  ')).toBe('')
  })
  it('does not duplicate the trigger when the user prompt already leads with it', () => {
    // Sheet generation prepends the trigger client-side; the server must not add it again.
    expect(buildLoraPrompt('char_sheila_1', 'warm film look', 'char_sheila_1, close-up portrait'))
      .toBe('warm film look char_sheila_1, close-up portrait')
  })
})

describe('promptAesthetic', () => {
  it('returns the sidecar aesthetic for style LoRAs', () => {
    expect(promptAesthetic({ aesthetic: 'oil paint, warm', kind: 'style' })).toBe('oil paint, warm')
    expect(promptAesthetic({ aesthetic: 'oil paint, warm' })).toBe('oil paint, warm') // legacy: no kind
  })
  it('returns nothing for character LoRAs (set-level prose like "the models" pushes multi-person outputs)', () => {
    expect(promptAesthetic({ aesthetic: 'soft light on the models and the subjects', kind: 'character' })).toBe('')
  })
})
