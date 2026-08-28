import { describe, it, expect } from 'vitest'
import {
  framePresentKeys, finalizeWiredSentinels, reconcileWiredContent, isWiredSentinel,
  wiredReconcileKey,
  syncWiredLayerLinks,
  legacyWiredFlagsActive,
} from '~/lib/compositor/frameStack'
import { createWiredLayer, wiredFitWidth } from '~/lib/compositor/wiredLayer'
import { migrateFrameToUnifiedLayers, UNRESOLVED_WIRED_W, FRAME_SCHEMA_UNIFIED } from '~/lib/compositor/wiredMigration'
import type { LocalLayer } from '~/composables/useCompositorLayers'

// Host-side reconciliation for a schema-2 Frame. Everything here is the seam the
// three Frame surfaces (node card, Compositor modal, submit path) share, so a bug
// pinned here is a bug pinned in all three at once.

const SLOT_PROPS = ['x', 'y', 'rotation', 'scale', 'opacity', 'blend'] as const
function widgetHost(widgets: Record<string, unknown> = {}) {
  const defs: { name: string }[] = [{ name: 'width' }, { name: 'height' }]
  for (let i = 1; i <= 4; i++) for (const p of SLOT_PROPS) defs.push({ name: `layer${i}_${p}` })
  const widgetsValues = defs.map((d) => {
    if (d.name in widgets) return widgets[d.name]
    if (d.name.endsWith('_scale')) return 1
    if (d.name.endsWith('_opacity')) return 1
    if (d.name.endsWith('_blend')) return 'normal'
    return 0
  })
  return { widgetDefs: defs, widgetsValues }
}

function local(id: string): LocalLayer {
  return { id, kind: 'rect', x: 0.5, y: 0.5, w: 0.2, h: 0.2, rotation: 0, opacity: 1,
    fill: '#fff', stroke: '', strokeWidth: 0 } as unknown as LocalLayer
}

describe('framePresentKeys — the submit-path double-count', () => {
  it('emits ONE key per migrated wired slot (the `l:` one), not two', () => {
    const wired = createWiredLayer(0, { w: 1, lastAspect: 1 })
    const keys = framePresentKeys([0], [wired as LocalLayer, local('a')])
    expect(keys).toEqual([`l:${wired.id}`, 'l:a'])
    expect(keys.filter(k => k.startsWith('w:'))).toEqual([])
  })

  it('still emits `w:` for a connected slot no layer has claimed (legacy frame)', () => {
    // 1-based on the wire: slot 0 is `w:1`.
    expect(framePresentKeys([0, 2], [local('a')])).toEqual(['w:1', 'w:3', 'l:a'])
  })

  it('mixes claimed and unclaimed slots without dropping either', () => {
    const wired = createWiredLayer(1, { w: 1, lastAspect: 1 })
    const keys = framePresentKeys([0, 1], [wired as LocalLayer, local('a')])
    expect(keys).toEqual(['w:1', `l:${wired.id}`, 'l:a'])
  })

  it('keeps a wired layer whose slot was disconnected (it stays in the stack)', () => {
    const wired = createWiredLayer(3, { w: 1, lastAspect: 1, unlinked: true })
    expect(framePresentKeys([], [wired as LocalLayer])).toEqual([`l:${wired.id}`])
  })

  it('agrees with what a real migration produces — no key is listed twice', () => {
    const node = {
      connectedSlots: [0, 1],
      data: { ...widgetHost({ width: 1024, height: 1024 }), properties: {} as Record<string, any> },
    }
    migrateFrameToUnifiedLayers(node, { 0: { w: 1024, h: 1024 }, 1: { w: 800, h: 600 } })
    const layers = node.data.properties.sailor_localLayers as LocalLayer[]
    const keys = framePresentKeys([0, 1], layers)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toHaveLength(2)
  })
})

