import { describe, it, expect } from 'vitest'
import { assembleWorkflowLinks, healDanglingLinks, repairInvalidNodeIds, seedHasControlWidget, realignWidgetValues } from '../../app/composables/useFilteredPrompt'
import type { LiteGraphNode } from '../../app/composables/useVueNodes'

// Minimal node factory with one IMAGE input ("images", slot 0) and one IMAGE
// output (slot 0) — mirrors an artifact Image sink / generator.
function node(id: number): LiteGraphNode {
  return {
    id,
    type: 'Image',
    inputs: [{ name: 'images', type: 'IMAGE', link: null }],
    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: null }],
  } as unknown as LiteGraphNode
}

const edge = (source: number, target: number) => ({
  source: String(source),
  target: String(target),
  sourceHandle: 'output-0',
  targetHandle: 'input-0',
  data: { dataType: 'IMAGE' },
})

describe('assembleWorkflowLinks', () => {
  it('wires a valid edge on both endpoints', () => {
    const a = node(1)
    const b = node(2)
    const links = assembleWorkflowLinks([a, b], [edge(1, 2)])

    expect(links).toHaveLength(1)
    expect(links[0]).toEqual([1, 1, 0, 2, 0, 'IMAGE'])
    expect(a.outputs![0].links).toEqual([1])
    expect(b.inputs![0].link).toBe(1)
  })

  it('skips an edge whose SOURCE node is absent (orphaned edge)', () => {
    // Sink b survives; its generator (id 99) was deleted/replaced, leaving an
    // orphaned edge. Emitting a link here would reference a non-existent node:
    // ComfyUI's loader drops that link but b.inputs[0].link survives → dangling
    // → graphToPrompt throws "No link found in parent graph".
    const b = node(2)
    const links = assembleWorkflowLinks([b], [edge(99, 2)])

    expect(links).toHaveLength(0)
    expect(b.inputs![0].link).toBeNull()
  })

  it('skips an edge whose TARGET node is absent', () => {
    const a = node(1)
    const links = assembleWorkflowLinks([a], [edge(1, 99)])

    expect(links).toHaveLength(0)
    expect(a.outputs![0].links).toEqual([])
  })

  it('never emits a link referencing a node outside the serialized set', () => {
    const a = node(1)
    const b = node(2)
    // Mix of valid + two orphaned edges (missing source, missing target).
    const links = assembleWorkflowLinks([a, b], [edge(1, 2), edge(99, 2), edge(1, 88)])

    const ids = new Set([1, 2])
    for (const l of links) {
      expect(ids.has(Number(l[1]))).toBe(true) // origin exists
      expect(ids.has(Number(l[3]))).toBe(true) // target exists
    }
    expect(links).toHaveLength(1)
  })
})

describe('healDanglingLinks', () => {
  it('nulls an input.link absent from links[] and reports it', () => {
    const wf = {
      nodes: [
        { id: 7, type: 'Image', inputs: [{ name: 'images', type: 'IMAGE', link: 999 }], outputs: [] },
      ],
      links: [], // 999 is dangling
    }
    const report = healDanglingLinks(wf)

    expect(report).toEqual([
      { nodeId: 7, nodeType: 'Image', slot: 0, inputName: 'images', linkId: 999 },
    ])
    expect(wf.nodes[0].inputs[0].link).toBeNull()
  })

  it('leaves a consistent workflow untouched', () => {
    const wf = {
      nodes: [
        { id: 1, type: 'Gen', inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [5] }] },
        { id: 2, type: 'Image', inputs: [{ name: 'images', type: 'IMAGE', link: 5 }], outputs: [] },
      ],
      links: [[5, 1, 0, 2, 0, 'IMAGE']],
    }
    const report = healDanglingLinks(wf)

    expect(report).toHaveLength(0)
    expect(wf.nodes[1].inputs[0].link).toBe(5)
  })

  it('prunes stale ids from output.links', () => {
    const wf = {
      nodes: [{ id: 1, type: 'Gen', inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [5, 999] }] }],
      links: [[5, 1, 0, 2, 0, 'IMAGE']],
    }
    healDanglingLinks(wf)
    expect(wf.nodes[0].outputs[0].links).toEqual([5])
  })

  it('heals dangling links inside subgraph definitions too', () => {
    const wf = {
      nodes: [],
      links: [],
      definitions: [
        { nodes: [{ id: 3, type: 'Image', inputs: [{ name: 'images', type: 'IMAGE', link: 42 }], outputs: [] }], links: [] },
      ],
    }
    const report = healDanglingLinks(wf)
    expect(report).toHaveLength(1)
    expect(wf.definitions[0].nodes[0].inputs[0].link).toBeNull()
  })
})

