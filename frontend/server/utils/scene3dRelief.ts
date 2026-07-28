// Pure fal relief helpers, shared by /api/scene3d/gen-map and unit tested without any
// network. The route wraps these with runFal().
//
// Two stages, deliberately: image models bake lighting into their output. A brick photo's
// mortar grooves are dark because they are IN SHADOW — desaturating that makes every shadow
// a fake dent, which the renderer then lights and shadows again. Depth models are trained to
// ignore lighting and report actual distance, so the height is genuine.

const RELIEF_PROMPT_SUFFIX = ', flat material sample, top-down orthographic, evenly lit, no shadows, no highlights, fills the frame, seamless texture'

/** Bias the colour-tile prompt toward a flat, evenly lit material swatch. */
export function shapeReliefPrompt(prompt: string): string {
  const p = prompt.trim()
  return p ? `${p}${RELIEF_PROMPT_SUFFIX}` : ''
}

export interface DepthModel {
  app: string
  buildInput(imageUrl: string): Record<string, unknown>
  heightUrlFrom(result: unknown): string | null
}

/** App id, input field name and output path confirmed against fal's LIVE queue-openapi
 *  schema (not from memory) — see the Task 6 report for the curl evidence. A wrong field
 *  would 200 at submit and only fail at result, so this is deliberately pinned exactly to
 *  what the schema says: input { image_url: string }, output { image: { url: string } }. */
export const DEPTH_MODEL: DepthModel = {
  app: 'fal-ai/image-preprocessors/depth-anything/v2',
  buildInput: (imageUrl) => ({ image_url: imageUrl }),
  heightUrlFrom: (r) => {
    const u = (r as { image?: { url?: string } })?.image?.url
    return typeof u === 'string' && u ? u : null
  },
}
