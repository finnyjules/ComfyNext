/**
 * Wired layers — graph-input images expressed in the SAME data model as native
 * local layers.
 *
 * Historically a wired image was drawn by `drawWiredImageLayer`, which took
 * per-slot widget values (`x`, `y`, `scale`, `rotation`, `opacity`) where `x`/`y`
 * are OFFSETS from the artboard centre and `scale` multiplies an aspect-fit
 * ("contain") box computed from the live image. Local layers instead store an
 * absolute normalized centre (0.5/0.5 = middle) and a width normalized to the
 * canvas WIDTH.
 *
 * The two mapping functions here are the bridge, and they are pure math: no DOM
 * and no canvas, so they unit-test in the node env and can run at migration
 * time. `wiredBoxFromWidgets` is the direction that matters for correctness —
 * feeding it a legacy transform must produce the box that renders the exact
 * same pixels the old fit-draw produced.
 *
 * `syncWiredWidgets` is the ONE-WAY write-through built on the inverse: after
 * unification the layer is the source of truth in the editor, but the Python
 * Compositor node and the server Render path still read `layer{N}_*`, so every
 * mutation of a wired layer is mirrored back down into its slot's widgets. It
 * is the only function in this file that touches node state.
 *
 * The fit math is copied from the legacy pair it has to agree with:
 *   - `drawWiredImageLayer` in `~/composables/useCompositorLayers`
 *   - `fitSize` in `components/vue-canvas/CompositorModal.vue`
 * both of which do: `iAspect > cAspect ? (fitW = W) : (fitW = H * iAspect)`.
 */

import type { LocalLayer, WiredLayer } from '~/composables/useCompositorLayers'
import { setWidget, type WidgetHostData } from '~/lib/compositor/nodeWidgets'

/** Pixel dimensions of the wired content (the upstream image or studio frame). */
export interface ContentDims { w: number; h: number }

/** Legacy per-slot widget transform: x/y are offsets from the artboard centre. */
export interface WiredWidgets {
  x: number
  y: number
  rotation: number
  scale: number
  opacity: number
}

/** The layer-model box a wired slot maps to. Width-normalized like every layer. */
export interface WiredBox {
  x: number
  y: number
  w: number
  rotation: number
  opacity: number
  lastAspect: number
}

let _idSeq = 0
/** Mirrors `newId` in useCompositorLayers; a distinct prefix so the two
 *  independent counters can never mint the same id in the same millisecond. */
function newWiredId(): string {
  _idSeq += 1
  return `wl-${Date.now().toString(36)}-${_idSeq}`
}

/**
 * Width of the legacy aspect-fit ("contain") box, normalized to canvas width.
 * 1 means the content fills the canvas horizontally. Degenerate dimensions fall
 * back to 1 so a missing/zero-sized content never produces NaN geometry.
 */
export function wiredFitWidth(natural: ContentDims, canvas: ContentDims): number {
  if (!(natural.w > 0) || !(natural.h > 0) || !(canvas.w > 0) || !(canvas.h > 0)) return 1
  const cAspect = canvas.w / canvas.h
  const iAspect = natural.w / natural.h
  // Legacy: iAspect > cAspect => fitW = W (width-limited), else fitW = H * iAspect.
  return iAspect > cAspect ? 1 : (canvas.h * iAspect) / canvas.w
}

/** Render height of a wired layer in width-normalized units. */
export function wiredLayerHeight(layer: Pick<WiredLayer, 'w' | 'lastAspect'>): number {
  return layer.w * (layer.lastAspect || 1)
}

/**
 * Legacy widget transform -> layer box. `scale = 1` with no offset reproduces
 * the old contain-fit placement exactly.
 */
export function wiredBoxFromWidgets(tf: WiredWidgets, natural: ContentDims, canvas: ContentDims): WiredBox {
  const fit = wiredFitWidth(natural, canvas)
  return {
    // Widget x/y are offsets from centre; layer x/y are absolute normalized centres.
    x: 0.5 + tf.x,
    y: 0.5 + tf.y,
    w: fit * tf.scale,
    rotation: tf.rotation,
    opacity: tf.opacity,
    lastAspect: natural.w > 0 && natural.h > 0 ? natural.h / natural.w : 1,
  }
}

/**
 * Layer box -> legacy widget transform. The inverse of `wiredBoxFromWidgets`,
 * for writing edits back to the per-slot widgets any legacy consumer still
 * reads.
 */
export function widgetsFromWiredBox(
  layer: Pick<WiredLayer, 'x' | 'y' | 'w' | 'rotation' | 'opacity'>,
  natural: ContentDims,
  canvas: ContentDims,
): WiredWidgets {
  const fit = wiredFitWidth(natural, canvas)
  return {
    x: layer.x - 0.5,
    y: layer.y - 0.5,
    rotation: layer.rotation,
    scale: fit > 0 ? layer.w / fit : 1,
    opacity: layer.opacity,
  }
}