describe('finalizeWiredSentinels', () => {
  const canvas = { w: 1000, h: 1000 }
  // Tall 1:2 content in a square artboard — the contain-fit's HEIGHT-limited
  // branch, so `fit` is a real number (0.5) rather than the trivial 1.
  const natural = { w: 400, h: 800 }

  function sentinel(slot = 0, extra: Record<string, unknown> = {}) {
    return createWiredLayer(slot, { w: UNRESOLVED_WIRED_W, lastAspect: 1, x: 0.6, y: 0.4, rotation: 15, opacity: 0.8, ...extra }) as LocalLayer
  }

  it('PRESERVES the surviving layer{N}_scale: w = fit * scale, not fit', () => {
    const host = widgetHost({ layer1_scale: 1.5 })
    const out = finalizeWiredSentinels([sentinel()], host, canvas, () => natural)!
    expect(out).not.toBeNull()
    const fit = wiredFitWidth(natural, canvas)          // 0.5 for 1:2 in a square
    expect(fit).toBeCloseTo(0.5)
    expect((out[0] as any).w).toBeCloseTo(fit * 1.5)    // 0.75, NOT 0.5
    expect((out[0] as any).lastAspect).toBeCloseTo(2)   // h/w
  })

  it('leaves placement alone — the layer, not the widgets, owns x/y/rotation/opacity', () => {
    // The undo hazard: widgets can hold POST-finalize values when history rewinds
    // into a sentinel, so re-reading them would re-apply the edit just undone.
    const host = widgetHost({ layer1_x: 0.3, layer1_y: -0.25, layer1_rotation: 90, layer1_opacity: 0.1, layer1_scale: 2 })
    const out = finalizeWiredSentinels([sentinel()], host, canvas, () => natural)!
    expect((out[0] as any).x).toBeCloseTo(0.6)
    expect((out[0] as any).y).toBeCloseTo(0.4)
    expect((out[0] as any).rotation).toBe(15)
    expect((out[0] as any).opacity).toBeCloseTo(0.8)
  })

  it('skips layers that are already resolved (widgets are a mirror, not a source)', () => {
    const resolved = createWiredLayer(0, { w: 0.42, lastAspect: 0.5 }) as LocalLayer
    expect(finalizeWiredSentinels([resolved], widgetHost({ layer1_scale: 3 }), canvas, () => natural)).toBeNull()
  })

  it('is a no-op while the content size is still unknown', () => {
    expect(finalizeWiredSentinels([sentinel()], widgetHost(), canvas, () => undefined)).toBeNull()
  })

  it('is a no-op on a degenerate artboard rather than writing a fit-less width', () => {
    expect(finalizeWiredSentinels([sentinel()], widgetHost(), { w: 0, h: 0 }, () => natural)).toBeNull()
  })

  it('is idempotent — a second pass finds nothing left to finalize', () => {
    const host = widgetHost({ layer1_scale: 1.5 })
    const once = finalizeWiredSentinels([sentinel()], host, canvas, () => natural)!
    expect(finalizeWiredSentinels(once, host, canvas, () => natural)).toBeNull()
  })

  it('finalizes only the slots whose dims are known, leaving the rest sentinel', () => {
    const host = widgetHost({ layer1_scale: 1, layer2_scale: 1 })
    const out = finalizeWiredSentinels(
      [sentinel(0), sentinel(1)], host, canvas, s => (s === 0 ? natural : undefined))!
    expect(isWiredSentinel(out[0])).toBe(false)
    expect(isWiredSentinel(out[1])).toBe(true)
  })
})

describe('syncWiredLayerLinks — the edge lifecycle', () => {
  it('mints a sentinel layer for an edge that just landed, appended on TOP', () => {
    const out = syncWiredLayerLinks([local('a')], [2])!
    expect(out).not.toBeNull()
    expect(out.layers).toHaveLength(2)
    const added = out.layers[1] as any
    expect(added.kind).toBe('wired')
    expect(added.slot).toBe(2)
    expect(added.w).toBe(UNRESOLVED_WIRED_W)   // the finalizer resolves it on first content
    expect(out.addedIds).toEqual([added.id])
  })

  it('UNLINKS a cut slot instead of deleting the layer', () => {
    const w = createWiredLayer(0, { w: 0.6, lastAspect: 0.5, name: 'Hero' }) as LocalLayer
    const out = syncWiredLayerLinks([w], [])!
    const kept = out.layers[0] as any
    expect(kept.unlinked).toBe(true)
    expect(kept.w).toBeCloseTo(0.6)            // placement and size survive
    expect(kept.name).toBe('Hero')
    expect(out.addedIds).toEqual([])
  })

  it('relinks on re-connect rather than minting a second layer for the slot', () => {
    const w = createWiredLayer(0, { w: 0.6, lastAspect: 0.5, unlinked: true }) as LocalLayer
    const out = syncWiredLayerLinks([w], [0])!
    expect(out.layers).toHaveLength(1)
    expect((out.layers[0] as any).unlinked).toBeUndefined()
    expect(out.addedIds).toEqual([])
  })

  it('returns null in the steady state, so the host never commits in a loop', () => {
    const w = createWiredLayer(0, { w: 0.6, lastAspect: 0.5 }) as LocalLayer
    expect(syncWiredLayerLinks([w, local('a')], [0])).toBeNull()
    const cut = createWiredLayer(1, { w: 0.6, lastAspect: 0.5, unlinked: true }) as LocalLayer
    expect(syncWiredLayerLinks([cut], [])).toBeNull()
  })

  it('never gives one slot two layers, however often it runs', () => {
    let layers: LocalLayer[] = []
    for (let i = 0; i < 3; i++) layers = syncWiredLayerLinks(layers, [0, 1])?.layers ?? layers
    const slots = layers.filter(l => l.kind === 'wired').map(l => (l as any).slot)
    expect(slots).toEqual([0, 1])
  })
})

