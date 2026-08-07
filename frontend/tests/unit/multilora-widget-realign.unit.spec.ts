import { describe, it, expect } from 'vitest'
import { realignWidgetValues } from '~/composables/useFilteredPrompt'

/**
 * FluxMultiLoRARemoteNode grew from 2 LoRA slots (A/B) to 4 (A/B/C/D).
 * widgets_values is POSITIONAL — realignWidgetValues pads a saved array by
 * length, not by name — so where the six new C/D inputs land in the schema
 * decides whether a workflow saved before the expansion still loads correctly.
 *
 * The fix keeps lora_c/lora_c_url/scale_c/lora_d/lora_d_url/scale_d LAST,
 * after every input that existed before (see the comment above them in
 * nodes_replicate.py's FluxMultiLoRARemoteNode.define_schema). This test
 * documents that contract: an old 13-value array must realign onto the new
 * 19-value schema with every pre-existing value landing on its own widget,
 * not on some other widget's slot six positions down.
 */

const LORA_OPTIONS = ['char.safetensors', 'style.safetensors', '[None]']
const ASPECT_RATIOS = ['1:1', '16:9', '9:16']

// objectInfo for FluxMultiLoRARemoteNode reflecting the FIXED schema order:
// C/D declared LAST, after prompt_strength — never inserted mid-schema.
const FIXED_OBJECT_INFO = {
  FluxMultiLoRARemoteNode: {
    input: {
      required: {
        prompt: ['STRING', { multiline: true, default: '' }],
        lora_a: [LORA_OPTIONS, { default: '[None]' }],
        lora_a_url: ['STRING', { default: '' }],
        scale_a: ['FLOAT', { default: 0.9, min: 0, max: 1.5 }],
        lora_b: [LORA_OPTIONS, { default: '[None]' }],
        lora_b_url: ['STRING', { default: '' }],
        scale_b: ['FLOAT', { default: 0.8, min: 0, max: 1.5 }],
        aspect_ratio: [ASPECT_RATIOS, { default: '1:1' }],
        num_inference_steps: ['INT', { default: 28, min: 4, max: 50 }],
        guidance: ['FLOAT', { default: 3.5, min: 0, max: 10 }],
        seed: ['INT', { default: 0, min: 0 }],
        prompt_strength: ['FLOAT', { default: 0.8, min: 0, max: 1 }],
        // ── C/D must stay last — see nodes_replicate.py for why ──
        lora_c: [LORA_OPTIONS, { default: '[None]' }],
        lora_c_url: ['STRING', { default: '' }],
        scale_c: ['FLOAT', { default: 0.7, min: 0, max: 1.5 }],
        lora_d: [LORA_OPTIONS, { default: '[None]' }],
        lora_d_url: ['STRING', { default: '' }],
        scale_d: ['FLOAT', { default: 0.6, min: 0, max: 1.5 }],
      },
      optional: {
        image: ['IMAGE', { forceInput: true }],
      },
    },
  },
}

// The order realignWidgetValues will produce for the schema above — including
// the auto-added seed_control slot — stated once so the test can look up each
// widget's landing spot BY NAME instead of hardcoding indices.
const EXPECTED_ORDER = [
  'prompt',
  'lora_a', 'lora_a_url', 'scale_a',
  'lora_b', 'lora_b_url', 'scale_b',
  'aspect_ratio', 'num_inference_steps', 'guidance',
  'seed', 'seed_control',
  'prompt_strength',
  'lora_c', 'lora_c_url', 'scale_c',
  'lora_d', 'lora_d_url', 'scale_d',
]

// A workflow saved before the 2→4 slot expansion: 13 values in the OLD
// (2-slot) order — prompt, lora_a, lora_a_url, scale_a, lora_b, lora_b_url,
// scale_b, aspect_ratio, num_inference_steps, guidance, seed, seed_control,
// prompt_strength.
const OLD_WIDGETS_VALUES = [
  'a photo', 'char.safetensors', '', 0.9, 'style.safetensors', '', 0.8,
  '16:9', 28, 3.5, 4242, 'randomize', 0.8,
]

