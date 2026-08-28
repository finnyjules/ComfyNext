/**
 * Host-side reconciliation for a schema-2 (unified-layer) Frame.
 *
 * Three jobs that every Frame surface has to do the SAME way — the Frame node
 * card, the Compositor modal, and the submit path in `VueNodeCanvas` — live here
 * as pure functions so they cannot drift:
 *
 *  1. `framePresentKeys` — which StackKeys a frame actually has right now. On a
 *     migrated frame a connected slot is a LAYER, so it must be counted once, as
 *     `l:<id>`, never also as its legacy `w:<slot+1>`.
 *  2. `finalizeWiredSentinels` — resolve the migration's `w <= 0` sentinels the
 *     first time real content dimensions are known.
 *  3. `reconcileWiredContent` — keep each wired layer's cached `lastAspect` and
 *     `depthKey` in step with what the upstream slot is actually feeding it.
 *
 * No Vue, no DOM: hosts pass in the slot dimensions they have decoded and get a
 * new layer array back (or `null` for "nothing changed", so a caller can skip
 * the commit and avoid a render loop).
 */

import type { LocalLayer, WiredLayer } from '~/composables/useCompositorLayers'
import { createWiredLayer, wiredBoxFromWidgets, type ContentDims } from '~/lib/compositor/wiredLayer'
import { widgetNum, type WidgetHostData } from '~/lib/compositor/nodeWidgets'
import { UNRESOLVED_WIRED_W } from '~/lib/compositor/wiredMigration'

/** Stack key for a wired slot. `slot` is 0-BASED; keys are 1-based (`w:1` = layer1). */
export function wiredStackKey(slot: number): string { return `w:${slot + 1}` }
/** Stack key for a layer (wired layers included, once migrated). */
export function localStackKey(id: string): string { return `l:${id}` }

/** The minimum layer shape present-key building needs. */
export interface StackLayerLike { id: string; kind?: string; slot?: number }

/**
 * Every StackKey a frame currently has, bottom→top, with NO duplicates for a
 * migrated wired slot.
 *
 * The double-count this prevents: pre-schema-2 every connected slot contributed
 * `w:<slot+1>` and every entry of `sailor_localLayers` contributed `l:<id>`.
 * After migration a wired slot is BOTH — it is a connected port and a layer — so
 * the naive union lists it twice, which corrupts the z-order (two depths for one
 * layer) and, on the submit path, makes the second entry get baked as if it were
 * a local overlay. A wired LAYER claims its slot: the slot's `w:` key is dropped
 * and only the layer's `l:` key survives.
 *
 * A connected slot with no layer claiming it still emits `w:` — that is a
 * pre-migration frame, or the instant between an edge landing and the host
 * minting its layer — so legacy frames keep rendering exactly as before.
 *
 * Order is the legacy default: unclaimed wired slots at the bottom, then the
 * layer array in its own order (which, post-migration, already starts with the
 * wired layers because that is where the migration put them).
 */
export function framePresentKeys(
  connectedSlots: readonly number[],
  layers: readonly StackLayerLike[],
): string[] {
  const claimed = new Set<number>()
  for (const l of layers) {
    if (l?.kind === 'wired' && Number.isInteger(l.slot)) claimed.add(l.slot as number)
  }
  return [
    ...connectedSlots.filter(s => !claimed.has(s)).map(wiredStackKey),
    ...layers.map(l => localStackKey(l.id)),
  ]
}

/** True when this layer is a migration sentinel awaiting its first real content. */
export function isWiredSentinel(l: LocalLayer | null | undefined): boolean {
  return l?.kind === 'wired' && !((l as WiredLayer).w > 0)
}

/**
 * Resolve every `w <= 0` sentinel whose content dimensions are now known.
 *
 * The sentinel exists because the contain-fit that turns a legacy `layer{N}_*`
 * transform into a layer box needs the CONTENT size, which migration often runs
 * before (images decode async). The surviving widgets still carry the truth
 * until this runs, and `syncWiredWidgets` refuses to write over them while the
 * layer is a sentinel — so the finalize direction is widget → layer, once.
 *
 * `w = fit * scale`, NOT `fit`: dropping the surviving `layer{N}_scale` would
 * silently resize every migrated frame whose user had scaled a slot.
 *
 * Two things it deliberately does NOT do:
 *  - It never touches a layer whose `w > 0`. That layer's transform came from
 *    the layer model (the editor is the source of truth once resolved) and its
 *    widgets are a mirror of it, so re-deriving from them is at best a no-op and
 *    at worst clobbers an edit with a stale mirror.
 *  - It takes x/y/rotation/opacity from the LAYER, not from the widgets. The
 *    migration already copied those across, and they are the only part of a
 *    sentinel that is already true. This is what defuses the undo hazard: undoing
 *    back INTO a sentinel state re-runs this function against widgets that may
 *    still hold post-finalize values, and only the width would then be re-derived
 *    — placement, rotation and opacity come back as the undo left them.
 *
 * Callers must commit the result WITHOUT recording a history step, so
 * finalization is never its own undoable edit.
 */
