/**
 * Versioned price book + graph pricer (spike). Prices a ComfyUI API-format
 * graph in integer credits (1 credit = $0.01). A flat base_render applies once
 * for any graph with a terminal output node; premium provider nodes add their
 * per-node cost on top. Phase 3 moves this table to the Postgres `price_book`.
 */
export const PRICE_BOOK_VERSION = 'spike-v2'

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

/**
 * Per-model costs for the direct provider routes (Surface A) — keyed by the
 * exact slug/app id that spendLog records, so `.data/spend-events.jsonl`
 * joins against this table. USD figures were checked against live rate cards
 * on 2026-08-11; `confidence: 'estimate'` entries MUST be re-verified before
 * hosted launch (page didn't render a price, or the cost is hardware-billed).
 *
 * Credits follow the pricing strategy: ~2× markup on cheap actions, ~1.5× on
 * expensive ones, floor of 1 credit. Per-megapixel models are priced at a
 * typical ~1MP output — resolution-aware pricing is a Phase-3 refinement.
 */
export interface ModelCost {
  usd: number
  credits: number
  confidence: 'verified' | 'estimate'
  note?: string
}

export const MODEL_COSTS: Record<string, ModelCost> = {
  // — image generation —
  'black-forest-labs/flux-schnell': { usd: 0.003, credits: 1, confidence: 'verified' },
  'black-forest-labs/flux-dev': { usd: 0.025, credits: 5, confidence: 'verified' },
  'fal-ai/flux/dev': { usd: 0.025, credits: 5, confidence: 'verified', note: '$0.025/MP, rounded up' },
  'black-forest-labs/flux-2-pro': { usd: 0.03, credits: 6, confidence: 'verified', note: '$0.03/MP — 4MP render is $0.12' },
  'bytedance/seedream-4.5': { usd: 0.04, credits: 8, confidence: 'verified' },
  'krea/krea-2-large': { usd: 0.06, credits: 12, confidence: 'verified' },
  'krea/krea-2-medium': { usd: 0.035, credits: 7, confidence: 'estimate' },
  'fal-ai/nano-banana-pro': { usd: 0.15, credits: 23, confidence: 'verified', note: '1.5× markup — premium tier' },
  'fal-ai/nano-banana-pro/edit': { usd: 0.15, credits: 23, confidence: 'estimate', note: 'assumed same as generate' },
  // — inpaint / edit —
  'black-forest-labs/flux-kontext-dev': { usd: 0.025, credits: 5, confidence: 'estimate', note: 'assumed flux-dev rate' },
  'black-forest-labs/flux-fill-dev': { usd: 0.04, credits: 8, confidence: 'estimate' },
  'fal-ai/flux-pro/v1/fill': { usd: 0.05, credits: 10, confidence: 'verified', note: '$0.05/MP, rounded up' },
  // — segmentation / utility (NOT sub-cent: SAM-2 is $0.022/run) —
  'meta/sam-2': { usd: 0.022, credits: 4, confidence: 'verified', note: 'L40S ~23s/run — Smart Select fires several' },
  '851-labs/background-remover': { usd: 0.0004, credits: 1, confidence: 'verified' },
  // — vector —
  'recraft-ai/recraft-v3-svg': { usd: 0.08, credits: 16, confidence: 'verified', note: 'vector = 2× Recraft raster rate' },
  'recraft-ai/recraft-vectorize': { usd: 0.01, credits: 2, confidence: 'estimate', note: 'hardware-billed, cheap CPU-ish job' },
  // — 3D —
  'fal-ai/hunyuan3d/v2': { usd: 0.48, credits: 72, confidence: 'verified', note: 'textured mesh; white mesh is $0.16' },
  'fal-ai/trellis-2': { usd: 0.3, credits: 45, confidence: 'verified', note: '$0.25–0.35 by resolution' },
  'fal-ai/tripo3d/tripo/v2.5/image-to-3d': { usd: 0.3, credits: 45, confidence: 'estimate', note: 'model page 404s — re-check slug too' },
  'fal-ai/triposr': { usd: 0.02, credits: 4, confidence: 'estimate' },
  // — audio / speech —
  'minimax/speech-02-turbo': { usd: 0.03, credits: 6, confidence: 'verified', note: '$0.06/1k chars — priced per ~500-char clip' },
  // — LLM utility (per-token, pennies) —
  'meta/meta-llama-3-8b-instruct': { usd: 0.001, credits: 1, confidence: 'estimate' },
  'lucataco/qwen2-vl-7b-instruct': { usd: 0.003, credits: 1, confidence: 'estimate' },
  // — training (hardware-billed; matches LoraTrainingNode=600 in the graph table) —
  'ostris/flux-dev-lora-trainer': { usd: 2.5, credits: 600, confidence: 'estimate', note: 'H100 ~15–40min; 600cr keeps parity with graph table' },
  'ostris/sdxl-lora-trainer': { usd: 2, credits: 600, confidence: 'estimate' },
}

/** Cost entry for a spend-event model slug, or null if the model is unpriced. */
export function costForModel(model: string): ModelCost | null {
  return MODEL_COSTS[model] ?? null
}