describe('reconcileWiredContent — lastAspect refresh', () => {
  it('adopts the new aspect after an upstream re-run at a different size', () => {
    const l = createWiredLayer(0, { w: 0.5, lastAspect: 1 }) as LocalLayer
    const out = reconcileWiredContent([l], () => ({ dims: { w: 800, h: 400 } }))!
    expect(out).not.toBeNull()
    expect((out[0] as any).lastAspect).toBeCloseTo(0.5)
    expect((out[0] as any).w).toBeCloseTo(0.5)   // the box width is the user's, untouched
  })

  it('returns null when nothing moved, so the host never commits in a loop', () => {
    const l = createWiredLayer(0, { w: 0.5, lastAspect: 0.5 }) as LocalLayer
    expect(reconcileWiredContent([l], () => ({ dims: { w: 800, h: 400 } }))).toBeNull()
  })

  it('leaves an `unlinked` layer frozen — that flag means "keep the size I set"', () => {
    const l = createWiredLayer(0, { w: 0.5, lastAspect: 1, unlinked: true }) as LocalLayer
    expect(reconcileWiredContent([l], () => ({ dims: { w: 800, h: 400 } }))).toBeNull()
  })

  it('never touches a sentinel — the finalizer owns those', () => {
    const l = createWiredLayer(0, { w: UNRESOLVED_WIRED_W, lastAspect: 1 }) as LocalLayer
    expect(reconcileWiredContent([l], () => ({ dims: { w: 800, h: 400 } }))).toBeNull()
  })

  it('tracks the depth key so DOF follows the slot content, and drops it for a live slot', () => {
    const l = createWiredLayer(0, { w: 0.5, lastAspect: 0.5 }) as LocalLayer
    const withKey = reconcileWiredContent([l], () => ({ dims: { w: 800, h: 400 }, depthKey: '/view?filename=a.png&type=output' }))!
    expect((withKey[0] as any).depthKey).toBe('/view?filename=a.png&type=output')
    const cleared = reconcileWiredContent(withKey, () => ({ dims: { w: 800, h: 400 } }))!
    expect((cleared[0] as any).depthKey).toBeUndefined()
  })

  it('ignores native layers entirely', () => {
    expect(reconcileWiredContent([local('a')], () => ({ dims: { w: 4, h: 2 } }))).toBeNull()
  })
})

// The watch key both hosts feed their finalize/reconcile pass. It used to be
// (slot dims + canvas size) ONLY, which meant a sentinel that appeared without
// either of those moving never re-finalized: `recordHistory()` between
// migration-on-open and the first decode snapshots `w = -1`, and undoing back to
// that snapshot left the layer invisible until the window was resized. The
// sentinel set is part of the key, so undo wakes the finalizer.
describe('wiredReconcileKey — undo onto a sentinel re-finalizes', () => {
  const info = () => ({ dims: { w: 800, h: 400 }, depthKey: 'a.png' })
  const canvas = { w: 1024, h: 1024 }

  it('changes when a sentinel appears with dims and canvas unchanged', () => {
    const resolved = createWiredLayer(0, { w: 0.5, lastAspect: 0.5 }) as LocalLayer
    const sentinel = { ...resolved, w: UNRESOLVED_WIRED_W } as LocalLayer
    const before = wiredReconcileKey([0], info, canvas, [resolved])
    const after = wiredReconcileKey([0], info, canvas, [sentinel])
    expect(after).not.toBe(before)
  })

  it('is stable while nothing moves, so the watcher cannot loop', () => {
    const l = createWiredLayer(0, { w: 0.5, lastAspect: 0.5 }) as LocalLayer
    expect(wiredReconcileKey([0], info, canvas, [l])).toBe(wiredReconcileKey([0], info, canvas, [l]))
    // An unresolvable sentinel (no dims for its slot) also holds still — the
    // finalizer leaves it alone, so the key must not oscillate.
    const s = createWiredLayer(1, { w: UNRESOLVED_WIRED_W }) as LocalLayer
    const noDims = () => ({ dims: undefined })
    expect(wiredReconcileKey([1], noDims, canvas, [s])).toBe(wiredReconcileKey([1], noDims, canvas, [s]))
  })

  it('still tracks slot dims, depth key and canvas size', () => {
    const l = createWiredLayer(0, { w: 0.5, lastAspect: 0.5 }) as LocalLayer
    const base = wiredReconcileKey([0], info, canvas, [l])
    expect(wiredReconcileKey([0], () => ({ dims: { w: 400, h: 400 }, depthKey: 'a.png' }), canvas, [l])).not.toBe(base)
    expect(wiredReconcileKey([0], () => ({ dims: { w: 800, h: 400 }, depthKey: 'b.png' }), canvas, [l])).not.toBe(base)
    expect(wiredReconcileKey([0], info, { w: 512, h: 512 }, [l])).not.toBe(base)
  })

  it('distinguishes WHICH slot is a sentinel (a per-slot partial still fires)', () => {
    const a = createWiredLayer(0, { w: UNRESOLVED_WIRED_W }) as LocalLayer
    const b = createWiredLayer(1, { w: 0.5, lastAspect: 1 }) as LocalLayer
    const one = wiredReconcileKey([0, 1], info, canvas, [a, b])
    const other = wiredReconcileKey([0, 1], info, canvas, [
      { ...a, w: 0.5 } as LocalLayer, { ...b, w: UNRESOLVED_WIRED_W } as LocalLayer,
    ])
    expect(one).not.toBe(other)
  })
})