describe('realignWidgetValues — FluxMultiLoRARemoteNode 2→4 slot migration', () => {
  it('preserves every pre-existing saved value when C/D land after prompt_strength', () => {
    const wf = {
      nodes: [{ type: 'FluxMultiLoRARemoteNode', widgets_values: [...OLD_WIDGETS_VALUES] }],
    }
    const out = realignWidgetValues(wf as any, FIXED_OBJECT_INFO as any)
    const wv = out.nodes[0].widgets_values as any[]
    const at = (name: string) => {
      const i = EXPECTED_ORDER.indexOf(name)
      expect(i).toBeGreaterThanOrEqual(0)
      return wv[i]
    }

    expect(at('prompt')).toBe('a photo')
    expect(at('lora_a')).toBe('char.safetensors')
    expect(at('scale_a')).toBe(0.9)
    expect(at('lora_b')).toBe('style.safetensors')
    expect(at('scale_b')).toBe(0.8)
    expect(at('aspect_ratio')).toBe('16:9')
    expect(at('num_inference_steps')).toBe(28)
    expect(at('guidance')).toBe(3.5)
    expect(at('seed')).toBe(4242)
    expect(at('seed_control')).toBe('randomize')
    expect(at('prompt_strength')).toBe(0.8)

    // New slots land on their own defaults — never on a stray saved value.
    expect(at('lora_c')).toBe('[None]')
    expect(at('lora_c_url')).toBe('')
    expect(at('scale_c')).toBe(0.7)
    expect(at('lora_d')).toBe('[None]')
    expect(at('lora_d_url')).toBe('')
    expect(at('scale_d')).toBe(0.6)
  })
})

/**
 * Same technique for GenerateImageNode's B2 expansion (moodboards Plan B):
 * style_block + style_refs are appended LAST as OPTIONAL inputs, so an old
 * 6-value widgets_values array (model, prompt, aspect_ratio, seed,
 * seed_control, model_options) must realign onto the new 8-slot schema with
 * every pre-existing value staying on its own widget and the two new slots
 * landing on their '' defaults.
 */
const GENERATE_OBJECT_INFO = {
  GenerateImageNode: {
    input: {
      required: {
        model: [['flux-schnell', 'nano-banana-pro'], { default: 'flux-schnell' }],
        prompt: ['STRING', { multiline: true, default: '' }],
        aspect_ratio: [ASPECT_RATIOS, { default: '1:1' }],
        seed: ['INT', { default: 0, min: 0, control_after_generate: true }],
        model_options: ['STRING', { default: '{}' }],
      },
      optional: {
        // ── B2 style inputs must stay last — see nodes_replicate.py ──
        style_block: ['STRING', { multiline: true, default: '' }],
        style_refs: ['STRING', { default: '' }],
      },
    },
  },
}

const GENERATE_EXPECTED_ORDER = [
  'model', 'prompt', 'aspect_ratio',
  'seed', 'seed_control',
  'model_options',
  'style_block', 'style_refs',
]

// A workflow saved before B2: 6 values in the old order.
const OLD_GENERATE_WIDGETS_VALUES = [
  'nano-banana-pro', 'a lighthouse at dusk', '16:9', 777, 'randomize', '{"resolution":"2K"}',
]

describe('realignWidgetValues — GenerateImageNode style_block/style_refs expansion', () => {
  it('preserves every pre-existing saved value when the style inputs land last', () => {
    const wf = {
      nodes: [{ type: 'GenerateImageNode', widgets_values: [...OLD_GENERATE_WIDGETS_VALUES] }],
    }
    const out = realignWidgetValues(wf as any, GENERATE_OBJECT_INFO as any)
    const wv = out.nodes[0].widgets_values as any[]
    const at = (name: string) => {
      const i = GENERATE_EXPECTED_ORDER.indexOf(name)
      expect(i).toBeGreaterThanOrEqual(0)
      return wv[i]
    }

    expect(wv).toHaveLength(GENERATE_EXPECTED_ORDER.length)
    expect(at('model')).toBe('nano-banana-pro')
    expect(at('prompt')).toBe('a lighthouse at dusk')
    expect(at('aspect_ratio')).toBe('16:9')
    expect(at('seed')).toBe(777)
    expect(at('seed_control')).toBe('randomize')
    expect(at('model_options')).toBe('{"resolution":"2K"}')

    // The new slots land on their '' defaults — never on a stray saved value.
    expect(at('style_block')).toBe('')
    expect(at('style_refs')).toBe('')
  })
})