export function finalizeWiredSentinels(
  layers: readonly LocalLayer[],
  data: WidgetHostData | null | undefined,
  canvas: ContentDims,
  dimsFor: (slot: number) => ContentDims | undefined,
): LocalLayer[] | null {
  if (!layers.length) return null
  if (!(canvas?.w > 0) || !(canvas?.h > 0)) return null
  let changed = false
  const next = layers.map((l) => {
    if (!isWiredSentinel(l)) return l
    const w = l as WiredLayer
    const natural = dimsFor(w.slot)
    if (!natural || !(natural.w > 0) || !(natural.h > 0)) return l
    const n = w.slot + 1
    const box = wiredBoxFromWidgets(
      {
        x: 0, y: 0, rotation: 0,
        scale: widgetNum(data, `layer${n}_scale`, 1) || 1,
        opacity: 1,
      },
      natural, canvas,
    )
    changed = true
    return { ...w, w: box.w, lastAspect: box.lastAspect }
  })
  return changed ? next : null
}

/**
 * Reconcile the layer stack against the graph's edges — the whole edge lifecycle
 * in one pure pass, so both hosts (and any future one) behave identically:
 *
 *  - an edge LANDS on a slot no layer holds ⇒ append a wired layer for it, as a
 *    `w <= 0` sentinel. The finalizer resolves its box from the slot's widgets
 *    on first content, exactly as it does for a migrated one. Appended (not
 *    prepended) so a newly wired image floats to the TOP of the stack, matching
 *    what the editor has always done with newcomers.
 *  - an edge is CUT ⇒ the layer is not deleted, it goes `unlinked`. The user's
 *    placement, name, mask, cloner and z-position survive, and `lastAspect` keeps
 *    its box the size it was, so re-wiring the slot restores the layer instead of
 *    making the user rebuild it.
 *  - the slot is RE-CONNECTED ⇒ `unlinked` clears and the layer tracks live
 *    content again.
 *
 * Returns `{ layers, addedIds }`, or `null` when nothing changed — callers commit
 * only on a change, so this can run on every wiring tick without looping.
 */
export function syncWiredLayerLinks(
  layers: readonly LocalLayer[],
  connectedSlots: readonly number[],
): { layers: LocalLayer[]; addedIds: string[] } | null {
  const connected = new Set(connectedSlots.filter(s => Number.isInteger(s) && s >= 0))
  const held = new Set<number>()
  let changed = false

  const next: LocalLayer[] = layers.map((l) => {
    if (l.kind !== 'wired') return l
    const w = l as WiredLayer
    held.add(w.slot)
    const shouldBeUnlinked = !connected.has(w.slot)
    if (!!w.unlinked === shouldBeUnlinked) return l
    changed = true
    if (shouldBeUnlinked) return { ...w, unlinked: true }
    const relinked = { ...w }
    delete relinked.unlinked
    return relinked
  })

  const addedIds: string[] = []
  for (const slot of [...connected].sort((a, b) => a - b)) {
    if (held.has(slot)) continue
    const layer = createWiredLayer(slot, { w: UNRESOLVED_WIRED_W, lastAspect: 1 })
    next.push(layer)
    addedIds.push(layer.id)
    changed = true
  }
  return changed ? { layers: next, addedIds } : null
}

/** What a host knows about a wired slot's live content this tick. */
export interface WiredContentInfo {
  dims?: ContentDims
  /** Depth-map cache key (the upstream `/view` URL); absent for a live studio slot. */
  depthKey?: string
}

/**
 * Keep each resolved wired layer's cached content facts current.
 *
 * `lastAspect` is a CACHE of the content aspect, and paint is read-only — it
 * re-fits to live content every frame but never writes the new aspect back. The
 * write-through, meanwhile, computes `scale = w / fit` and falls back to
 * `lastAspect` when the host supplies no real dims. So after an upstream node
 * re-runs at a different aspect, the preview re-fits while the widget `scale`
 * drifts PERMANENTLY (the server then renders at a size the editor never showed)
 * unless the host reconciles here. Hosts must ALSO pass real `wiredDims` into
 * the editor, which is the other half of the same fix.
 *
 * `unlinked` layers are skipped on purpose: that flag means "keep the size I
 * set, whatever the graph does now", which is exactly a frozen `lastAspect`.
 *
 * Sentinels are skipped too — `finalizeWiredSentinels` owns them, and it sets
 * `lastAspect` from the same dims in the same pass.
 */
export function reconcileWiredContent(
  layers: readonly LocalLayer[],
  contentFor: (slot: number) => WiredContentInfo | undefined,
): LocalLayer[] | null {
  if (!layers.length) return null
  let changed = false
  const next = layers.map((l) => {
    if (l.kind !== 'wired') return l
    const w = l as WiredLayer
    if (!(w.w > 0)) return l                       // sentinel — not ours
    const info = contentFor(w.slot)
    if (!info) return l
    const patch: Partial<WiredLayer> = {}
    const d = info.dims
    if (!w.unlinked && d && d.w > 0 && d.h > 0) {
      const aspect = d.h / d.w
      if (Math.abs(aspect - (w.lastAspect || 0)) > 1e-4) patch.lastAspect = aspect
    }
    const key = info.depthKey || undefined
    if (key !== w.depthKey) patch.depthKey = key
    if (!Object.keys(patch).length) return l
    changed = true
    const merged = { ...w, ...patch }
    if (patch.depthKey === undefined && 'depthKey' in patch) delete (merged as any).depthKey
    return merged
  })
  return changed ? next : null
}
