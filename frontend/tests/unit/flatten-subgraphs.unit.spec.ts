import { describe, it, expect } from 'vitest'
import { flattenSubgraphs, SubgraphDepthError } from '~/lib/graph/flattenSubgraphs'
import { graphToPrompt } from '~/lib/graph/graphToPrompt'
import type { LiteGraphWorkflow } from '~/composables/useVueNodes'

// object_info fixture: LoadImage -> Sharpen(subgraph) -> SaveImage, where the
// subgraph's interior is a single GLSLShader-ish "Sharpen" node reading a
// PrimitiveFloat "strength" widget, matching the real shape captured from
// blueprints/Sharpen.json (verified against production export, not upstream
// ComfyUI docs).
const OBJECT_INFO = {
  LoadImageNode: {
    input: { required: { image: [['photo.png'], {}] } },
  },
  SaveImage: {
    input: { required: { images: ['IMAGE', {}], filename_prefix: ['STRING', {}] } },
  },
  PrimitiveFloat: {
    input: { required: { value: ['FLOAT', {}] } },
  },
  GLSLShader: {
    input: {
      required: {
        'images.image0': ['IMAGE', {}],
        'floats.u_float0': ['FLOAT', {}],
      },
    },
  },
  // Used for the nested-subgraph fixture.
  DoubleNode: {
    input: { required: { image: ['IMAGE', {}] } },
  },
}

function baseWorkflow(overrides: Partial<LiteGraphWorkflow> = {}): LiteGraphWorkflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
    ...overrides,
  } as LiteGraphWorkflow
}

// Real shape from blueprints/Sharpen.json: sg.links is an array of LINK
// OBJECTS (not tuples) — { id, origin_id, origin_slot, target_id, target_slot, type }.
// sg.inputs / sg.outputs are objects with { name, type, linkIds: number[] }.
// The synthetic boundary nodes use ids -10 (inputNode) / -20 (outputNode).
const SHARPEN_SUBGRAPH_ID = '621ba4e2-22a8-482d-a369-023753198b7b'

function sharpenDefinition() {
  return {
    id: SHARPEN_SUBGRAPH_ID,
    version: 1,
    state: { lastNodeId: 24, lastLinkId: 36 },
    name: 'Sharpen',
    inputNode: { id: -10, bounding: [4090, -825, 120, 60] },
    outputNode: { id: -20, bounding: [5150, -825, 120, 60] },
    inputs: [
      { id: 'in-1', name: 'images.image0', type: 'IMAGE', linkIds: [34], label: 'image' },
    ],
    outputs: [
      { id: 'out-1', name: 'IMAGE0', type: 'IMAGE', linkIds: [35], label: 'IMAGE' },
    ],
    nodes: [
      {
        id: 24,
        type: 'PrimitiveFloat',
        pos: [4280, -1240],
        size: [270, 58],
        mode: 0,
        inputs: [],
        outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [36] }],
        widgets_values: [0.5],
      },
      {
        id: 23,
        type: 'GLSLShader',
        pos: [4570, -1240],
        size: [370, 192],
        mode: 0,
        inputs: [
          { name: 'images.image0', type: 'IMAGE', link: 34 },
          { name: 'floats.u_float0', type: 'FLOAT', link: 36 },
        ],
        outputs: [{ name: 'IMAGE0', type: 'IMAGE', links: [35] }],
        widgets_values: [],
      },
    ],
    groups: [],
    links: [
      { id: 36, origin_id: 24, origin_slot: 0, target_id: 23, target_slot: 1, type: 'FLOAT' },
      { id: 34, origin_id: -10, origin_slot: 0, target_id: 23, target_slot: 0, type: 'IMAGE' },
      { id: 35, origin_id: 23, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
    ],
    extra: {},
  }
}

function sharpenInstanceNode(id: number, inputLink: number | null, outputLinks: number[]) {
  return {
    id,
    type: SHARPEN_SUBGRAPH_ID,
    pos: [4610, -790],
    size: [230, 58],
    mode: 0,
    inputs: [
      { label: 'image', name: 'images.image0', type: 'IMAGE', link: inputLink },
    ],
    outputs: [
      { label: 'IMAGE', name: 'IMAGE0', type: 'IMAGE', links: outputLinks },
    ],
    title: 'Sharpen',
    properties: {},
    widgets_values: [],
  }
}