describe('repairInvalidNodeIds', () => {
  it('reassigns a null id and remaps its links structurally (real-world fixture)', () => {
    // Mirrors the corrupted project: an EditImageNode saved with id:null, sitting
    // between a dog Image artifact and an output Image sink. Links 2 (in) and 3
    // (out) reference the null node by its null endpoint.
    const wf = {
      last_node_id: null,
      nodes: [
        { id: 1781041940865, type: 'GenerateImageNode', inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }] },
        { id: 1781042009752, type: 'Image', inputs: [{ name: 'images', type: 'IMAGE', link: 1 }], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [2] }] },
        { id: null, type: 'EditImageNode', inputs: [{ name: 'input_image', type: 'IMAGE', link: 2 }], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [3] }] },
        { id: 1781058163192, type: 'Image', inputs: [{ name: 'images', type: 'IMAGE', link: 3 }], outputs: [] },
      ],
      links: [
        [1, 1781041940865, 0, 1781042009752, 0, 'IMAGE'],
        [2, 1781042009752, 0, null, 0, 'IMAGE'],
        [3, null, 0, 1781058163192, 0, 'IMAGE'],
      ],
    }
    const report = repairInvalidNodeIds(wf)

    expect(report).toHaveLength(1)
    expect(report[0].oldId).toBeNull()
    expect(report[0].type).toBe('EditImageNode')
    const newId = report[0].newId
    expect(Number.isFinite(newId)).toBe(true)
    expect(wf.nodes[2].id).toBe(newId)
    // link 2 target and link 3 origin now point at the repaired node
    expect(wf.links[1][3]).toBe(newId)
    expect(wf.links[2][1]).toBe(newId)
    // last_node_id is a real number again, no null endpoints remain
    expect(Number.isFinite(wf.last_node_id as any)).toBe(true)
    for (const l of wf.links) {
      expect(l[1]).not.toBeNull()
      expect(l[3]).not.toBeNull()
    }
  })

  it('treats numeric-string ids as valid and leaves a clean workflow untouched', () => {
    const wf = {
      last_node_id: 2,
      nodes: [
        { id: '1', type: 'A', inputs: [], outputs: [] },
        { id: 2, type: 'B', inputs: [], outputs: [] },
      ],
      links: [],
    }
    expect(repairInvalidNodeIds(wf)).toHaveLength(0)
    expect(wf.nodes.map(n => n.id)).toEqual(['1', 2])
  })

  it('repairs a non-numeric string id ("null") and avoids colliding with existing ids', () => {
    const wf = {
      nodes: [
        { id: 5, type: 'A', inputs: [], outputs: [] },
        { id: 'null', type: 'B', inputs: [], outputs: [] },
      ],
      links: [],
    }
    const report = repairInvalidNodeIds(wf)
    expect(report).toHaveLength(1)
    expect(report[0].newId).toBe(6) // max(5)+1
    expect(wf.nodes[1].id).toBe(6)
  })
})

describe('seedHasControlWidget', () => {
  it('adds the control slot for an explicit flag (GenerateImageNode case)', () => {
    expect(seedHasControlWidget('seed', 'INT', { control_after_generate: true })).toBe(true)
  })

  it('adds the control slot for a seed-named INT with NO flag (EditImageNode case)', () => {
    // The exact bug: flag unset → fall back to name → still needs the slot, or
    // safety_tolerance shifts to 0 (< min 1) and ComfyUI drops the node.
    expect(seedHasControlWidget('seed', 'INT', {})).toBe(true)
    expect(seedHasControlWidget('noise_seed', 'INT', { min: 0 })).toBe(true)
  })

  it('respects an explicit control_after_generate:false even for a seed name', () => {
    expect(seedHasControlWidget('seed', 'INT', { control_after_generate: false })).toBe(false)
  })

  it('does not add the slot for non-seed INTs or non-INT types', () => {
    expect(seedHasControlWidget('safety_tolerance', 'INT', {})).toBe(false)
    expect(seedHasControlWidget('seed', 'STRING', {})).toBe(false)
    expect(seedHasControlWidget('steps', 'INT', { min: 1 })).toBe(false)
  })
})

describe('realignWidgetValues — legacy seed-control migration', () => {
  // EditImageNode schema: model, input_image (port), prompt, aspect_ratio,
  // seed (name-only → control slot), safety_tolerance (min 1), prompt_upsampling,
  // output_format. input_image is forceInput so it's not a widget value.
  const editInfo = {
    EditImageNode: {
      input: {
        required: {
          model: [['Flux Kontext Pro', 'Nano Banana'], {}],
          input_image: ['IMAGE', { forceInput: true }],
          prompt: ['STRING', {}],
          aspect_ratio: [['match_input_image', '1:1'], {}],
          seed: ['INT', { default: 0, min: 0 }],
          safety_tolerance: ['INT', { default: 2, min: 1, max: 6 }],
          prompt_upsampling: ['BOOLEAN', { default: false }],
          output_format: [['png', 'jpg'], {}],
        },
      },
    },
  }

  it('interleaves the missing control slot so safety_tolerance keeps its value', () => {
    // Legacy 7-value array (no control slot) — exactly what corrupted the run.
    const wf = {
      nodes: [{
        type: 'EditImageNode',
        widgets_values: ['Flux Kontext Pro', 'add a black cat next to the dog',
          'match_input_image', 1359004626, 2, false, 'png'],
      }],
    }
    const out = realignWidgetValues(wf as any, editInfo as any)
    const wv = out.nodes[0].widgets_values as any[]
    // model, prompt, aspect_ratio, seed, seed_control, safety_tolerance, prompt_upsampling, output_format
    expect(wv).toEqual(['Flux Kontext Pro', 'add a black cat next to the dog',
      'match_input_image', 1359004626, 'randomize', 2, false, 'png'])
    // The whole point: safety_tolerance lands 2 (>= min 1), not the shifted false→0.
    expect(wv[5]).toBe(2)
  })

  it('leaves an already-aligned 8-value array untouched', () => {
    const aligned = ['Flux Kontext Pro', 'p', 'match_input_image', 7, 'fixed', 3, true, 'png']
    const wf = { nodes: [{ type: 'EditImageNode', widgets_values: [...aligned] }] }
    const out = realignWidgetValues(wf as any, editInfo as any)
    expect(out.nodes[0].widgets_values).toEqual(aligned)
  })
})
