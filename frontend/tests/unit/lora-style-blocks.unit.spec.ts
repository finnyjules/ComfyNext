import { describe, it, expect } from 'vitest'
import { slotAestheticKey, composeLoraStyle, loraSlotSiblings, loraSlotResetPlan } from '~/lib/graph/loraStyleBlocks'

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

describe('loraSlotSiblings', () => {
  it('maps lora_a..lora_d to their url/scale siblings', () => {
    expect(loraSlotSiblings('lora_a')).toEqual({ url: 'lora_a_url', scale: 'scale_a' })
    expect(loraSlotSiblings('lora_b')).toEqual({ url: 'lora_b_url', scale: 'scale_b' })
    expect(loraSlotSiblings('lora_c')).toEqual({ url: 'lora_c_url', scale: 'scale_c' })
    expect(loraSlotSiblings('lora_d')).toEqual({ url: 'lora_d_url', scale: 'scale_d' })
  })

  it('falls back to lora_url with no scale sibling for lora_name', () => {
    expect(loraSlotSiblings('lora_name')).toEqual({ url: 'lora_url', scale: null })
  })

  it('junk names fall back to lora_url, not a slot-shaped name', () => {
    expect(loraSlotSiblings('lora_e')).toEqual({ url: 'lora_url', scale: null })
    expect(loraSlotSiblings('scale_a')).toEqual({ url: 'lora_url', scale: null })
    expect(loraSlotSiblings('')).toEqual({ url: 'lora_url', scale: null })
  })
})

describe('loraSlotResetPlan', () => {
  it('maps each of the four slots to its picker/url/scale/aesthetic names', () => {
    expect(loraSlotResetPlan('lora_a')).toEqual({
      picker: 'lora_a', url: 'lora_a_url', scale: 'scale_a', aestheticKey: 'aesthetic_a',
    })
    expect(loraSlotResetPlan('lora_b')).toEqual({
      picker: 'lora_b', url: 'lora_b_url', scale: 'scale_b', aestheticKey: 'aesthetic_b',
    })
    expect(loraSlotResetPlan('lora_c')).toEqual({
      picker: 'lora_c', url: 'lora_c_url', scale: 'scale_c', aestheticKey: 'aesthetic_c',
    })
    expect(loraSlotResetPlan('lora_d')).toEqual({
      picker: 'lora_d', url: 'lora_d_url', scale: 'scale_d', aestheticKey: 'aesthetic_d',
    })
  })

  it('maps lora_name to lora_url/lora_scale with a null aesthetic key', () => {
    expect(loraSlotResetPlan('lora_name')).toEqual({
      picker: 'lora_name', url: 'lora_url', scale: 'lora_scale', aestheticKey: null,
    })
  })

  it('a junk name does not silently produce slot-shaped sibling names', () => {
    for (const junk of ['lora_e', 'scale_a', '']) {
      const plan = loraSlotResetPlan(junk)
      expect(plan.url).toBe('lora_url')
      expect(plan.scale).toBe('lora_scale')
      expect(plan.aestheticKey).toBeNull()
    }
  })
})
