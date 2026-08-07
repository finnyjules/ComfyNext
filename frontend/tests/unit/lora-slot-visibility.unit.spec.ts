import { describe, it, expect } from 'vitest'
import { isLoraSlotWidgetVisible, slotFilled } from '~/lib/graph/loraSlotVisibility'

/**
 * FluxMultiLoRARemoteNode has four slots but must look like a two-slot node at
 * rest. Slot N appears once every earlier slot is filled — or when N itself
 * already holds a value, so a workflow saved with C set but B cleared doesn't
 * hide a value that will still be submitted.
 */
const DEFS = [
  { name: 'prompt' },
  { name: 'lora_a' }, { name: 'lora_a_url' }, { name: 'scale_a' },
  { name: 'lora_b' }, { name: 'lora_b_url' }, { name: 'scale_b' },
  { name: 'lora_c' }, { name: 'lora_c_url' }, { name: 'scale_c' },
  { name: 'lora_d' }, { name: 'lora_d_url' }, { name: 'scale_d' },
]

// Values are positional, matching DEFS.
function values(over: Record<string, any> = {}) {
  return DEFS.map(d => {
    if (d.name in over) return over[d.name]
    if (d.name === 'prompt') return ''
    if (d.name.startsWith('scale_')) return 0.8
    if (d.name.endsWith('_url')) return ''
    return '[None]'
  })
}
const vis = (n: string, v: any[]) => isLoraSlotWidgetVisible(n, v, DEFS)

describe('isLoraSlotWidgetVisible', () => {
  it('leaves non-slot widgets alone', () => {
    expect(vis('prompt', values())).toBe(true)
    expect(vis('aspect_ratio', values())).toBe(true)
  })

  it('always shows slots A and B', () => {
    for (const n of ['lora_a', 'lora_a_url', 'scale_a', 'lora_b', 'lora_b_url', 'scale_b']) {
      expect(vis(n, values())).toBe(true)
    }
  })

  it('hides C and D on a fresh node', () => {
    for (const n of ['lora_c', 'lora_c_url', 'scale_c', 'lora_d', 'lora_d_url', 'scale_d']) {
      expect(vis(n, values())).toBe(false)
    }
  })

  it('reveals C once A and B are both filled', () => {
    const v = values({ lora_a: 'char.safetensors', lora_b: 'style.safetensors' })
    expect(vis('lora_c', v)).toBe(true)
    expect(vis('scale_c', v)).toBe(true)
    expect(vis('lora_c_url', v)).toBe(true)
    expect(vis('lora_d', v)).toBe(false)
  })

  it('does not reveal C when only A is filled', () => {
    expect(vis('lora_c', values({ lora_a: 'char.safetensors' }))).toBe(false)
  })

  it('counts a url override as filling its slot', () => {
    const v = values({ lora_a: 'char.safetensors', lora_b_url: 'huggingface.co/x/y' })
    expect(vis('lora_c', v)).toBe(true)
  })

  it('shows a slot that already holds a value even if an earlier one is empty', () => {
    // A workflow saved with C set, then B cleared. Hiding C would strand a
    // value that still gets submitted.
    const v = values({ lora_c: 'accent.safetensors' })
    expect(vis('lora_c', v)).toBe(true)
    expect(vis('scale_c', v)).toBe(true)
  })

  it('treats [None] and blanks as empty', () => {
    expect(vis('lora_c', values({ lora_a: '[None]', lora_b: '   ' }))).toBe(false)
  })

  it('reveals D only when A, B and C are all filled', () => {
    const abc = values({ lora_a: 'a.safetensors', lora_b: 'b.safetensors', lora_c: 'c.safetensors' })
    expect(vis('lora_d', abc)).toBe(true)
    const ab = values({ lora_a: 'a.safetensors', lora_b: 'b.safetensors' })
    expect(vis('lora_d', ab)).toBe(false)
  })

  it('reveals C when only B is filled (A empty)', () => {
    // The bug fix: a style-only user fills B and must be able to see C.
    const v = values({ lora_b: 'style.safetensors' })
    expect(vis('lora_c', v)).toBe(true)
    expect(vis('scale_c', v)).toBe(true)
  })

  it('allows a full B → C → D walk without touching A', () => {
    // Style-only user: fill B, assert C visible and D hidden.
    let v = values({ lora_b: 'style.safetensors' })
    expect(vis('lora_c', v)).toBe(true)
    expect(vis('lora_d', v)).toBe(false)
    // Fill C, assert D visible.
    v = values({ lora_b: 'style.safetensors', lora_c: 'accent.safetensors' })
    expect(vis('lora_d', v)).toBe(true)
  })

  it('hides D when only B is filled (C empty)', () => {
    // Proves the rule is "immediately preceding slot", not "any earlier slot".
    const v = values({ lora_b: 'style.safetensors' })
    expect(vis('lora_d', v)).toBe(false)
  })
})

describe('moodboard-held slots (weightless fill)', () => {
  // A moodboard pick leaves the picker at '[None]' and the url blank — the only
  // trace is properties.sailor_moodboard_<letter>. That must still count as
  // "filled" or picking a moodboard into B never reveals C.
  it('slotFilled counts a moodboard property as filling the slot', () => {
    expect(slotFilled('b', values(), DEFS, { sailor_moodboard_b: 'pastel-miami' })).toBe(true)
  })

  it('broken control: empty/absent properties leave the slot empty', () => {
    expect(slotFilled('b', values(), DEFS, {})).toBe(false)
    expect(slotFilled('b', values(), DEFS)).toBe(false)
  })

  it('blank or non-string moodboard ids do not fill', () => {
    expect(slotFilled('b', values(), DEFS, { sailor_moodboard_b: '   ' })).toBe(false)
    expect(slotFilled('b', values(), DEFS, { sailor_moodboard_b: 42 })).toBe(false)
  })

  it('reveals C when B holds only a moodboard', () => {
    expect(isLoraSlotWidgetVisible('lora_c', values(), DEFS, { sailor_moodboard_b: 'pastel-miami' })).toBe(true)
    expect(isLoraSlotWidgetVisible('scale_c', values(), DEFS, { sailor_moodboard_b: 'pastel-miami' })).toBe(true)
    // Broken control: same widgets, no moodboard property → still hidden.
    expect(isLoraSlotWidgetVisible('lora_c', values(), DEFS, {})).toBe(false)
  })
})
