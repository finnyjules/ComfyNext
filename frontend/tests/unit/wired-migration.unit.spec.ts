import { describe, it, expect } from 'vitest'
import {
  migrateFrameToUnifiedLayers, FRAME_SCHEMA_UNIFIED, UNRESOLVED_WIRED_W,
  type FrameNodeShape,
} from '~/lib/compositor/wiredMigration'
import { useVueNodes } from '~/composables/useVueNodes'

// Schema-2 migration: the per-slot registries (`sailor_hiddenWired`,
// `sailor_lockedWired`, `sailor_wiredCloners`, `sailor_wiredTreatments`,
// `sailor_wiredNames`) and the `layer{N}_*` transform widgets are folded into
// ONE `wired` layer per connected slot, living in `sailor_localLayers` next to
// the native layers.
//
// Slot numbering (the trap this file pins down): `WiredLayer.slot` is the
// 0-BASED input-port index, exactly like `ArtifactFrameNode`'s internal
// WiredLayer and the write-through target `layer{slot+1}_*`. Every PERSISTED
// registry is 1-BASED (`w:1` = the backend's layer1). So a layer with
// `slot: 0` migrates from `w:1` / `layer1_*` / `sailor_hiddenWired: [1]`.

const SLOT_PROPS = ['x', 'y', 'rotation', 'scale', 'opacity', 'blend', 'protect'] as const

/** Widget defs in the real Compositor order: width/height then layer{1..N}_*. */
function widgetDefs(slots: number): { name: string }[] {
  const defs: { name: string }[] = [{ name: 'width' }, { name: 'height' }]
  for (let i = 1; i <= slots; i++) for (const p of SLOT_PROPS) defs.push({ name: `layer${i}_${p}` })
  return defs
}

function makeNode(opts: {
  connectedSlots: number[]
  widgets?: Record<string, unknown>
  properties?: Record<string, any>
}): FrameNodeShape & { data: { properties: Record<string, any>; widgetsValues: any[]; widgetDefs: { name: string }[] } } {
  const defs = widgetDefs(4)
  const values: any[] = defs.map((d) => {
    if (opts.widgets && d.name in opts.widgets) return opts.widgets[d.name]
    if (d.name.endsWith('_scale')) return 1
    if (d.name.endsWith('_opacity')) return 1
    if (d.name.endsWith('_blend')) return 'normal'
    if (d.name.endsWith('_protect')) return false
    return 0
  })
  return {
    connectedSlots: opts.connectedSlots,
    data: { widgetDefs: defs, widgetsValues: values, properties: { ...(opts.properties ?? {}) } },
  }
}

const CANVAS = { width: 1024, height: 1024 }

