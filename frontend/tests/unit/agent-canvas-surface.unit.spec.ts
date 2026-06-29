import { describe, it, expect } from 'vitest'
import { describeCanvas, applyCanvasCommand, verifyCanvas, summarizeCanvasChange, type CanvasSnapshot } from '~/lib/agent/surfaces/canvas'
import type { CatalogEntry } from '~/lib/portIntentCatalog'

const CATALOG: CatalogEntry[] = [
  { type: 'VAEDecode', name: 'VAE Decode', description: '', inputs: [{ name: 'samples', type: 'LATENT' }, { name: 'vae', type: 'VAE' }], outputs: [{ name: 'IMAGE', type: 'IMAGE' }], widgets: [] },
  { type: 'UpscaleImage', name: 'Upscale Image', description: '', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'IMAGE', type: 'IMAGE' }], widgets: [{ name: 'scale', type: 'FLOAT', default: 2 }] },
]

function graph(): CanvasSnapshot {
  return {
    nodes: [
      { id: '1', nodeType: 'CheckpointLoaderSimple', title: 'Load Checkpoint', widgets: { ckpt_name: 'sd_xl.safetensors' }, inputs: [], outputs: [{ name: 'MODEL', type: 'MODEL' }] },
      { id: '2', nodeType: 'KSampler', title: 'KSampler', widgets: { seed: 0, steps: 20, sampler_name: 'euler' }, inputs: [{ name: 'model', type: 'MODEL' }, { name: 'latent_image', type: 'LATENT' }], outputs: [{ name: 'LATENT', type: 'LATENT' }] },
      { id: '3', nodeType: 'SaveImage', title: 'Save Image', widgets: {}, inputs: [{ name: 'images', type: 'IMAGE' }], outputs: [] },
    ],
    edges: [{ source: '1', sourcePort: 'MODEL', target: '2', targetPort: 'model' }],
    catalog: CATALOG,
  }
}

describe('describeCanvas', () => {
  it('emits one object per node + a graph summary with readable connections', () => {
    const snap = describeCanvas(graph())
    expect(snap.surface).toBe('canvas')
    expect(snap.objects.filter(o => o.type === 'node')).toHaveLength(3)
    const g = snap.objects.find(o => o.type === 'graph')!
    expect((g.current as { connections: string[] }).connections[0]).toContain('→')
  })
  it('exposes settable widget keys and connected-input flags', () => {
    const k = describeCanvas(graph()).objects.find(o => o.id === '2')!
    expect((k.current as { widgets: Record<string, unknown> }).widgets).toMatchObject({ steps: 20, sampler_name: 'euler' })
    const inputs = (k.current as { inputs: { name: string; connected: boolean }[] }).inputs
    expect(inputs.find(i => i.name === 'model')?.connected).toBe(true)
    expect(inputs.find(i => i.name === 'latent_image')?.connected).toBe(false)
  })
  it('every command carries a hint', () => {
    expect(describeCanvas(graph()).commands.every(c => typeof c.hint === 'string' && c.hint!.length > 0)).toBe(true)
  })
  it('exposes the palette of addable node types when a catalog is present', () => {
    const palette = describeCanvas(graph()).objects.find(o => o.type === 'palette')!
    expect(palette).toBeTruthy()
    expect((palette.current as { type: string }[]).map(c => c.type)).toContain('UpscaleImage')
  })
})

