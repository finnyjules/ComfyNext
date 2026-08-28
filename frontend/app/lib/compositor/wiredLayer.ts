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
 * The fit math is copied from the legacy pair it has to agree with:
 *   - `drawWiredImageLayer` in `~/composables/useCompositorLayers`
 *   - `fitSize` in `components/vue-canvas/CompositorModal.vue`
 * both of which do: `iAspect > cAspect ? (fitW = W) : (fitW = H * iAspect)`.
 */

import type { WiredLayer } from '~/composables/useCompositorLayers'

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
