/** Keep-sketch-card — the pure property-stripping half of "Keep" (spec
 *  2026-07-10-copy-assistant-declunk-design.md's prompt-bar sketch flow,
 *  Task 5). A pad card pinned via "Keep" must stop looking like a sketch
 *  option (no dashed/loading affordance, no Enhance/Promote footer) and drop
 *  out of the pad's refresh set. This computes the surviving `properties`
 *  bag; the DOM/id-minting side (VueNodeCanvas.keepSketchCard) is imperative
 *  canvas plumbing and stays there. */
const SKETCH_PROPERTY_KEYS = [
  'sketchOutput',
  'sketchSourceId',
  'sketchSlot',
  'sketchLoading',
  'sketchPrompt',
  'sketchSeed',
] as const

export function stripSketchProperties(properties: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const p = { ...(properties ?? {}) }
  for (const key of SKETCH_PROPERTY_KEYS) delete p[key]
  return p
}

/** Vacate a kept card's pad slot as a HOLE — `cardIds[slot] = null` — WITHOUT
 *  changing the array's length. `planSketchCardsAt` reuses ids positionally
 *  (`id = existingCardIds[slot] || sketchPadCardId(slot)`); a hole is falsy,
 *  so the freed slot takes the "no reuse" branch and gets a fresh deterministic
 *  card on the next sketch. Regression guard: the old `.filter(id => id !==
 *  cardId)` approach shifted every LATER slot's id down by one, corrupting the
 *  positional mapping for slots after the kept one. No-op (returns the input
 *  array unchanged) if `slot` is out of range or no longer holds `cardId` —
 *  e.g. a stale event after the pad already moved on. */
export function vacateSketchSlot(
  cardIds: (string | null)[],
  slot: number,
  cardId: string,
): (string | null)[] {
  if (slot < 0 || slot >= cardIds.length) return cardIds
  if (cardIds[slot] !== cardId) return cardIds
  const next = [...cardIds]
  next[slot] = null
  return next
}
