import { describe, it, expect } from 'vitest'
import { graphToPrompt } from '~/lib/graph/graphToPrompt'
import { UnknownNodeTypeError } from '~/lib/graph/widgetOrder'
import type { LiteGraphWorkflow } from '~/composables/useVueNodes'

// object_info fixture for a minimal CheckpointLoader -> KSampler -> SaveImage
// chain, matching the shapes ComfyUI's real /object_info returns closely
// enough to exercise widgetSlots().
const OBJECT_INFO = {
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: [['model_a.safetensors', 'model_b.safetensors'], {}],
      },
    },
  },
  KSampler: {
    input: {
      required: {
        model: ['MODEL', {}],
        positive: ['CONDITIONING', {}],
        negative: ['CONDITIONING', {}],
        latent_image: ['LATENT', {}],
        seed: ['INT', { control_after_generate: true }],
        steps: ['INT', {}],
        cfg: ['FLOAT', {}],
        sampler_name: [['euler', 'dpmpp_2m'], {}],
      },
    },
  },
  SaveImage: {
    input: {
      required: {
        images: ['IMAGE', {}],
        filename_prefix: ['STRING', {}],
      },
    },
  },
  // Used only for the converted-widget-override test below.
  IntInputNode: {
    input: {
      required: {
        value: ['INT', {}],
      },
    },
  },
}

function baseWorkflow(overrides: Partial<LiteGraphWorkflow> = {}): LiteGraphWorkflow {
  return {
    last_node_id: 3,
    last_link_id: 4,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
    ...overrides,
  } as LiteGraphWorkflow
}

describe('graphToPrompt', () => {
  it('builds an exact API prompt for a CheckpointLoader -> KSampler -> SaveImage chain', () => {
    const workflow = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: 'CheckpointLoaderSimple',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['model_a.safetensors'],
          outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
        },
        {
          id: 2,
          type: 'KSampler',
          pos: [200, 0],
          size: [200, 100],
          // Positional order per widgetSlots: seed, seed__control, steps, cfg, sampler_name
          widgets_values: [12345, 'randomize', 20, 7.5, 'euler'],
          inputs: [
            { name: 'model', type: 'MODEL', link: 1 },
            { name: 'positive', type: 'CONDITIONING', link: null },
            { name: 'negative', type: 'CONDITIONING', link: null },
            { name: 'latent_image', type: 'LATENT', link: null },
          ],
          outputs: [{ name: 'LATENT', type: 'LATENT', links: [2] }],
        },
        {
          id: 3,
          type: 'SaveImage',
          pos: [400, 0],
          size: [200, 100],
          widgets_values: ['ComfyUI'],
          inputs: [
            { name: 'images', type: 'IMAGE', link: 2 },
          ],
        },
      ],
      links: [
        [1, 1, 0, 2, 0, 'MODEL'],
        [2, 2, 0, 3, 0, 'IMAGE'],
      ],
    })

    const prompt = graphToPrompt(workflow, OBJECT_INFO)

    expect(prompt).toEqual({
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'model_a.safetensors',
        },
      },
      '2': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          seed: 12345,
          steps: 20,
          cfg: 7.5,
          sampler_name: 'euler',
        },
      },
      '3': {
        class_type: 'SaveImage',
        inputs: {
          images: ['2', 0],
          filename_prefix: 'ComfyUI',
        },
      },
    })
  })

  it('sorts output keys numerically regardless of node insertion order', () => {
    const workflow = baseWorkflow({
      nodes: [
        {
          id: 10,
          type: 'CheckpointLoaderSimple',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['model_a.safetensors'],
        },
        {
          id: 2,
          type: 'CheckpointLoaderSimple',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['model_b.safetensors'],
        },
      ],
      links: [],
    })

    const prompt = graphToPrompt(workflow, OBJECT_INFO)
    expect(Object.keys(prompt)).toEqual(['2', '10'])
  })

  it('lets a converted-widget connection override the positional widget value', () => {
    const workflow = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: 'IntInputNode',
          pos: [0, 0],
          size: [200, 100],
          outputs: [{ name: 'INT', type: 'INT', links: [1] }],
        },
        {
          id: 2,
          type: 'KSampler',
          pos: [200, 0],
          size: [200, 100],
          // steps was converted to an input, but its stale positional value
          // (99) is still sitting in widgets_values — the connection must
          // win over it regardless.
          widgets_values: [12345, 'randomize', 99, 7.5, 'euler'],
          inputs: [
            { name: 'model', type: 'MODEL', link: null },
            { name: 'positive', type: 'CONDITIONING', link: null },
            { name: 'negative', type: 'CONDITIONING', link: null },
            { name: 'latent_image', type: 'LATENT', link: null },
            { name: 'steps', type: 'INT', link: 1 },
          ],
        },
      ],
      links: [
        [1, 1, 0, 2, 0, 'INT'],
      ],
    })

    const prompt = graphToPrompt(workflow, OBJECT_INFO)

    expect(prompt['2'].inputs.steps).toEqual(['1', 0])
    expect(prompt['2'].inputs).toEqual({
      seed: 12345,
      steps: ['1', 0],
      cfg: 7.5,
      sampler_name: 'euler',
    })
  })

  it('skips Note and MarkdownNote UI-only nodes', () => {
    const workflow = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: 'Note',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['just a comment'],
        },
        {
          id: 2,
          type: 'MarkdownNote',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['# heading'],
        },
        {
          id: 3,
          type: 'CheckpointLoaderSimple',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['model_a.safetensors'],
        },
      ],
      links: [],
    })

    const prompt = graphToPrompt(workflow, OBJECT_INFO)
    expect(Object.keys(prompt)).toEqual(['3'])
  })

  it('skips a node whose type is missing from object_info and has no outputs used', () => {
    const workflow = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: 'SomeFrontendOnlyNode',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: [],
        },
        {
          id: 2,
          type: 'CheckpointLoaderSimple',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['model_a.safetensors'],
        },
      ],
      links: [],
    })

    const prompt = graphToPrompt(workflow, OBJECT_INFO)
    expect(Object.keys(prompt)).toEqual(['2'])
  })

  it('throws UnknownNodeTypeError for an unknown node type whose outputs are used', () => {
    const workflow = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: 'SomeFrontendOnlyNode',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: [],
          outputs: [{ name: 'OUT', type: 'OUT', links: [1] }],
        },
        {
          id: 2,
          type: 'SaveImage',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['ComfyUI'],
          inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
        },
      ],
      links: [
        [1, 1, 0, 2, 0, 'IMAGE'],
      ],
    })

    expect(() => graphToPrompt(workflow, OBJECT_INFO)).toThrow(UnknownNodeTypeError)
  })
})