describe('migrateFrameToUnifiedLayers — full fold', () => {
  function fullFixture() {
    return makeNode({
      connectedSlots: [0, 1],
      widgets: {
        ...CANVAS,
        layer1_x: 0.1, layer1_y: -0.2, layer1_rotation: 15, layer1_scale: 1.5,
        layer1_opacity: 0.8, layer1_blend: 'multiply',
      },
      properties: {
        sailor_hiddenWired: [2],
        sailor_lockedWired: [1],
        sailor_wiredCloners: { 2: { mode: 'grid', count: 4 } },
        sailor_wiredNames: { 1: 'Hero' },
        sailor_wiredTreatments: {
          'w:1': { maskedByKey: 'l:t1', showSource: true },
          'w:2': { maskUrl: 'data:image/png;base64,AAA' },
        },
        sailor_stackOrder: ['w:1', 'l:t1', 'w:2'],
        sailor_localLayers: [
          { id: 't1', kind: 'text', x: 0.5, y: 0.5, rotation: 0, opacity: 1, text: 'hi', maskedByKey: 'w:2' },
        ],
      },
    })
  }

  it('creates one wired layer per connected slot with the widget transform', () => {
    const node = fullFixture()
    expect(migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 600 }, 1: { w: 400, h: 400 } })).toBe(true)

    const layers = node.data.properties.sailor_localLayers as any[]
    const a = layers.find(l => l.kind === 'wired' && l.slot === 0)
    const b = layers.find(l => l.kind === 'wired' && l.slot === 1)
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()

    // x/y are offsets from centre in the widgets, absolute centres in the layer.
    expect(a.x).toBeCloseTo(0.6, 6)
    expect(a.y).toBeCloseTo(0.3, 6)
    expect(a.rotation).toBe(15)
    expect(a.opacity).toBeCloseTo(0.8, 6)
    // 800x600 in a 1024x1024 canvas is width-limited ⇒ fit w = 1, times scale.
    expect(a.w).toBeCloseTo(1.5, 6)
    expect(a.lastAspect).toBeCloseTo(0.75, 6)
    expect(a.blend).toBe('multiply')

    // Slot 2 keeps its defaults: centred, unrotated, opaque, contain-fit.
    expect(b.x).toBeCloseTo(0.5, 6)
    expect(b.w).toBeCloseTo(1, 6)
    expect(b.lastAspect).toBeCloseTo(1, 6)
  })

  it('folds hidden / locked / cloner / name / treatments into the layer', () => {
    const node = fullFixture()
    migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 600 }, 1: { w: 400, h: 400 } })
    const layers = node.data.properties.sailor_localLayers as any[]
    const a = layers.find(l => l.slot === 0)
    const b = layers.find(l => l.slot === 1)

    expect(a.locked).toBe(true)          // sailor_lockedWired: [1] ⇒ slot 0
    expect(a.visible).toBeUndefined()
    expect(a.name).toBe('Hero')          // sailor_wiredNames: { 1: 'Hero' }
    expect(a.maskShowSource).toBe(true)

    expect(b.visible).toBe(false)        // sailor_hiddenWired: [2] ⇒ slot 1
    expect(b.locked).toBeUndefined()
    expect(b.cloner).toEqual({ mode: 'grid', count: 4 })
  })

  it('rewrites w: keys in the stack order in place and keeps positions', () => {
    const node = fullFixture()
    migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 600 }, 1: { w: 400, h: 400 } })
    const layers = node.data.properties.sailor_localLayers as any[]
    const a = layers.find(l => l.slot === 0)
    const b = layers.find(l => l.slot === 1)

    expect(node.data.properties.sailor_stackOrder).toEqual([`l:${a.id}`, 'l:t1', `l:${b.id}`])
    expect(JSON.stringify(node.data.properties.sailor_stackOrder)).not.toContain('w:')
  })

  it('rewrites maskedByKey refs that pointed at a wired slot', () => {
    const node = fullFixture()
    migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 600 }, 1: { w: 400, h: 400 } })
    const layers = node.data.properties.sailor_localLayers as any[]
    const b = layers.find(l => l.slot === 1)
    const text = layers.find(l => l.id === 't1')
    expect(text.maskedByKey).toBe(`l:${b.id}`)   // was 'w:2'
  })

  it('sets the schema flag and leaves the legacy registries untouched', () => {
    const node = fullFixture()
    migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 600 }, 1: { w: 400, h: 400 } })
    const p = node.data.properties
    expect(p.sailor_frameSchema).toBe(FRAME_SCHEMA_UNIFIED)
    expect(p.sailor_hiddenWired).toEqual([2])
    expect(p.sailor_lockedWired).toEqual([1])
    expect(p.sailor_wiredCloners).toEqual({ 2: { mode: 'grid', count: 4 } })
    expect(p.sailor_wiredNames).toEqual({ 1: 'Hero' })
    // maskUrl has no layer-model home yet — it stays on the slot registry.
    expect(p.sailor_wiredTreatments['w:2'].maskUrl).toBe('data:image/png;base64,AAA')
    // …and the widgets are untouched too (server render still reads them).
    expect(node.data.widgetsValues[node.data.widgetDefs.findIndex(d => d.name === 'layer1_x')]).toBe(0.1)
  })

  it('puts migrated wired layers BELOW the native ones (the legacy default)', () => {
    const node = makeNode({
      connectedSlots: [0],
      widgets: CANVAS,
      properties: {
        sailor_localLayers: [{ id: 't1', kind: 'text', x: 0.5, y: 0.5, rotation: 0, opacity: 1, text: 'hi' }],
      },
    })
    migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 600 } })
    const layers = node.data.properties.sailor_localLayers as any[]
    expect(layers.map(l => l.kind)).toEqual(['wired', 'text'])
  })
})

