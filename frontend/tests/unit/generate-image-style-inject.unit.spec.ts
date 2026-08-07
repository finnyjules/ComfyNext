import { describe, it, expect } from 'vitest'
import { injectLoraStyleIntoPrompt } from '~/lib/graph/styleInject'

/**
 * GenerateImageNode style injection (moodboards Plan B, Task B2).
 *
 * The node's `prompt` widget is NOT at index 0 — the model picker is — so the
 * submit-time injector must resolve its target (`style_block`) BY NAME from
 * the objectInfo widget order, never by hardcoded position. This fixture is
 * the broken control for that rule: prompt sits at index 1 and model at 0, so
 * a positional-index-0 implementation (the FLUX nodes' fold) would clobber
 * the model id and leave style_block empty — both asserted against below.
 */

// Mirrors the REAL /object_info shape for GenerateImageNode: model combo first,
// prompt second, seed with a control slot, model_options internal, and the two
// B2 style inputs appended LAST as optional.
const OBJECT_INFO = {
  GenerateImageNode: {
    input: {
      required: {
        model: [['flux-schnell', 'nano-banana-pro'], { default: 'flux-schnell' }],
        prompt: ['STRING', { multiline: true, default: '' }],
        aspect_ratio: [['1:1', '16:9'], { default: '1:1' }],
        seed: ['INT', { default: 0, min: 0, control_after_generate: true }],
        model_options: ['STRING', { default: '{}' }],
      },
      optional: {
        style_block: ['STRING', { multiline: true, default: '' }],
        style_refs: ['STRING', { default: '' }],
      },
    },
  },
  FluxLoRARemoteNode: {
    input: {
      required: {
        prompt: ['STRING', { multiline: true, default: '' }],
        lora_name: [['x.safetensors', '[None]'], { default: '[None]' }],
      },
    },
  },
}

// Positional widget order for the schema above:
// 0 model · 1 prompt · 2 aspect_ratio · 3 seed · 4 seed__control ·
// 5 model_options · 6 style_block · 7 style_refs
const STYLE_BLOCK_INDEX = 6
const STYLE_REFS_INDEX = 7

function generateNode(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    type: 'GenerateImageNode',
    widgets_values: ['flux-schnell', 'a cat', '1:1', 42, 'randomize', '{}', '', ''],
    properties: { aesthetic: 'In the style of: soft riso grain.' },
    ...overrides,
  }
}

