import { describe, expect, it } from 'vitest'
import { useVueNodes } from '~/composables/useVueNodes'

// Saved workflows freeze each node's port snapshot at creation time. When the
// backend later APPENDS ports to a node type (GenerateImageNode grew style_in/
// prompt_in sockets, Moodboard grew its TASTE output), old saves must pick the
// new ports up on rehydration — the VueNodeCanvas objectInfo watch only fires
// when objectInfo CHANGES, so a project opened after objectInfo settled (the
// normal open-from-projects-list path) relies entirely on this conversion-time
// sync. Bug found live: Julien's pre-wire Generate node had no style_in plug.

const OBJECT_INFO = {
  GenerateImageNode: {
    input: {
      required: {
        model: ['COMBO', { options: ['nano-banana-pro'] }],
        prompt: ['STRING', { multiline: true }],
      },
      optional: {
        style_block: ['STRING', { multiline: true }],
        style_in: ['TASTE', { tooltip: 'Taste wire' }],
        prompt_in: ['STRING', { forceInput: true }],
      },
    },
    output: ['IMAGE'],
    output_name: ['image'],
  },
  Moodboard: {
    input: { required: {}, optional: {} },
    output: ['TASTE'],
    output_name: ['style'],
  },
}

function workflow(nodes: any[]) {
  return {
    last_node_id: Math.max(1, ...nodes.map(n => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  } as any
}

describe('rehydration appends schema-grown ports to saved nodes', () => {
  it('a pre-wire GenerateImageNode gains the style_in and prompt_in sockets', () => {
    const vn = useVueNodes()
    vn.objectInfo.value = OBJECT_INFO
    vn.convertFromLiteGraph(workflow([{
      id: 1,
      type: 'GenerateImageNode',
      pos: [0, 0],
      size: [280, 400],
      inputs: [], // saved before the taste-wire sockets existed
      outputs: [{ name: 'image', type: 'IMAGE', links: null }],
      widgets_values: ['nano-banana-pro', 'a sleeping dog'],
      properties: {},
      mode: 0,
    }]))

    const inputs = (vn.nodes.value as any[])[0].data.inputs
    expect(inputs.map((i: any) => i.name)).toEqual(['style_in', 'prompt_in'])
    expect(inputs[0].type).toBe('TASTE')
    // widget-backed schema entries (model/prompt/style_block) must NOT leak in
    expect(inputs.map((i: any) => i.name)).not.toContain('prompt')
  })

  it('a pre-wire Moodboard node gains the TASTE style output', () => {
    const vn = useVueNodes()
    vn.objectInfo.value = OBJECT_INFO
    vn.convertFromLiteGraph(workflow([{
      id: 1,
      type: 'Moodboard',
      pos: [0, 0],
      size: [220, 120],
      inputs: [],
      outputs: [], // saved before the output port existed
      widgets_values: [],
      properties: { sailor_moodboard: 'editorial-illustration' },
      mode: 0,
    }]))

    const outputs = (vn.nodes.value as any[])[0].data.outputs
    expect(outputs).toEqual([{ name: 'style', type: 'TASTE', links: null }])
  })

  it('saved link state and indices survive the append (never reorder)', () => {
    const vn = useVueNodes()
    vn.objectInfo.value = OBJECT_INFO
    vn.convertFromLiteGraph(workflow([{
      id: 1,
      type: 'GenerateImageNode',
      pos: [0, 0],
      size: [280, 400],
      inputs: [{ name: 'style_in', type: 'TASTE', link: 7 }], // already wired
      outputs: [{ name: 'image', type: 'IMAGE', links: [3] }],
      widgets_values: [],
      properties: {},
      mode: 0,
    }]))

    const inputs = (vn.nodes.value as any[])[0].data.inputs
    expect(inputs[0]).toEqual({ name: 'style_in', type: 'TASTE', link: 7 })
    expect(inputs.map((i: any) => i.name)).toEqual(['style_in', 'prompt_in'])
  })
})
