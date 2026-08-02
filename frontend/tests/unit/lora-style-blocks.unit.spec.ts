import { describe, it, expect } from 'vitest'
import { slotAestheticKey, composeLoraStyle } from '~/lib/graph/loraStyleBlocks'

/**
 * FluxMultiLoRARemoteNode stacks up to four LoRAs (slots A-D). Before this
 * module existed, every slot's style gallery pick wrote the same
 * `properties.aesthetic` key, so picking a style into a second slot silently
 * overwrote the first — that LoRA's weights still loaded (wired via the slot
 * widgets) but its trigger word/prose never reached the prompt, so it ran
 * under-steered. slotAestheticKey + composeLoraStyle give each slot its own
 * block and concatenate them at submit.
 */

describe('slotAestheticKey', () => {
  it('maps lora_a..lora_d to aesthetic_a..aesthetic_d', () => {
    expect(slotAestheticKey('lora_a')).toBe('aesthetic_a')
    expect(slotAestheticKey('lora_b')).toBe('aesthetic_b')
    expect(slotAestheticKey('lora_c')).toBe('aesthetic_c')
    expect(slotAestheticKey('lora_d')).toBe('aesthetic_d')
  })

  it('returns null for the single-LoRA node\'s slot', () => {
    expect(slotAestheticKey('lora_name')).toBeNull()
  })

  it('returns null for junk that merely resembles a slot name', () => {
    expect(slotAestheticKey('lora_e')).toBeNull()
    expect(slotAestheticKey('scale_a')).toBeNull()
  })
})

describe('composeLoraStyle', () => {
  it('returns an empty string when nothing is set', () => {
    expect(composeLoraStyle({})).toBe('')
    expect(composeLoraStyle(null)).toBe('')
    expect(composeLoraStyle(undefined)).toBe('')
  })

  it('returns the node-level aesthetic alone when only it is set', () => {
    expect(composeLoraStyle({ aesthetic: 'Moody grain, teal.' })).toBe('Moody grain, teal.')
  })

  it('falls back to the legacy tasteProfile key', () => {
    expect(composeLoraStyle({ tasteProfile: 'Legacy prose.' })).toBe('Legacy prose.')
  })

  it('concatenates several slot keys in a-b-c-d order regardless of input order', () => {
    expect(composeLoraStyle({
      aesthetic_d: 'FourthStyle deltatrigger,',
      aesthetic_a: 'FirstStyle alphatrigger,',
      aesthetic_c: 'ThirdStyle gammatrigger,',
    })).toBe('FirstStyle alphatrigger, ThirdStyle gammatrigger, FourthStyle deltatrigger,')
  })

  it('puts the node-level aesthetic first, ahead of slot keys', () => {
    expect(composeLoraStyle({
      aesthetic: 'NodeLevel prose.',
      aesthetic_b: 'SecondStyle betatrigger,',
    })).toBe('NodeLevel prose. SecondStyle betatrigger,')
  })

  it('skips blank or whitespace-only values', () => {
    expect(composeLoraStyle({
      aesthetic: '   ',
      aesthetic_a: '',
      aesthetic_b: 'Kept betatrigger,',
      aesthetic_c: undefined,
      aesthetic_d: null,
    })).toBe('Kept betatrigger,')
  })

  it('trims each block and joins with a single space', () => {
    expect(composeLoraStyle({
      aesthetic: '  NodeLevel.  ',
      aesthetic_a: '  FirstStyle alphatrigger,  ',
    })).toBe('NodeLevel. FirstStyle alphatrigger,')
  })

  it('regression: two different slot styles both survive in the output', () => {
    const result = composeLoraStyle({
      aesthetic_a: 'Rare-token style A, xqzyplasm trigger,',
      aesthetic_b: 'Rare-token style B, vulqentine trigger,',
    })
    expect(result).toContain('xqzyplasm')
    expect(result).toContain('vulqentine')
  })
})
