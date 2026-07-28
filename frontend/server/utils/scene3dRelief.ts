// Pure fal relief helpers, shared by /api/scene3d/gen-map and unit tested without any
// network. The route wraps these with runFal().
//
// There used to be a second stage here that ran a depth model over the colour tile to
// derive a height map. Removed: depth models report scene DISTANCE, which is nearly flat
// on a material sample photographed straight-on (measured mean gradient ~3.3, far below
// RELIEF_FLAT_THRESHOLD in lib/scene3d/relief.ts) — not the surface relief we want. The UI
// instead runs the colour tile itself through a brightness→height conversion. Do not
// reintroduce a depth pass for this purpose.

const RELIEF_PROMPT_SUFFIX = ', flat material sample, top-down orthographic, evenly lit, no shadows, no highlights, fills the frame, seamless texture'

/** Bias the colour-tile prompt toward a flat, evenly lit material swatch. */
export function shapeReliefPrompt(prompt: string): string {
  const p = prompt.trim()
  return p ? `${p}${RELIEF_PROMPT_SUFFIX}` : ''
}
