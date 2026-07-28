import { describe, it, expect } from 'vitest'
import { useVueNodes } from '~/composables/useVueNodes'
import { stashCapsuleIntoProperties, restoreCapsuleFromProperties } from '~/lib/canvas/persistCapsule'

// The class of bug this file exists for: convertToLiteGraph writes a CURATED
// field map, so any node.data field nobody explicitly stashed is silently
// dropped on save. Nothing throws, nothing warns — you just reload and the
// state is gone. Unit tests that only exercise the stash helpers would not
// catch it, so these drive the REAL converters out of useVueNodes(), the same
// pair the autosave path calls.

function lgNode(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    type: 'KSampler',
    pos: [10, 20] as [number, number],
    size: [220, 120] as [number, number],
    title: 'Sampler',
    inputs: [],
    outputs: [],
    widgets_values: [],
    properties: {},
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

/** Save → load, through the actual converters. Returns the reloaded node.data. */
function roundTrip(data: Record<string, any>): Record<string, any> {
  const a = useVueNodes()
  a.convertFromLiteGraph(workflow([lgNode()]))
  Object.assign((a.nodes.value as any[])[0].data, data)
  const saved = a.convertToLiteGraph()

  // A second composable instance: a reload is a fresh converter reading the
  // serialized workflow, not the same in-memory objects handed back.
  const b = useVueNodes()
  b.convertFromLiteGraph(JSON.parse(JSON.stringify(saved)))
  return (b.nodes.value as any[])[0].data
}

describe('capsule state survives the save/load conversion', () => {
  it('round-trips collapsed: true', () => {
    expect(roundTrip({ collapsed: true }).collapsed).toBe(true)
  })

  it('does NOT persist collapsed: false — expansion is a transient pin, not a choice', () => {
    // The click-away that clears the pin is component state and cannot survive
    // a reload, so persisting `false` made an expanded node expanded forever.
    expect(roundTrip({ collapsed: false }).collapsed).toBeUndefined()
  })


  it('round-trips hasRun, which decides the after-run tier default', () => {
    expect(roundTrip({ hasRun: true }).hasRun).toBe(true)
  })

  it('carries both at once', () => {
    const out = roundTrip({ collapsed: true, hasRun: true })
    expect(out.collapsed).toBe(true)
    expect(out.hasRun).toBe(true)
  })

  it('leaves an untouched node tri-state undefined, not false', () => {
    // Persisting `collapsed: false` for a node nobody touched would freeze it
    // against any later change to its tier's default.
    expect(roundTrip({}).collapsed).toBeUndefined()
  })

  it('DOES NOT persist runningSince — a saved wall clock reloads as a forever-ticking counter', () => {
    const out = roundTrip({ collapsed: true, hasRun: true, running: true, runningSince: 1_700_000_000_000 })
    expect(out.runningSince).toBeUndefined()
    expect(out.running).toBeUndefined()
    // …while the fields that SHOULD survive still do, so this is proof of an
    // allow-list and not of the whole stash being broken.
    expect(out.collapsed).toBe(true)
    expect(out.hasRun).toBe(true)
  })

  it('does not leak run state into the serialized properties either', () => {
    const a = useVueNodes()
    a.convertFromLiteGraph(workflow([lgNode()]))
    Object.assign((a.nodes.value as any[])[0].data, {
      collapsed: true, running: true, runningSince: 1_700_000_000_000,
    })
    const stash = (a.convertToLiteGraph().nodes[0]!.properties as any).sailor_capsule
    expect(Object.keys(stash).sort()).toEqual(['collapsed'])
  })

  it('preserves unrelated properties alongside the stash', () => {
    const a = useVueNodes()
    a.convertFromLiteGraph(workflow([lgNode({ properties: { 'Node name for S&R': 'KSampler' } })]))
    ;(a.nodes.value as any[])[0].data.collapsed = true
    const props = a.convertToLiteGraph().nodes[0]!.properties as any
    expect(props['Node name for S&R']).toBe('KSampler')
    expect(props.sailor_capsule).toEqual({ collapsed: true })
  })

  it('drops a stale stash when the node returns to its defaults', () => {
    const a = useVueNodes()
    a.convertFromLiteGraph(workflow([lgNode({ properties: { sailor_capsule: { collapsed: true } } })]))
    const node = (a.nodes.value as any[])[0]
    expect(node.data.collapsed).toBe(true)
    node.data.collapsed = undefined
    expect((a.convertToLiteGraph().nodes[0]!.properties as any).sailor_capsule).toBeUndefined()
  })
})

describe('persistCapsule helpers', () => {
  it('ignores a malformed stash rather than throwing', () => {
    expect(restoreCapsuleFromProperties(undefined)).toBeNull()
    expect(restoreCapsuleFromProperties({})).toBeNull()
    expect(restoreCapsuleFromProperties({ sailor_capsule: 'junk' })).toBeNull()
    expect(restoreCapsuleFromProperties({ sailor_capsule: [] })).toBeNull()
    expect(restoreCapsuleFromProperties({ sailor_capsule: { collapsed: 'yes' } })).toBeNull()
  })

  it('returns the same properties object when there is nothing to record', () => {
    const props = { existing: 1 }
    expect(stashCapsuleIntoProperties({}, props)).toBe(props)
  })

  it('handles undefined properties', () => {
    expect(stashCapsuleIntoProperties({ collapsed: true }, undefined)).toEqual({
      sailor_capsule: { collapsed: true },
    })
  })
})

describe('legacy stashes', () => {
  it('ignores a collapsed: false written by an older build', () => {
    // Projects saved before "only a deliberate collapse persists" carry
    // collapsed:false. Honouring it would keep those nodes expanded forever,
    // since nothing writes that value any more and click-away cannot survive a
    // reload. Ignoring it returns the node to its tier default on load.
    const restored = restoreCapsuleFromProperties({ sailor_capsule: { collapsed: false, hasRun: true } })
    expect(restored?.collapsed).toBeUndefined()
    expect(restored?.hasRun).toBe(true)
  })
})
