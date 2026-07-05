import { describe, it, expect } from 'vitest'
import {
  assembleWorkflowLinks,
  realignWidgetValues,
  applyArtifactLocks,
  backfillStandaloneArtifactImages,
  applyVariantFanOut,
} from '~/composables/useFilteredPrompt'
import { ensureVarsInput } from '~/lib/collection/varsInput'
import { VARS_TYPE } from '~/lib/collection/types'

// ---------------------------------------------------------------------------
// Repro harness for task_9cf65748: a VARS edge (Collection → Smart Layout /
// studio) reportedly lost across restart/reload.
//
// We drive the ACTUAL exported persistence functions. The two closure-bound
// converters (convertToLiteGraph / convertFromLiteGraph) depend on Nuxt/Vue
// refs, so we replicate ONLY their trivial, verbatim edge<->link mapping (the
// exact tuple shapes are asserted below against the source) and call the real
// link builder / restore normalizer / getWorkflow transforms.
// ---------------------------------------------------------------------------

type Edge = {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
  type: string
  data?: { dataType?: string }
}

/** A minimal Collection node (frontend-only, output slot 0 = vars). */
function collectionNode(id: number) {
  return {
    id,
    type: 'Collection',
    pos: [0, 0] as [number, number],
    size: [220, 120] as [number, number],
    title: 'Collection',
    inputs: [],
    outputs: [{ name: 'vars', type: VARS_TYPE, links: [] as number[] }],
    widgets_values: [],
    properties: {},
    mode: 0,
  }
}

/** A Smart Layout target node that has already been given its `vars` input. */
function smartLayoutNode(id: number) {
  const n = {
    id,
    type: 'SmartLayout',
    pos: [400, 0] as [number, number],
    size: [320, 200] as [number, number],
    title: 'Smart Layout',
    // Simulate a real node's data.inputs: a couple of normal inputs + vars.
    inputs: [
      { name: 'image', type: 'IMAGE', link: null },
    ] as any[],
    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] as number[] }],
    widgets_values: [],
    properties: {},
    mode: 0,
  }
  // vars input added by the same helper the real app uses on create/load.
  ensureVarsInput({ data: { nodeType: 'SmartLayout', inputs: n.inputs } })
  return n
}

/** The VARS edge, exactly as convertFromLiteGraph would produce it. */
function varsEdge(sourceId: number, targetId: number, targetSlot: number): Edge {
  return {
    id: 'e-vars',
    source: String(sourceId),
    sourceHandle: 'output-0',
    target: String(targetId),
    targetHandle: `input-${targetSlot}`,
    type: 'comfy',
    data: { dataType: VARS_TYPE },
  }
}

/** Verbatim replica of convertFromLiteGraph's link->edge map (useVueNodes.ts). */
function linkToEdge(linkArr: any[]): Edge {
  return {
    id: `e-${linkArr[0]}`,
    source: String(linkArr[1]),
    sourceHandle: `output-${linkArr[2]}`,
    target: String(linkArr[3]),
    targetHandle: `input-${linkArr[4]}`,
    type: 'comfy',
    data: { dataType: String(linkArr[5]) },
  }
}

/** Convert lg nodes (save shape) back into the loaded-node data shape and run
 *  ensureVarsInput, mirroring convertFromLiteGraph's normalization pass. */
function restoreNodes(lgNodes: any[]) {
  const loaded = lgNodes.map((lg) => ({
    id: lg.id,
    data: { nodeType: lg.type, inputs: lg.inputs || [], outputs: lg.outputs || [] },
  }))
  for (const n of loaded) ensureVarsInput(n)
  return loaded
}

function findVarsEdge(edges: Edge[]) {
  return edges.find((e) => e.data?.dataType === VARS_TYPE)
}