// The single predicate every "is a wired slot's hidden/locked state still on the
// legacy sailor_hiddenWired/sailor_lockedWired arrays?" gate defers to — the
// Compositor modal, the Frame node card, and the submit path in VueNodeCanvas
// all call this ONE function instead of hand-copying the schema check, so they
// cannot silently disagree about which schema a frame is on. A reviewer found
// that reverting just one of those three call sites back to a hand-rolled check
// still passed every existing test — these pin the predicate's exact boundary
// (not just "schema 2" vs "schema 1") so any operator flip (`>=` → `>`, a
// dropped negation, an off-by-one) fails here.
describe('legacyWiredFlagsActive — the schema-2-dead gate', () => {
  it('is FALSE once a frame is migrated (schema 2): stale arrays are ignored', () => {
    expect(legacyWiredFlagsActive({ sailor_frameSchema: 2 })).toBe(false)
  })

  it('is FALSE for any schema at or above the unified constant, not just literal 2', () => {
    expect(legacyWiredFlagsActive({ sailor_frameSchema: FRAME_SCHEMA_UNIFIED })).toBe(false)
    expect(legacyWiredFlagsActive({ sailor_frameSchema: FRAME_SCHEMA_UNIFIED + 1 })).toBe(false)
  })

  it('is TRUE for a pre-migration frame: schema absent, 0, or 1', () => {
    expect(legacyWiredFlagsActive({})).toBe(true)
    expect(legacyWiredFlagsActive({ sailor_frameSchema: 0 })).toBe(true)
    expect(legacyWiredFlagsActive({ sailor_frameSchema: 1 })).toBe(true)
    expect(legacyWiredFlagsActive({ sailor_frameSchema: FRAME_SCHEMA_UNIFIED - 1 })).toBe(true)
  })

  it('is TRUE when properties itself is missing (no node data yet)', () => {
    expect(legacyWiredFlagsActive(null)).toBe(true)
    expect(legacyWiredFlagsActive(undefined)).toBe(true)
  })

  it('coerces a stringy schema the same way the migration gate does', () => {
    // `Number('2')` — mirrors `migrateFrameToUnifiedLayers`'s own
    // `Number(props.sailor_frameSchema) >= FRAME_SCHEMA_UNIFIED` idiom, so a
    // frame loaded from JSON (numbers can round-trip as strings) is read the
    // same way on both the migration side and the consumer side.
    expect(legacyWiredFlagsActive({ sailor_frameSchema: '2' } as any)).toBe(false)
    expect(legacyWiredFlagsActive({ sailor_frameSchema: '1' } as any)).toBe(true)
  })

  it('agrees with a real migration end to end: pre-migrate TRUE, post-migrate FALSE', () => {
    const node = {
      connectedSlots: [0],
      data: { ...widgetHost({ width: 100, height: 100 }), properties: {} as Record<string, any> },
    }
    expect(legacyWiredFlagsActive(node.data.properties)).toBe(true)
    migrateFrameToUnifiedLayers(node, { 0: { w: 100, h: 100 } })
    expect(legacyWiredFlagsActive(node.data.properties)).toBe(false)
  })
})