describe('migrateFrameToUnifiedLayers — idempotence and edge cases', () => {
  it('is a no-op on a second call', () => {
    const node = makeNode({
      connectedSlots: [0, 1],
      widgets: { ...CANVAS, layer1_x: 0.1 },
      properties: { sailor_stackOrder: ['w:1', 'w:2'], sailor_hiddenWired: [2] },
    })
    expect(migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 600 }, 1: { w: 400, h: 400 } })).toBe(true)
    const before = JSON.stringify(node)
    expect(migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 600 }, 1: { w: 400, h: 400 } })).toBe(false)
    expect(JSON.stringify(node)).toBe(before)
  })

  it('flags a frame with no connected slots and adds no layers', () => {
    const node = makeNode({ connectedSlots: [], widgets: CANVAS })
    expect(migrateFrameToUnifiedLayers(node, {})).toBe(true)
    expect(node.data.properties.sailor_frameSchema).toBe(FRAME_SCHEMA_UNIFIED)
    expect(node.data.properties.sailor_localLayers).toBeUndefined()
  })

  it('returns false when there is no node data at all', () => {
    expect(migrateFrameToUnifiedLayers({ connectedSlots: [] } as any, {})).toBe(false)
  })

  it('uses the sentinel width when the content size is not known yet', () => {
    const node = makeNode({
      connectedSlots: [0],
      widgets: { ...CANVAS, layer1_x: 0.25, layer1_rotation: 30, layer1_scale: 2, layer1_opacity: 0.5 },
    })
    expect(migrateFrameToUnifiedLayers(node, {})).toBe(true)
    const l = (node.data.properties.sailor_localLayers as any[])[0]
    expect(l.w).toBe(UNRESOLVED_WIRED_W)
    expect(UNRESOLVED_WIRED_W).toBe(-1)
    expect(l.lastAspect).toBe(1)
    // Everything the widgets DO pin down still migrates.
    expect(l.x).toBeCloseTo(0.75, 6)
    expect(l.rotation).toBe(30)
    expect(l.opacity).toBeCloseTo(0.5, 6)
  })

  it('falls back to the base slot aspect when the frame has no explicit size', () => {
    // No width/height widgets set ⇒ the artboard takes the bottom slot's aspect,
    // so that slot's contain-fit is the full canvas width.
    const node = makeNode({ connectedSlots: [0, 1] })
    migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 400 }, 1: { w: 400, h: 400 } })
    const layers = node.data.properties.sailor_localLayers as any[]
    expect(layers.find(l => l.slot === 0).w).toBeCloseTo(1, 6)
    // A square in a 2:1 artboard is height-limited ⇒ half the width.
    expect(layers.find(l => l.slot === 1).w).toBeCloseTo(0.5, 6)
  })

  it('tolerates a node whose properties bag does not exist yet', () => {
    const node = { connectedSlots: [], data: { widgetDefs: [], widgetsValues: [] } } as any
    expect(migrateFrameToUnifiedLayers(node, {})).toBe(true)
    expect(node.data.properties.sailor_frameSchema).toBe(FRAME_SCHEMA_UNIFIED)
  })
})

describe('schema-2 state survives the workflow save/load round-trip', () => {
  function workflow(properties: Record<string, any>) {
    return {
      last_node_id: 1, last_link_id: 0, links: [], groups: [], config: {}, extra: {}, version: 0.4,
      nodes: [{
        id: 1, type: 'ArtifactFrame', pos: [0, 0] as [number, number], size: [220, 120] as [number, number],
        title: 'Frame', inputs: [], outputs: [], widgets_values: [], properties, mode: 0,
      }],
    } as any
  }

  it('round-trips sailor_frameSchema and the migrated wired layers', () => {
    const node = makeNode({
      connectedSlots: [0],
      widgets: CANVAS,
      properties: { sailor_stackOrder: ['w:1'] },
    })
    migrateFrameToUnifiedLayers(node, { 0: { w: 800, h: 600 } })

    const a = useVueNodes()
    a.convertFromLiteGraph(workflow(node.data.properties))
    const saved = a.convertToLiteGraph()
    const b = useVueNodes()
    b.convertFromLiteGraph(JSON.parse(JSON.stringify(saved)))
    const p = (b.nodes.value as any[])[0].data.properties

    expect(p.sailor_frameSchema).toBe(FRAME_SCHEMA_UNIFIED)
    const wired = (p.sailor_localLayers as any[]).find(l => l.kind === 'wired')
    expect(wired.slot).toBe(0)
    expect(wired.w).toBeCloseTo(1, 6)
    expect(p.sailor_stackOrder).toEqual([`l:${wired.id}`])
  })
})
