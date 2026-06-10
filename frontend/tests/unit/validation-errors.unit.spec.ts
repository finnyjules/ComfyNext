import { describe, it, expect } from 'vitest'
import { summarizeNodeErrors } from '../../app/lib/validationErrors'

// Shape mirrors ComfyUI's /prompt HTTP 400 body: node_errors is a map of
// node id → { errors: [{ type, message, details, extra_info }], class_type, dependent_outputs }.
const typeMismatch = {
  '2': {
    errors: [
      {
        type: 'return_type_mismatch',
        message: 'Return type mismatch between linked nodes',
        details: 'video, received_type(IMAGE) mismatch input_type(VIDEO)',
        extra_info: { input_name: 'video' },
      },
    ],
    dependent_outputs: ['2'],
    class_type: 'SaveVideo',
  },
}

describe('summarizeNodeErrors', () => {
  it('single node, single error → one labeled line and a perNode entry', () => {
    const { description, perNode } = summarizeNodeErrors(typeMismatch)
    expect(description).toBe(
      'SaveVideo: Return type mismatch between linked nodes — video, received_type(IMAGE) mismatch input_type(VIDEO)'
    )
    expect(perNode).toEqual({
      '2': 'Return type mismatch between linked nodes — video, received_type(IMAGE) mismatch input_type(VIDEO)',
    })
  })

  it('multi-node with multiple errors per node → first error per node, one line each', () => {
    const input = {
      '3': {
        errors: [
          { type: 'required_input_missing', message: 'Required input is missing', details: 'images' },
          { type: 'required_input_missing', message: 'Required input is missing', details: 'masks' },
        ],
        dependent_outputs: ['9'],
        class_type: 'SaveImage',
      },
      '7': {
        errors: [{ type: 'value_not_in_list', message: 'Value not in list', details: "ckpt_name: 'gone.safetensors'" }],
        dependent_outputs: ['9'],
        class_type: 'CheckpointLoaderSimple',
      },
    }
    const { description, perNode } = summarizeNodeErrors(input)
    expect(description.split('\n')).toEqual([
      'SaveImage: Required input is missing — images',
      "CheckpointLoaderSimple: Value not in list — ckpt_name: 'gone.safetensors'",
    ])
    expect(perNode['3']).toBe('Required input is missing — images')
    expect(perNode['7']).toBe("Value not in list — ckpt_name: 'gone.safetensors'")
  })

  it('more than 3 nodes → 3 lines plus "…and N more", but perNode keeps every node', () => {
    const entry = (cls: string) => ({
      errors: [{ type: 'required_input_missing', message: 'Required input is missing', details: '' }],
      dependent_outputs: [],
      class_type: cls,
    })
    const input = { '1': entry('A'), '2': entry('B'), '3': entry('C'), '4': entry('D'), '5': entry('E') }
    const { description, perNode } = summarizeNodeErrors(input)
    const lines = description.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('A: Required input is missing')
    expect(lines[3]).toBe('…and 2 more')
    expect(Object.keys(perNode)).toHaveLength(5)
  })

  it('node entry without class_type falls back to the node id label', () => {
    const input = { '12': { errors: [{ message: 'Bad input' }] } }
    const { description } = summarizeNodeErrors(input)
    expect(description).toBe('Node 12: Bad input')
  })

  it('node entry with empty/malformed errors array → generic per-node fallback', () => {
    const input = {
      '4': { errors: [], class_type: 'KSampler' },
      '5': { errors: 'nope', class_type: 'VAEDecode' },
    }
    const { description, perNode } = summarizeNodeErrors(input as any)
    expect(description.split('\n')).toEqual(['KSampler: Validation failed', 'VAEDecode: Validation failed'])
    expect(perNode['4']).toBe('Validation failed')
    expect(perNode['5']).toBe('Validation failed')
  })

  it('empty map → empty description and perNode (caller falls back to generic toast)', () => {
    expect(summarizeNodeErrors({})).toEqual({ description: '', perNode: {} })
  })

  it('malformed input (null, undefined, string, array) → safe empty fallback, no throw', () => {
    for (const bad of [null, undefined, 'oops', 42, ['x']]) {
      expect(summarizeNodeErrors(bad)).toEqual({ description: '', perNode: {} })
    }
  })
})
