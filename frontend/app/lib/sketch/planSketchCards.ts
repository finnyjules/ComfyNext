/**
 * Sketch card materialization — pure planner (spec: 2026-07-08-sketch-node-
 * refinement.md, Change 3). A Sketch node run can return up to 4 images in
 * ONE take (`num_outputs` batched at the backend). This computes WHERE each
 * image's card should sit and WHICH id it should use — reusing a stable slot
 * id on re-run instead of piling up new cards — without touching Vue/canvas
 * state. The impure half (VueNodeCanvas.vue's `materializeSketchCards`) only
 * does the node create/update/push using this plan.
 *
 * Grid: 2×2 to the right of the source node.
 *   slot 0 = (sx, sy)                 slot 1 = (sx + cardW + gap, sy)
 *   slot 2 = (sx, sy + cardH + gap)   slot 3 = (sx + cardW + gap, sy + cardH + gap)
 * where sx = source.position.x + source.width + 80, sy = source.position.y.
 */

export interface SketchCardPlan {
  id: string
  slot: number
  position: { x: number, y: number }
  image: string
  reuse: boolean
}

const CARD_SIZE = 200
const GAP = 24
const SOURCE_GAP = 80
const MAX_CARDS = 4

/** Deterministic id for a fresh (non-reused) slot — stable across runs so a
 *  second sketch run on the SAME source node reuses the SAME id even if the
 *  caller's existing-id registry was somehow empty (defense in depth; the
 *  normal path reuses via `existingCardIds`, not by recomputing this). */
export function sketchCardId(sourceId: string, slot: number): string {
  return `sketch-out-${sourceId}-${slot}`
}

export function planSketchCards(
  source: { id: string, position: { x: number, y: number }, width: number },
  images: string[],
  existingCardIds: string[],
): SketchCardPlan[] {
  const sx = source.position.x + source.width + SOURCE_GAP
  const sy = source.position.y
  const step = CARD_SIZE + GAP

  const capped = images.slice(0, MAX_CARDS)

  return capped.map((image, slot) => {
    const col = slot % 2
    const row = slot < 2 ? 0 : 1
    const position = { x: sx + col * step, y: sy + row * step }
    const existing = existingCardIds[slot]
    const reuse = !!existing
    const id = reuse ? existing : sketchCardId(source.id, slot)
    return { id, slot, position, image, reuse }
  })
}
