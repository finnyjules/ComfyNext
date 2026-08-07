import { describe, expect, it } from 'vitest'
import { ARTIFACT_NODE_COMPONENTS, getVueFlowType, useVueNodes } from '~/composables/useVueNodes'

// The Moodboard node's persistence contract (plan 2026-08-06-moodboards-a-core,
// Task A5). convertToLiteGraph writes a CURATED field map: anything on
// node.data that isn't explicitly stashed is silently dropped on save. The
// node's ONLY persistent state is therefore properties.sailor_moodboard (the
// library entry id) — this file drives the REAL converter pair out of
// useVueNodes() (the capsule-persistence.unit.spec.ts pattern) to prove the
// state placement is correct, not accidental.

function lgNode(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    type: 'Moodboard',
    pos: [10, 20] as [number, number],
    size: [220, 120] as [number, number],
    title: 'Moodboard',
    inputs: [],
    outputs: [],
    widgets_values: [],
    properties: { sailor_moodboard: 'pastel-miami' },
    mode: 0,
    ...overrides,
  }
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

describe('Moodboard node registration', () => {
  it('routes the Moodboard type to the moodboard Vue Flow component', () => {
    expect(ARTIFACT_NODE_COMPONENTS.Moodboard).toBe('moodboard')
    expect(getVueFlowType('Moodboard')).toBe('moodboard')
  })
})

describe('Moodboard state survives the save/load conversion', () => {
  it('round-trips properties.sailor_moodboard but drops a decoy data field', () => {
    const a = useVueNodes()
    a.convertFromLiteGraph(workflow([lgNode()]))
    const live = (a.nodes.value as any[])[0]
    // Decoy: a field on data (NOT under properties). If this survived, state
    // placement wouldn't matter and the assertion below would prove nothing.
    live.data.boardThumbs = ['x']

    const saved = a.convertToLiteGraph()
    // The serialized workflow itself must carry the reference key…
    expect((saved.nodes[0]!.properties as any).sailor_moodboard).toBe('pastel-miami')
    // …and must NOT have grown a persisted copy of the decoy anywhere.
    expect(JSON.stringify(saved)).not.toContain('boardThumbs')

    // A reload is a FRESH converter reading the serialized JSON, not the same
    // in-memory objects handed back.
    const b = useVueNodes()
    b.convertFromLiteGraph(JSON.parse(JSON.stringify(saved)))
    const reloaded = (b.nodes.value as any[])[0]

    expect(reloaded.type).toBe('moodboard') // component routing survives reload
    expect(reloaded.data.properties.sailor_moodboard).toBe('pastel-miami')
    expect(reloaded.data.boardThumbs).toBeUndefined() // the gotcha, demonstrated
  })

  it('round-trips an empty reference (fresh node, nothing picked yet)', () => {
    const a = useVueNodes()
    a.convertFromLiteGraph(workflow([lgNode({ properties: { sailor_moodboard: '' } })]))
    const saved = a.convertToLiteGraph()
    const b = useVueNodes()
    b.convertFromLiteGraph(JSON.parse(JSON.stringify(saved)))
    expect((b.nodes.value as any[])[0].data.properties.sailor_moodboard).toBe('')
  })
})
