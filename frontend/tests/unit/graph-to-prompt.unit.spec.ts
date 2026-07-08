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
  // Used for mute/bypass tests: single IMAGE in, IMAGE out, no widgets.
  ImageEnhanceNode: {
    input: {
      required: {
        image: ['IMAGE', {}],
      },
    },
  },
  // Used for the bypass-no-matching-input test: takes a MASK, not IMAGE.
  MaskOnlyNode: {
    input: {
      required: {
        mask: ['MASK', {}],
      },
    },
  },
  // Used as the real upstream IMAGE source in bypass-passthrough tests.
  LoadImageNode: {
    input: {
      required: {
        image: [['photo.png'], {}],
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

  describe('mute + bypass', () => {
    it('(a) omits a consumer input fed by a muted upstream node', () => {
      const workflow = baseWorkflow({
        nodes: [
          {
            id: 1,
            type: 'CheckpointLoaderSimple',
            pos: [0, 0],
            size: [200, 100],
            mode: 2, // muted
            widgets_values: ['model_a.safetensors'],
            outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
          },
          {
            id: 2,
            type: 'KSampler',
            pos: [200, 0],
            size: [200, 100],
            widgets_values: [12345, 'randomize', 20, 7.5, 'euler'],
            inputs: [
              { name: 'model', type: 'MODEL', link: 1 },
              { name: 'positive', type: 'CONDITIONING', link: null },
              { name: 'negative', type: 'CONDITIONING', link: null },
              { name: 'latent_image', type: 'LATENT', link: null },
            ],
          },
        ],
        links: [
          [1, 1, 0, 2, 0, 'MODEL'],
        ],
      })

      const prompt = graphToPrompt(workflow, OBJECT_INFO)

      // Muted node itself is excluded from the prompt entirely.
      expect(Object.keys(prompt)).toEqual(['2'])
      // The `model` input fed by the muted node is simply omitted (not null).
      expect(prompt['2'].inputs).toEqual({
        seed: 12345,
        steps: 20,
        cfg: 7.5,
        sampler_name: 'euler',
      })
    })

    it('(b) re-routes a single bypassed node so IMAGE passes through', () => {
      const workflow = baseWorkflow({
        nodes: [
          {
            id: 99,
            type: 'LoadImageNode',
            pos: [-200, 0],
            size: [200, 100],
            widgets_values: ['photo.png'],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [10] }],
          },
          {
            id: 1,
            type: 'ImageEnhanceNode',
            pos: [0, 0],
            size: [200, 100],
            mode: 4, // bypassed
            inputs: [
              { name: 'image', type: 'IMAGE', link: 10 },
            ],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          },
          {
            id: 2,
            type: 'SaveImage',
            pos: [200, 0],
            size: [200, 100],
            widgets_values: ['ComfyUI'],
            inputs: [
              { name: 'images', type: 'IMAGE', link: 1 },
            ],
          },
        ],
        links: [
          [10, 99, 0, 1, 0, 'IMAGE'], // upstream source feeding the bypassed node's input
          [1, 1, 0, 2, 0, 'IMAGE'],
        ],
      })

      const prompt = graphToPrompt(workflow, OBJECT_INFO)

      expect(Object.keys(prompt)).toEqual(['2', '99'])
      expect(prompt['2'].inputs.images).toEqual(['99', 0])
    })

    it('(c) resolves a chained double bypass transitively', () => {
      const workflow = baseWorkflow({
        nodes: [
          {
            id: 99,
            type: 'LoadImageNode',
            pos: [-200, 0],
            size: [200, 100],
            widgets_values: ['photo.png'],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [20] }],
          },
          {
            id: 1,
            type: 'ImageEnhanceNode',
            pos: [0, 0],
            size: [200, 100],
            mode: 4, // bypassed
            inputs: [
              { name: 'image', type: 'IMAGE', link: 20 },
            ],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [10] }],
          },
          {
            id: 2,
            type: 'ImageEnhanceNode',
            pos: [200, 0],
            size: [200, 100],
            mode: 4, // bypassed
            inputs: [
              { name: 'image', type: 'IMAGE', link: 10 },
            ],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          },
          {
            id: 3,
            type: 'SaveImage',
            pos: [400, 0],
            size: [200, 100],
            widgets_values: ['ComfyUI'],
            inputs: [
              { name: 'images', type: 'IMAGE', link: 1 },
            ],
          },
        ],
        links: [
          [20, 99, 0, 1, 0, 'IMAGE'], // original source feeding node 1
          [10, 1, 0, 2, 0, 'IMAGE'],  // node 1 -> node 2 (both bypassed)
          [1, 2, 0, 3, 0, 'IMAGE'],   // node 2 -> SaveImage
        ],
      })

      const prompt = graphToPrompt(workflow, OBJECT_INFO)

      expect(Object.keys(prompt)).toEqual(['3', '99'])
      expect(prompt['3'].inputs.images).toEqual(['99', 0])
    })

    it('(d) treats a bypass with no matching input type as mute for that consumer', () => {
      const workflow = baseWorkflow({
        nodes: [
          {
            id: 1,
            type: 'MaskOnlyNode',
            pos: [0, 0],
            size: [200, 100],
            mode: 4, // bypassed, but only has a MASK input — no IMAGE input to reroute to
            inputs: [
              { name: 'mask', type: 'MASK', link: null },
            ],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          },
          {
            id: 2,
            type: 'SaveImage',
            pos: [200, 0],
            size: [200, 100],
            widgets_values: ['ComfyUI'],
            inputs: [
              { name: 'images', type: 'IMAGE', link: 1 },
            ],
          },
        ],
        links: [
          [1, 1, 0, 2, 0, 'IMAGE'],
        ],
      })

      const prompt = graphToPrompt(workflow, OBJECT_INFO)

      expect(Object.keys(prompt)).toEqual(['2'])
      expect(prompt['2'].inputs).toEqual({
        filename_prefix: 'ComfyUI',
      })
    })

    it('(e) does not hang on a bypass cycle, and treats it as mute for the consumer', () => {
      const workflow = baseWorkflow({
        nodes: [
          {
            id: 1,
            type: 'ImageEnhanceNode',
            pos: [0, 0],
            size: [200, 100],
            mode: 4, // bypassed, forms a cycle with node 2
            inputs: [
              { name: 'image', type: 'IMAGE', link: 2 },
            ],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          },
          {
            id: 2,
            type: 'ImageEnhanceNode',
            pos: [200, 0],
            size: [200, 100],
            mode: 4, // bypassed, forms a cycle with node 1
            inputs: [
              { name: 'image', type: 'IMAGE', link: 1 },
            ],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [2] }],
          },
          {
            id: 3,
            type: 'SaveImage',
            pos: [400, 0],
            size: [200, 100],
            widgets_values: ['ComfyUI'],
            inputs: [
              { name: 'images', type: 'IMAGE', link: 1 },
            ],
          },
        ],
        links: [
          [1, 1, 0, 2, 0, 'IMAGE'],
          [2, 2, 0, 1, 0, 'IMAGE'],
        ],
      })

      const prompt = graphToPrompt(workflow, OBJECT_INFO)

      expect(Object.keys(prompt)).toEqual(['3'])
      expect(prompt['3'].inputs).toEqual({
        filename_prefix: 'ComfyUI',
      })
    })
  })
})