/**
 * Create a wired layer for `slot`. Defaults match the old default placement:
 * centred, unrotated, opaque, and filling the canvas width (which is what the
 * contain-fit gives for any content at least as wide as the artboard). Callers
 * that know the content aspect should pass `w`/`lastAspect` from
 * `wiredBoxFromWidgets`.
 */
export function createWiredLayer(slot: number, partial: Partial<WiredLayer> = {}): WiredLayer {
  return {
    id: newWiredId(), kind: 'wired',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    slot, w: 1, lastAspect: 1,
    ...partial,
  }
}

// ── One-way write-through: layer → `layer{N}_*` slot widgets ─────────────────

/** The minimum node shape the write-through needs (both hosts satisfy it). */
export interface WiredWidgetNode { data?: WidgetHostData }

/**
 * The content dims the fit must be computed against. A host that has decoded the
 * upstream image (or knows a live studio's frame size) should supply the real
 * pixels; when it can't, the layer's own `lastAspect` pins the same ratio —
 * `wiredFitWidth` only ever reads the ASPECT of both boxes, so `{ w: 1, h:
 * lastAspect }` is not an approximation, it is the identical fit. Real dims are
 * still preferred: `lastAspect` is a CACHE, and a re-run upstream node can make
 * it stale, at which point the server would fit against pixels the cache no
 * longer describes.
 */
function fitDims(layer: Pick<WiredLayer, 'lastAspect'>, natural?: ContentDims): ContentDims {
  if (natural && natural.w > 0 && natural.h > 0) return natural
  return { w: 1, h: layer.lastAspect > 0 ? layer.lastAspect : 1 }
}

/**
 * Mirror one wired layer's transform into its slot's widgets — the 1-BASED
 * `layer{slot + 1}_x/y/rotation/scale/opacity/blend`. Returns true when at least
 * one widget was written.
 *
 * Deliberately NOT written:
 * - `layer{N}_protect` — a server-render flag with no home on the layer model.
 *   Its existing value is preserved.
 * - `layer{N}_z` — depth comes from the unified stack order, stamped on the
 *   OUTGOING workflow copy at bake time, not from the live node.
 * - visibility — `visible: false` is likewise applied to the outgoing copy (by
 *   zeroing opacity there), so the live node keeps the real opacity for when the
 *   eye toggles back on. Writing 0 here would destroy it.
 *
 * No-ops (returning false, leaving every widget untouched) when:
 * - the layer is a `w <= 0` sentinel — its box is not resolved yet, and the
 *   surviving legacy widgets still carry the truth until first paint finalizes
 *   it. Writing a sentinel through would blow that truth away.
 * - the canvas is degenerate, or the node declares no such widgets. Both would
 *   otherwise write a fit-less scale or corrupt a neighbouring widget.
 */
export function syncWiredWidgets(
  node: WiredWidgetNode | null | undefined,
  layer: WiredLayer,
  canvas: ContentDims,
  natural?: ContentDims,
): boolean {
  const data = node?.data
  if (!data || layer?.kind !== 'wired') return false
  if (!Number.isInteger(layer.slot) || layer.slot < 0) return false
  if (!(layer.w > 0)) return false                       // UNRESOLVED_WIRED_W sentinel
  if (!(canvas?.w > 0) || !(canvas?.h > 0)) return false

  const n = layer.slot + 1
  const tf = widgetsFromWiredBox(layer, fitDims(layer, natural), canvas)
  let wrote = false
  wrote = setWidget(data, `layer${n}_x`, tf.x) || wrote
  wrote = setWidget(data, `layer${n}_y`, tf.y) || wrote
  wrote = setWidget(data, `layer${n}_rotation`, tf.rotation) || wrote
  wrote = setWidget(data, `layer${n}_scale`, tf.scale) || wrote
  wrote = setWidget(data, `layer${n}_opacity`, tf.opacity) || wrote
  wrote = setWidget(data, `layer${n}_blend`, layer.blend || 'normal') || wrote
  return wrote
}

/**
 * Write-through for a whole layer stack: syncs every `wired` member and ignores
 * the native ones. Returns how many layers were mirrored.
 *
 * Layers NOT in the list are left alone on purpose — deleting a wired layer must
 * not clear its widgets, because deletion is not what removes it server-side
 * (disconnecting the edge is), and a slot that gets re-wired should come back
 * with the placement it had.
 */
export function syncAllWiredWidgets(
  node: WiredWidgetNode | null | undefined,
  layers: readonly LocalLayer[],
  canvas: ContentDims,
  naturalFor?: (slot: number) => ContentDims | undefined,
): number {
  if (!node?.data) return 0
  let n = 0
  for (const l of layers) {
    if (l?.kind !== 'wired') continue
    const w = l as WiredLayer
    if (syncWiredWidgets(node, w, canvas, naturalFor?.(w.slot))) n++
  }
  return n
}
