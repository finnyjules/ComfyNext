/**
 * Sketch pile payload — pure logic for the SketchPile deck node (spec:
 * 2026-07-21-sketch-pile-design.md). One frontend-only node holds a sketch
 * batch in `properties[SKETCH_PROP]`; both sketch flows (the hidden prompt-bar
 * pad and a visible Sketch node) write this same shape. All items share the
 * payload-level prompt/seed — a batch of 4 is ONE prediction, one seed.
 */

export const SKETCH_PROP = 'sailor_sketch'
export const MAX_SKETCH_ITEMS = 4

/** Overlay stack: each image renders at the pile's on-screen size (pure
 *  translate morph), clamped so extreme zooms stay usable. */
export const STACK_ITEM_MIN_W = 120
export const STACK_ITEM_MAX_W = 320

/** Keeper column: kept/developed cards land left of the pile, marching down.
 *  Mirrors the retired pad-card grid footprint so keepers read as cards. */
export const KEEP_CARD_SIZE = 200
export const KEEP_GAP = 24

export interface SketchPileItem { image: string }

export interface SketchPilePayload {
  prompt: string
  seed: number
  /** The generator to re-run on re-roll — the hidden pad node (prompt-bar
   *  flow) or the Sketch node itself. Always a String(node.id). */
  sourceNodeId: string
  items: SketchPileItem[]
  loading?: boolean
  keptCount: number
}

export function buildSketchPilePayload(args: {
  prompt: string
  seed: number
  sourceNodeId: string
  images?: string[]
  loading?: boolean
}): SketchPilePayload {
  const payload: SketchPilePayload = {
    prompt: args.prompt,
    seed: args.seed,
    sourceNodeId: args.sourceNodeId,
    items: (args.images ?? []).slice(0, MAX_SKETCH_ITEMS).map(image => ({ image })),
    keptCount: 0,
  }
  if (args.loading) payload.loading = true
  return payload
}

/** Immutable refresh for a re-sketch/re-roll: replaces items (capped), clears
 *  loading unless explicitly kept on, preserves keptCount/sourceNodeId. */
export function refreshSketchPile(payload: SketchPilePayload, args: {
  images: string[]
  prompt?: string
  seed?: number
  loading?: boolean
}): SketchPilePayload {
  return {
    ...payload,
    prompt: args.prompt ?? payload.prompt,
    seed: args.seed ?? payload.seed,
    items: args.images.slice(0, MAX_SKETCH_ITEMS).map(image => ({ image })),
    loading: !!args.loading,
  }
}

export function stackItemWidth(pileScreenWidth: number): number {
  return Math.min(STACK_ITEM_MAX_W, Math.max(STACK_ITEM_MIN_W, pileScreenWidth))
}

export function keptCardPosition(pile: { x: number, y: number }, keptIndex: number): { x: number, y: number } {
  return {
    x: pile.x - (KEEP_CARD_SIZE + KEEP_GAP + 40),
    y: pile.y + keptIndex * (KEEP_CARD_SIZE + KEEP_GAP),
  }
}