describe('VARS edge persistence (Collection -> Smart Layout)', () => {
  const varsSlot = 1 // after the single IMAGE input

  it('assembleWorkflowLinks emits the VARS link with type VARS and correct slots', () => {
    const col = collectionNode(1)
    const sl = smartLayoutNode(2)
    const edges = [varsEdge(1, 2, varsSlot)]

    const links = assembleWorkflowLinks([col, sl], edges)
    const varsLink = links.find((l) => String(l[5]).toUpperCase() === 'VARS')
    expect(varsLink, 'a VARS link should be emitted').toBeTruthy()
    // [linkId, source, originSlot, target, targetSlot, type]
    expect(varsLink![1]).toBe(1)
    expect(varsLink![2]).toBe(0)
    expect(varsLink![3]).toBe(2)
    expect(varsLink![4]).toBe(varsSlot)
    expect(varsLink![5]).toBe('VARS')
  })

  it('survives a full save -> restore round-trip', () => {
    const col = collectionNode(1)
    const sl = smartLayoutNode(2)
    const edges = [varsEdge(1, 2, varsSlot)]

    // SAVE
    const links = assembleWorkflowLinks([col, sl], edges)

    // RESTORE (link -> edge + ensureVarsInput on nodes)
    const restoredEdges = links.map(linkToEdge)
    const restoredNodes = restoreNodes([col, sl])

    const ve = findVarsEdge(restoredEdges)
    expect(ve, 'VARS edge should survive round-trip').toBeTruthy()
    expect(ve!.source).toBe('1')
    expect(ve!.target).toBe('2')
    expect(ve!.targetHandle).toBe(`input-${varsSlot}`)

    // The restored target must still expose the vars input at the same index
    // the edge points to, or Vue Flow would prune the edge.
    const target = restoredNodes.find((n) => n.id === 2)!
    expect(target.data.inputs[varsSlot]?.name).toBe('vars')
  })

  it('the getWorkflow transform chain keeps the VARS link', () => {
    const col = collectionNode(1)
    const sl = smartLayoutNode(2)
    const edges = [varsEdge(1, 2, varsSlot)]
    const links = assembleWorkflowLinks([col, sl], edges)

    const workflow: any = {
      last_node_id: 2,
      last_link_id: links.length,
      nodes: [col, sl],
      links,
      groups: [],
      config: {},
      extra: {},
      version: 0.4,
    }

    // Minimal objectInfo — SmartLayout schema present, Collection absent
    // (it is frontend-only, has no backend class_type).
    const objectInfo: Record<string, any> = {
      SmartLayout: { input: { required: {}, optional: {} } },
    }
    // liveNodes as the real getWorkflow passes them (nodes.value). No node is
    // locked, so applyArtifactLocks is a no-op.
    const liveNodes = [
      { id: 1, data: { nodeType: 'Collection', properties: {} } },
      { id: 2, data: { nodeType: 'SmartLayout', properties: {} } },
    ]

    const hasVars = (wf: any) =>
      (wf.links || []).some((l: any[]) => String(l[5]).toUpperCase() === 'VARS')

    const aligned = realignWidgetValues(workflow, objectInfo)
    expect(hasVars(aligned), 'realignWidgetValues dropped VARS').toBe(true)

    const unlocked = applyArtifactLocks(aligned, liveNodes)
    expect(hasVars(unlocked), 'applyArtifactLocks dropped VARS').toBe(true)

    const backfilled = backfillStandaloneArtifactImages(unlocked, liveNodes, objectInfo)
    expect(hasVars(backfilled), 'backfillStandaloneArtifactImages dropped VARS').toBe(true)

    const withFanOut = applyVariantFanOut(backfilled, objectInfo)
    expect(hasVars(withFanOut), 'applyVariantFanOut dropped VARS').toBe(true)

    // And a full restore off the final transformed workflow still yields the edge.
    const restoredEdges = (withFanOut.links || []).map(linkToEdge)
    expect(findVarsEdge(restoredEdges), 'VARS edge lost after full pipeline').toBeTruthy()
  })

  it('regression: fan-out that batches sibling IMAGE sinks must not disturb a VARS wire', () => {
    // Reproduce a realistic multi-edge graph: a generator feeding two Image
    // sinks (triggers fan-out) PLUS the Collection -> SmartLayout VARS wire.
    const col = collectionNode(1)
    const sl = smartLayoutNode(2)
    const gen = {
      id: 3, type: 'FluxGenerate', pos: [0, 300] as [number, number],
      size: [220, 120] as [number, number], title: 'Gen',
      inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] as number[] }],
      widgets_values: [], properties: {}, mode: 0,
    }
    const img1 = {
      id: 4, type: 'Image', pos: [400, 250] as [number, number],
      size: [220, 120] as [number, number], title: 'Image',
      inputs: [{ name: 'images', type: 'IMAGE', link: null }],
      outputs: [], widgets_values: [], properties: {}, mode: 0,
    }
    const img2 = { ...img1, id: 5, inputs: [{ name: 'images', type: 'IMAGE', link: null }] }

    const edges: Edge[] = [
      varsEdge(1, 2, varsSlot),
      { id: 'e1', source: '3', sourceHandle: 'output-0', target: '4', targetHandle: 'input-0', type: 'comfy', data: { dataType: 'IMAGE' } },
      { id: 'e2', source: '3', sourceHandle: 'output-0', target: '5', targetHandle: 'input-0', type: 'comfy', data: { dataType: 'IMAGE' } },
    ]

    const links = assembleWorkflowLinks([col, sl, gen, img1, img2], edges)
    const workflow: any = {
      last_node_id: 5, last_link_id: links.length,
      nodes: [col, sl, gen, img1, img2], links,
      groups: [], config: {}, extra: {}, version: 0.4,
    }
    const objectInfo: Record<string, any> = {
      SmartLayout: { input: { required: {}, optional: {} } },
      FluxGenerate: { input: { required: { batch_size: ['INT', { default: 1 }] }, optional: {} } },
      Image: { input: { required: { batch_index: ['INT', { default: 0 }] }, optional: {} } },
    }

    const withFanOut = applyVariantFanOut(workflow, objectInfo)
    const varsLink = (withFanOut.links || []).find((l: any[]) => String(l[5]).toUpperCase() === 'VARS')
    expect(varsLink, 'VARS link must survive fan-out').toBeTruthy()
    expect(varsLink![3]).toBe(2)
    expect(varsLink![4]).toBe(varsSlot)
  })
})