describe('flattenSubgraphs', () => {
  it('inlines a single-level subgraph instance to equal the hand-inlined prompt', () => {
    const workflow = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: 'LoadImageNode',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['photo.png'],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [100] }],
        },
        sharpenInstanceNode(2, 100, [101]),
        {
          id: 3,
          type: 'SaveImage',
          pos: [400, 0],
          size: [200, 100],
          widgets_values: ['ComfyUI'],
          inputs: [{ name: 'images', type: 'IMAGE', link: 101 }],
        },
      ],
      links: [
        [100, 1, 0, 2, 0, 'IMAGE'],
        [101, 2, 0, 3, 0, 'IMAGE'],
      ],
      ...( { definitions: { subgraphs: [sharpenDefinition()] } } as any ),
    })

    const flattened = flattenSubgraphs(workflow)
    const prompt = graphToPrompt(flattened, OBJECT_INFO)

    // Hand-inlined equivalent: LoadImageNode(1) -> GLSLShader -> SaveImage(3),
    // with PrimitiveFloat(24) feeding GLSLShader's u_float0, remapped under
    // instance id 2 via `Number('2' + String(innerId).padStart(4, '0'))`.
    const glslId = Number(`2${String(23).padStart(4, '0')}`)
    const floatId = Number(`2${String(24).padStart(4, '0')}`)

    const handInlined = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: 'LoadImageNode',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['photo.png'],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [100] }],
        },
        {
          id: floatId,
          type: 'PrimitiveFloat',
          pos: [0, 0],
          size: [0, 0],
          mode: 0,
          inputs: [],
          outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [] }],
          widgets_values: [0.5],
        },
        {
          id: glslId,
          type: 'GLSLShader',
          pos: [0, 0],
          size: [0, 0],
          mode: 0,
          inputs: [
            { name: 'images.image0', type: 'IMAGE', link: 100 },
            { name: 'floats.u_float0', type: 'FLOAT', link: 999 },
          ],
          outputs: [{ name: 'IMAGE0', type: 'IMAGE', links: [101] }],
          widgets_values: [],
        },
        {
          id: 3,
          type: 'SaveImage',
          pos: [400, 0],
          size: [200, 100],
          widgets_values: ['ComfyUI'],
          inputs: [{ name: 'images', type: 'IMAGE', link: 101 }],
        },
      ],
      links: [
        [100, 1, 0, glslId, 0, 'IMAGE'],
        [999, floatId, 0, glslId, 1, 'FLOAT'],
        [101, glslId, 0, 3, 0, 'IMAGE'],
      ],
    })
    const expectedPrompt = graphToPrompt(handInlined, OBJECT_INFO)

    expect(prompt).toEqual(expectedPrompt)
    // Sanity: the flattened prompt has no trace of the subgraph-instance type.
    expect(Object.values(prompt).some((n) => n.class_type === SHARPEN_SUBGRAPH_ID)).toBe(false)
    expect(prompt['3'].inputs.images).toEqual([String(glslId), 0])
  })

  it('routes a widget-backed boundary input via properties.proxyWidgets (real shape from blueprints/Sharpen.json)', () => {
    // Same Sharpen definition, but this time the outer instance has NO
    // incoming connection on its "image" boundary input; instead the
    // boundary input itself is exposed as a widget on the instance via
    // proxyWidgets target '-1' (matched by name against the boundary
    // input's own name), with a literal value sitting in widgets_values.
    // This mirrors the exact shape found in
    // "blueprints/Text to Image (Z-Image-Turbo).json" (`proxyWidgets:
    // [["-1","text"], ...]`), just applied to Sharpen's single IMAGE input
    // for a minimal fixture.
    const instance = sharpenInstanceNode(2, null, [101])
    instance.properties = { proxyWidgets: [['-1', 'images.image0']] }
    instance.widgets_values = ['literal-image-value']

    const workflow = baseWorkflow({
      nodes: [
        instance,
        {
          id: 3,
          type: 'SaveImage',
          pos: [400, 0],
          size: [200, 100],
          widgets_values: ['ComfyUI'],
          inputs: [{ name: 'images', type: 'IMAGE', link: 101 }],
        },
      ],
      links: [
        [101, 2, 0, 3, 0, 'IMAGE'],
      ],
      ...( { definitions: { subgraphs: [sharpenDefinition()] } } as any ),
    })

    const flattened = flattenSubgraphs(workflow)
    const prompt = graphToPrompt(flattened, OBJECT_INFO)

    const glslId = Number(`2${String(23).padStart(4, '0')}`)
    // The GLSLShader's images.image0 input resolves to the literal value
    // directly (no node reference at all — there's no real upstream node).
    expect(prompt[String(glslId)].inputs['images.image0']).toBe('literal-image-value')
    expect(prompt['3'].inputs.images).toEqual([String(glslId), 0])
  })

  it('recursively flattens a nested subgraph (subgraph containing a subgraph instance)', () => {
    const INNER_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
    const OUTER_ID = 'bbbbbbbb-0000-4000-8000-000000000002'

    // Inner definition: one DoubleNode reading its own boundary input, writing
    // its own boundary output (same shape conventions as sharpenDefinition()).
    const innerDef = {
      id: INNER_ID,
      name: 'Inner',
      inputNode: { id: -10, bounding: [0, 0, 10, 10] },
      outputNode: { id: -20, bounding: [0, 0, 10, 10] },
      inputs: [{ id: 'i1', name: 'image', type: 'IMAGE', linkIds: [1] }],
      outputs: [{ id: 'o1', name: 'image', type: 'IMAGE', linkIds: [2] }],
      nodes: [
        {
          id: 5,
          type: 'DoubleNode',
          pos: [0, 0],
          size: [0, 0],
          mode: 0,
          inputs: [{ name: 'image', type: 'IMAGE', link: 1 }],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [2] }],
          widgets_values: [],
        },
      ],
      links: [
        { id: 1, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'IMAGE' },
        { id: 2, origin_id: 5, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
      ],
    }

    // Outer definition: contains ONE interior node whose type is the inner
    // subgraph's id (i.e. a nested subgraph instance living inside another
    // subgraph definition) — mirrors the real "Depth to Image" blueprint
    // where a subgraph instance appears inside `sg.nodes`.
    const outerDef = {
      id: OUTER_ID,
      name: 'Outer',
      inputNode: { id: -10, bounding: [0, 0, 10, 10] },
      outputNode: { id: -20, bounding: [0, 0, 10, 10] },
      inputs: [{ id: 'i2', name: 'image', type: 'IMAGE', linkIds: [10] }],
      outputs: [{ id: 'o2', name: 'image', type: 'IMAGE', linkIds: [11] }],
      nodes: [
        {
          id: 7,
          type: INNER_ID,
          pos: [0, 0],
          size: [0, 0],
          mode: 0,
          inputs: [{ name: 'image', type: 'IMAGE', link: 10 }],
          outputs: [{ name: 'image', type: 'IMAGE', links: [11] }],
          widgets_values: [],
        },
      ],
      links: [
        { id: 10, origin_id: -10, origin_slot: 0, target_id: 7, target_slot: 0, type: 'IMAGE' },
        { id: 11, origin_id: 7, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
      ],
    }

    const workflow = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: 'LoadImageNode',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['photo.png'],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [100] }],
        },
        {
          id: 2,
          type: OUTER_ID,
          pos: [200, 0],
          size: [200, 100],
          mode: 0,
          inputs: [{ name: 'image', type: 'IMAGE', link: 100 }],
          outputs: [{ name: 'image', type: 'IMAGE', links: [101] }],
          widgets_values: [],
        },
        {
          id: 3,
          type: 'SaveImage',
          pos: [400, 0],
          size: [200, 100],
          widgets_values: ['ComfyUI'],
          inputs: [{ name: 'images', type: 'IMAGE', link: 101 }],
        },
      ],
      links: [
        [100, 1, 0, 2, 0, 'IMAGE'],
        [101, 2, 0, 3, 0, 'IMAGE'],
      ],
      ...( { definitions: { subgraphs: [innerDef, outerDef] } } as any ),
    })

    const flattened = flattenSubgraphs(workflow)

    // No subgraph types should remain anywhere in the flattened node list.
    const remainingTypes = flattened.nodes.map((n) => n.type)
    expect(remainingTypes).not.toContain(OUTER_ID)
    expect(remainingTypes).not.toContain(INNER_ID)
    expect(remainingTypes.filter((t) => t === 'DoubleNode')).toHaveLength(1)

    const prompt = graphToPrompt(flattened, OBJECT_INFO)
    expect(Object.keys(prompt)).toHaveLength(3) // LoadImageNode, DoubleNode, SaveImage
    const doubleEntry = Object.entries(prompt).find(([, n]) => n.class_type === 'DoubleNode')
    expect(doubleEntry).toBeTruthy()
    const [doubleId] = doubleEntry as [string, any]
    expect(prompt[doubleId].inputs.image).toEqual(['1', 0])
    expect(prompt['3'].inputs.images).toEqual([doubleId, 0])
  })

  it('throws a typed error when subgraph nesting exceeds the depth guard (cycle protection)', () => {
    // Two subgraph definitions that reference each other, which would
    // otherwise recurse forever.
    const A_ID = 'aaaaaaaa-1111-4000-8000-000000000001'
    const B_ID = 'bbbbbbbb-1111-4000-8000-000000000002'

    const defA = {
      id: A_ID,
      name: 'A',
      inputNode: { id: -10, bounding: [0, 0, 10, 10] },
      outputNode: { id: -20, bounding: [0, 0, 10, 10] },
      inputs: [{ id: 'i1', name: 'image', type: 'IMAGE', linkIds: [1] }],
      outputs: [{ id: 'o1', name: 'image', type: 'IMAGE', linkIds: [2] }],
      nodes: [
        {
          id: 1,
          type: B_ID,
          pos: [0, 0],
          size: [0, 0],
          mode: 0,
          inputs: [{ name: 'image', type: 'IMAGE', link: 1 }],
          outputs: [{ name: 'image', type: 'IMAGE', links: [2] }],
          widgets_values: [],
        },
      ],
      links: [
        { id: 1, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'IMAGE' },
        { id: 2, origin_id: 1, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
      ],
    }
    const defB = {
      id: B_ID,
      name: 'B',
      inputNode: { id: -10, bounding: [0, 0, 10, 10] },
      outputNode: { id: -20, bounding: [0, 0, 10, 10] },
      inputs: [{ id: 'i1', name: 'image', type: 'IMAGE', linkIds: [1] }],
      outputs: [{ id: 'o1', name: 'image', type: 'IMAGE', linkIds: [2] }],
      nodes: [
        {
          id: 1,
          type: A_ID,
          pos: [0, 0],
          size: [0, 0],
          mode: 0,
          inputs: [{ name: 'image', type: 'IMAGE', link: 1 }],
          outputs: [{ name: 'image', type: 'IMAGE', links: [2] }],
          widgets_values: [],
        },
      ],
      links: [
        { id: 1, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'IMAGE' },
        { id: 2, origin_id: 1, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
      ],
    }

    const workflow = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: A_ID,
          pos: [0, 0],
          size: [200, 100],
          mode: 0,
          inputs: [{ name: 'image', type: 'IMAGE', link: null }],
          outputs: [{ name: 'image', type: 'IMAGE', links: [] }],
          widgets_values: [],
        },
      ],
      links: [],
      ...( { definitions: { subgraphs: [defA, defB] } } as any ),
    })

    expect(() => flattenSubgraphs(workflow)).toThrow(SubgraphDepthError)
  })

  it('is a no-op pass-through when the workflow has no subgraph definitions', () => {
    const workflow = baseWorkflow({
      nodes: [
        {
          id: 1,
          type: 'SaveImage',
          pos: [0, 0],
          size: [200, 100],
          widgets_values: ['ComfyUI'],
        },
      ],
      links: [],
    })
    const flattened = flattenSubgraphs(workflow)
    expect(flattened).toEqual(workflow)
  })
})