describe('applyCanvasCommand', () => {
  it('setWidget sets a known widget and is invertible', () => {
    const before = graph()
    const r = applyCanvasCommand(before, { op: 'setWidget', target: '2', args: { name: 'steps', value: 30 } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.template.nodes.find(n => n.id === '2')!.widgets.steps).toBe(30)
    const undo = applyCanvasCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.nodes).toEqual(before.nodes)
  })
  it('setWidget rejects an unknown widget name and a missing value', () => {
    expect(applyCanvasCommand(graph(), { op: 'setWidget', target: '2', args: { name: 'nope', value: 1 } }).ok).toBe(false)
    expect(applyCanvasCommand(graph(), { op: 'setWidget', target: '2', args: { name: 'steps' } }).ok).toBe(false)
  })
  it('setMode maps mute/bypass/normal to 2/4/0; rejects garbage', () => {
    expect((applyCanvasCommand(graph(), { op: 'setMode', target: '2', args: { mode: 'mute' } }) as any).template.nodes.find((n: any) => n.id === '2').mode).toBe(2)
    expect((applyCanvasCommand(graph(), { op: 'setMode', target: '2', args: { mode: 'bypass' } }) as any).template.nodes.find((n: any) => n.id === '2').mode).toBe(4)
    expect(applyCanvasCommand(graph(), { op: 'setMode', target: '2', args: { mode: 'wat' } }).ok).toBe(false)
  })
  it('deleteNode removes the node + its edges', () => {
    const r = applyCanvasCommand(graph(), { op: 'deleteNode', target: '2' })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.template.nodes.some(n => n.id === '2')).toBe(false)
    expect(r.template.edges.length).toBe(0) // the 1→2 edge is gone
  })
  it('addNode adds a palette node with a placeholder id + default/overridden widgets', () => {
    const r = applyCanvasCommand(graph(), { op: 'addNode', args: { nodeType: 'UpscaleImage', id: '$new1', widgetOverrides: { scale: 4 } } })
    expect(r.ok).toBe(true); if (!r.ok) return
    const n = r.template.nodes.find(x => x.id === '$new1')!
    expect(n.nodeType).toBe('UpscaleImage')
    expect(n.widgets.scale).toBe(4) // override applied (default was 2)
    expect(n.outputs[0]!.type).toBe('IMAGE')
  })
  it('addNode rejects a type not in the palette', () => {
    expect(applyCanvasCommand(graph(), { op: 'addNode', args: { nodeType: 'NotReal', id: '$x' } }).ok).toBe(false)
  })
  it('connect auto-resolves a type-compatible port pair', () => {
    // KSampler LATENT out → VAEDecode samples (LATENT). Add the decode, then connect.
    const added = applyCanvasCommand(graph(), { op: 'addNode', args: { nodeType: 'VAEDecode', id: '$dec' } })
    if (!added.ok) throw new Error('fail')
    const r = applyCanvasCommand(added.template, { op: 'connect', args: { from: '2', to: '$dec' } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.template.edges.some(e => e.source === '2' && e.target === '$dec' && e.sourcePort === 'LATENT' && e.targetPort === 'samples')).toBe(true)
  })
  it('connect rejects an incompatible pair and a bad port name', () => {
    // Checkpoint(MODEL) → SaveImage(IMAGE) has no compatible pair.
    expect(applyCanvasCommand(graph(), { op: 'connect', args: { from: '1', to: '3' } }).ok).toBe(false)
    expect(applyCanvasCommand(graph(), { op: 'connect', args: { from: '2', to: '3', fromPort: 'NOPE' } }).ok).toBe(false)
  })
  it('connect replaces an existing edge into the same input slot', () => {
    // model input on KSampler already wired from node 1; rewire from a clone is n/a,
    // so assert single-link: connecting again into the same input keeps one edge.
    const r = applyCanvasCommand(graph(), { op: 'connect', args: { from: '1', to: '2', fromPort: 'MODEL', toPort: 'model' } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.template.edges.filter(e => e.target === '2' && e.targetPort === 'model').length).toBe(1)
  })

  it('rejects an unknown node and an out-of-vocabulary op', () => {
    expect(applyCanvasCommand(graph(), { op: 'setWidget', target: 'zzz', args: { name: 'steps', value: 1 } }).ok).toBe(false)
    expect(applyCanvasCommand(graph(), { op: 'frobnicate' }).ok).toBe(false)
  })
  it('does not mutate the input', () => {
    const before = graph()
    applyCanvasCommand(before, { op: 'setWidget', target: '2', args: { name: 'steps', value: 99 } })
    expect(before.nodes.find(n => n.id === '2')!.widgets.steps).toBe(20)
  })
})

describe('verifyCanvas', () => {
  it('flags required inputs with nothing connected', () => {
    const issues = verifyCanvas(graph())
    expect(issues.some(i => /latent_image/.test(i.message))).toBe(true)
    expect(issues.some(i => /images/.test(i.message))).toBe(true)
  })
  it('skips checks on muted nodes', () => {
    const g = graph(); g.nodes[2]!.mode = 2
    expect(verifyCanvas(g).some(i => /images/.test(i.message))).toBe(false)
  })
})

describe('summarizeCanvasChange', () => {
  it('summarizes setWidget with a before/after', () => {
    const s = summarizeCanvasChange(graph(), { op: 'setWidget', target: '2', args: { name: 'steps', value: 30 } })
    expect(s?.before).toBe('20'); expect(s?.after).toBe('30')
  })
})
