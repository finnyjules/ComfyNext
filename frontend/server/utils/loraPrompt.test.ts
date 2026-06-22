import { describe, it, expect } from 'vitest'
import { buildLoraPrompt } from './loraPrompt'

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
})
