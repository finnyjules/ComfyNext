/**
 * Versioned price book + graph pricer (spike). Prices a ComfyUI API-format
 * graph in integer credits (1 credit = $0.01). A flat base_render applies once
 * for any graph with a terminal output node; premium provider nodes add their
 * per-node cost on top. Phase 3 moves this table to the Postgres `price_book`.
 */
export const PRICE_BOOK_VERSION = 'spike-v1'

const BASE_RENDER_CREDITS = 1

// Terminal output nodes that mean "the GPU produced a deliverable" → base render.
const OUTPUT_CLASS_TYPES = new Set([
  'SaveImage', 'PreviewImage', 'SaveVideo', 'VHS_VideoCombine', 'SaveAudio',
])

// Premium provider actions, from the costs doc. Flat per-node for the spike.
const PREMIUM_ACTION_CREDITS: Record<string, number> = {
  EditImageNode: 12,       // Nano-Banana-2 edit
  GenerateVideoNode: 60,   // mid video / 5s
  FilmShotNode: 160,       // Seedance 720p / 5s
  LipSyncNode: 30,
  LoraTrainingNode: 600,
}

export interface GraphPrice {
  credits: number
  version: string
  breakdown: { action: string; credits: number }[]
}

export function priceGraph(prompt: Record<string, { class_type: string; inputs?: unknown }>): GraphPrice {
  const breakdown: { action: string; credits: number }[] = []
  let hasOutput = false

  // Sort node ids for order-independent, deterministic breakdown.
  for (const id of Object.keys(prompt).sort()) {
    const ct = prompt[id]?.class_type
    if (!ct) continue
    if (OUTPUT_CLASS_TYPES.has(ct)) hasOutput = true
    const premium = PREMIUM_ACTION_CREDITS[ct]
    if (premium) breakdown.push({ action: ct, credits: premium })
  }

  const out: { action: string; credits: number }[] = []
  if (hasOutput) out.push({ action: 'base_render', credits: BASE_RENDER_CREDITS })
  out.push(...breakdown)

  return {
    credits: out.reduce((s, b) => s + b.credits, 0),
    version: PRICE_BOOK_VERSION,
    breakdown: out,
  }
}
