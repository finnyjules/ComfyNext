/**
 * Anchor-based sketch stack — the prompt-bar sketch flow has NO source node, so
 * the pad is placed at an explicit viewport-derived top-left instead of "right
 * of a node". The 4 options stack VERTICALLY (one column) at the anchor. Card
 * size/gap mirror planSketchCards.ts so kept cards are indistinguishable from
 * node-spawned ones. (spec: 2026-07-12-sketch-from-the-prompt-bar-design.md §2)
 */
import type { SketchCardPlan } from './planSketchCards'

export type { SketchCardPlan } from './planSketchCards'

export const SKETCH_PAD_ID = 'sketch-pad'

// Exported so callers (e.g. the "Keep" lift-out placement in VueNodeCanvas)
// share the exact same grid geometry instead of a hand-copied, driftable pair.
export const CARD_SIZE = 200
export const GAP = 24
const MAX_CARDS = 4

/** Stable id for a pad slot — reused across re-sketches so refresh overwrites
 *  the same 4 cards instead of piling up. */
export function sketchPadCardId(slot: number): string {
  return `sketch-out-${SKETCH_PAD_ID}-${slot}`
}

export function planSketchCardsAt(
  anchor: { x: number, y: number },
  images: string[],
  // A slot can be `null` — a "hole" left by keepSketchCard vacating a kept
  // card's slot (see VueNodeCanvas.keepSketchCard). A hole is falsy, so it
  // takes the same `reuse = false` branch as "never had a card here".
  existingCardIds: (string | null)[],
): SketchCardPlan[] {
  const step = CARD_SIZE + GAP
  return images.slice(0, MAX_CARDS).map((image, slot) => {
    // Vertical stack: one column, each option below the last.
    const position = { x: anchor.x, y: anchor.y + slot * step }
    const existing = existingCardIds[slot]
    const reuse = !!existing
    const id = reuse ? existing : sketchPadCardId(slot)
    return { id, slot, position, image, reuse }
  })
}
