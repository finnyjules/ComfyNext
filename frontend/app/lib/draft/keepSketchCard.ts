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
