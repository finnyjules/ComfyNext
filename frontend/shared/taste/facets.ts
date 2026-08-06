/**
 * Taste facets v0 — the spike's studio-agnostic taste vocabulary.
 *
 * Spike brief: docs/superpowers/spikes/2026-08-05-executable-brand-kit-spike.md.
 * ~12 dimensions, deliberately imperfect and versionable. Each facet reads as a
 * 0..1 position between two named endpoints (0 = `low`, 1 = `high`).
 *
 * Shared (frontend/shared/) because three consumers read it: the deterministic
 * analyzers (server/utils/tasteAnalyze.ts), the Fable reader
 * (server/api/taste/read.post.ts, which embeds this list in its prompt), and
 * the facet→param mapping (app/lib/taste/mapping.ts).
 */

export const TASTE_FACETS = [
  {
    id: 'warmth',
    label: 'Warmth',
    low: 'cool',
    high: 'warm',
    description: 'Colour temperature of the work overall — icy blues and cyans vs reds, oranges and golds.',
  },
  {
    id: 'valueBias',
    label: 'Value bias',
    low: 'dark',
    high: 'light',
    description: 'Where the tones live — moody near-black grounds vs airy, paper-bright fields.',
  },
  {
    id: 'contrast',
    label: 'Contrast',
    low: 'soft',
    high: 'punchy',
    description: 'How hard lights and darks hit each other — misty tonal closeness vs full-range punch.',
  },
  {
    id: 'saturation',
    label: 'Saturation discipline',
    low: 'muted',
    high: 'vivid',
    description: 'How much chroma is allowed — desaturated, greyed palettes vs full-strength colour.',
  },
  {
    id: 'paletteBreadth',
    label: 'Palette breadth',
    low: 'monochrome',
    high: 'polychrome',
    description: 'How many hues share the frame — one hue family vs a spread across the wheel.',
  },
  {
    id: 'texture',
    label: 'Grain / texture affinity',
    low: 'clean',
    high: 'textured',
    description: 'Appetite for surface — flat digital cleanliness vs grain, noise, paper and tooth.',
  },
  {
    id: 'edgeQuality',
    label: 'Edge quality',
    low: 'crisp',
    high: 'painterly',
    description: 'How forms end — hard vector edges vs soft, blended, out-of-focus transitions.',
  },
  {
    id: 'density',
    label: 'Density',
    low: 'sparse',
    high: 'busy',
    description: 'How full the frame is — generous emptiness vs layered, detailed busyness.',
  },
  {
    id: 'regularity',
    label: 'Geometric regularity',
    low: 'rigid',
    high: 'organic',
    description: 'The geometry\'s temperament — grids, straight lines and exact repeats vs flowing, irregular, hand-drawn form.',
  },
  {
    id: 'finish',
    label: 'Finish',
    low: 'matte',
    high: 'luminous',
    description: 'Surface light response — flat, non-reflective finish vs glow, bloom, gloss and shine.',
  },
  {
    id: 'ornament',
    label: 'Ornament',
    low: 'restrained',
    high: 'decorative',
    description: 'Appetite for embellishment — nothing beyond the necessary vs flourish, pattern and detail for its own sake.',
  },
  {
    id: 'motion',
    label: 'Motion character',
    low: 'snappy',
    high: 'floaty',
    description: 'How things should move — quick, decisive cuts and pops vs slow, drifting, eased motion. Expected to be unreadable from still images; kept in v0 precisely to confirm that blind spot.',
  },
] as const

export type TasteFacet = (typeof TASTE_FACETS)[number]
export type FacetId = TasteFacet['id']

export const FACET_IDS: FacetId[] = TASTE_FACETS.map(f => f.id)

export function facetById(id: string): TasteFacet | undefined {
  return TASTE_FACETS.find(f => f.id === id)
}

/** One facet's measured/judged position. */
export interface FacetReading {
  /** 0..1 between the facet's `low` and `high` endpoints. */
  value: number
  /** 0..1 — how sure the evidence route is. Honest zeros expected (motion from stills). */
  confidence: number
  /** Attribution: which evidence pushed this facet (e.g. 'image-3', or a param path for the observed route). */
  sources?: string[]
}

/**
 * One taste reading — the output shape of every evidence route.
 *
 * `clusters`: when the evidence splits into 2+ distinct registers (e.g. a board
 * holding both a brutalist-mono set and a warm textured set), the top-level
 * facets/avoids describe nothing useful — the per-cluster readings are the
 * result and the top level should be read as advisory only.
 */
export interface TasteReading {
  facets: Partial<Record<FacetId, FacetReading>>
  /** Negative priors — what this taste never does ("no neon", "no gradients on type"). */
  avoids: string[]
  /** Present only when the evidence holds 2+ distinct registers. */
  clusters?: TasteReading[]
  /** Short human name for a cluster reading ("brutalist mono", "warm film"). */
  label?: string
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Build a FacetReading with clamped fields — tolerant-parse helper for model output. */
export function facetReading(value: unknown, confidence: unknown, sources?: string[]): FacetReading {
  const v = typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : 0.5
  const c = typeof confidence === 'number' && Number.isFinite(confidence) ? clamp01(confidence) : 0
  return { value: v, confidence: c, ...(sources?.length ? { sources } : {}) }
}