describe('injectLoraStyleIntoPrompt — GenerateImageNode (by widget NAME)', () => {
  it('writes the composed block into the style_block slot, resolved by name', () => {
    const wf = { nodes: [generateNode()] }
    injectLoraStyleIntoPrompt(wf, OBJECT_INFO)
    const wv = wf.nodes[0].widgets_values
    expect(wv[STYLE_BLOCK_INDEX]).toBe('In the style of: soft riso grain.')
    // The prompt itself is untouched — the Python node does the prepend.
    expect(wv[1]).toBe('a cat')
  })

  it('never touches index 0 (the model id) — a positional implementation fails here', () => {
    const wf = { nodes: [generateNode()] }
    injectLoraStyleIntoPrompt(wf, OBJECT_INFO)
    // Prompt is at index 1 in this schema: an implementation that reuses the
    // FLUX nodes' index-0 fold would have overwritten the model id.
    expect(wf.nodes[0].widgets_values[0]).toBe('flux-schnell')
  })

  it('composes node properties via composeLoraStyle (aesthetic + slot keys)', () => {
    const wf = {
      nodes: [generateNode({
        properties: { aesthetic: 'Block one.', aesthetic_b: 'Block two.' },
      })],
    }
    injectLoraStyleIntoPrompt(wf, OBJECT_INFO)
    expect(wf.nodes[0].widgets_values[STYLE_BLOCK_INDEX]).toBe('Block one. Block two.')
  })

  it('leaves the node alone when there is no composed style', () => {
    const wf = { nodes: [generateNode({ properties: {} })] }
    const before = [...wf.nodes[0].widgets_values]
    injectLoraStyleIntoPrompt(wf, OBJECT_INFO)
    expect(wf.nodes[0].widgets_values).toEqual(before)
  })

  it('pads a short (pre-B2) widgets_values array up to the style_block slot', () => {
    const wf = {
      nodes: [generateNode({
        // Saved before style_block/style_refs existed: 6 values.
        widgets_values: ['flux-schnell', 'a cat', '1:1', 42, 'randomize', '{}'],
      })],
    }
    injectLoraStyleIntoPrompt(wf, OBJECT_INFO)
    const wv = wf.nodes[0].widgets_values
    expect(wv[STYLE_BLOCK_INDEX]).toBe('In the style of: soft riso grain.')
    expect(wv[0]).toBe('flux-schnell')
    expect(wv[1]).toBe('a cat')
  })

  it('skips (without corrupting anything) when the schema lacks style_block — stale backend', () => {
    const staleInfo = {
      GenerateImageNode: {
        input: {
          required: (OBJECT_INFO.GenerateImageNode.input.required as any),
          // no optional section — the pre-B2 schema
        },
      },
    }
    const wf = { nodes: [generateNode()] }
    const before = [...wf.nodes[0].widgets_values]
    injectLoraStyleIntoPrompt(wf, staleInfo)
    expect(wf.nodes[0].widgets_values).toEqual(before)
  })

  it('writes properties.style_refs into the style_refs slot, by name (Task B3)', () => {
    const refsJson = '{"folder":"moodboard_1754000000000","files":["00_a.png","01_b.jpg"]}'
    const wf = {
      nodes: [generateNode({
        properties: {
          aesthetic: 'In the style of: soft riso grain.',
          style_refs: refsJson,
        },
      })],
    }
    injectLoraStyleIntoPrompt(wf, OBJECT_INFO)
    const wv = wf.nodes[0].widgets_values
    expect(wv[STYLE_REFS_INDEX]).toBe(refsJson)
    expect(wv[STYLE_BLOCK_INDEX]).toBe('In the style of: soft riso grain.')
    expect(wv[0]).toBe('flux-schnell') // model untouched
  })

  it('injects refs even when there is no style block, and skips empty refs', () => {
    const refsJson = '{"folder":"moodboard_1","files":["a.png"]}'
    const withRefsOnly = { nodes: [generateNode({ properties: { style_refs: refsJson } })] }
    injectLoraStyleIntoPrompt(withRefsOnly, OBJECT_INFO)
    expect(withRefsOnly.nodes[0].widgets_values[STYLE_REFS_INDEX]).toBe(refsJson)
    expect(withRefsOnly.nodes[0].widgets_values[STYLE_BLOCK_INDEX]).toBe('')

    // '' is the tag-gated "no refs" write — never injected.
    const withEmptyRefs = {
      nodes: [generateNode({ properties: { aesthetic: 'Block.', style_refs: '' } })],
    }
    injectLoraStyleIntoPrompt(withEmptyRefs, OBJECT_INFO)
    expect(withEmptyRefs.nodes[0].widgets_values[STYLE_REFS_INDEX]).toBe('')
  })

  it('stale backend (no style_refs input) — refs are skipped without corruption', () => {
    const staleInfo = {
      GenerateImageNode: {
        input: { required: (OBJECT_INFO.GenerateImageNode.input.required as any) },
      },
    }
    const wf = {
      nodes: [generateNode({
        properties: { style_refs: '{"folder":"moodboard_1","files":["a.png"]}' },
      })],
    }
    const before = [...wf.nodes[0].widgets_values]
    injectLoraStyleIntoPrompt(wf, staleInfo)
    expect(wf.nodes[0].widgets_values).toEqual(before)
  })

  it('keeps the FLUX nodes on their existing index-0 prompt fold', () => {
    const wf = {
      nodes: [{
        id: 2,
        type: 'FluxLoRARemoteNode',
        widgets_values: ['a dog', 'x.safetensors'],
        properties: { aesthetic: 'In the style of: gouache.' },
      }],
    }
    injectLoraStyleIntoPrompt(wf, OBJECT_INFO)
    expect(wf.nodes[0].widgets_values[0]).toBe('In the style of: gouache. a dog')
    expect(wf.nodes[0].widgets_values[1]).toBe('x.safetensors')
  })
})
