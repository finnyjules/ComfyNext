/**
 * Image-generation model catalog — single source of truth for the
 * "Generate an image" node's UI side. The Python side mirrors this
 * (see comfy_api_nodes/image_models.py) and is responsible for the
 * actual Replicate calls.
 *
 * Adding a model: append an entry here AND a matching one in image_models.py.
 * Keep `id` identical across the two — it's the dispatch key.
 */

export type ImageModelTag =
  | 'flagship'      // best-in-class generalist
  | 'fast'          // optimized for speed
  | 'cheap'         // ≤ $0.01 / image
  | 'typography'    // reliable text rendering
  | 'design'        // posters/layouts/graphic design
  | 'svg'           // vector output
  | 'photoreal'     // photography-grade realism
  | 'cinematic'     // film-like aesthetic
  | 'anime'         // anime/illustration
  | 'open-source'   // SD-family / open weights
  | '4k'            // native high-resolution
  | 'multi-image'   // accepts multiple reference images

export const TAG_LABELS: Record<ImageModelTag, string> = {
  'flagship':    'Flagship',
  'fast':        'Fast',
  'cheap':       'Cheap',
  'typography':  'Typography',
  'design':      'Design',
  'svg':         'Vector / SVG',
  'photoreal':   'Photoreal',
  'cinematic':   'Cinematic',
  'anime':       'Anime',
  'open-source': 'Open-source',
  '4k':          '4K native',
  'multi-image': 'Multi-image',
}

export type ImageModelBrand =
  | 'BFL' | 'Google' | 'OpenAI' | 'ByteDance' | 'Ideogram'
  | 'Recraft' | 'Stability AI' | 'Alibaba' | 'Tencent' | 'xAI'
  | 'Pruna' | 'Meta' | 'Other'

export interface ImageModelAdvancedField {
  name: string
  type: 'integer' | 'float' | 'boolean' | 'select' | 'string'
  label: string
  default: any
  description?: string
  options?: string[]      // select only
  min?: number            // integer/float
  max?: number
  step?: number
}

export interface ImageModel {
  id: string                       // dispatch key — matches Python side
  label: string                    // 'Flux 1.1 Pro'
  brand: ImageModelBrand
  replicateSlug: string            // 'black-forest-labs/flux-1.1-pro'
  pitch: string                    // one-line "best for" hook
  description?: string             // longer body for the detail pane
  tags: ImageModelTag[]
  pricePerImage: number | null     // USD; null = varies / unknown
  aspectRatios: string[]           // model-specific options for the gallery
  defaultAspectRatio: string
  thumb?: string                   // preview image URL (relative or absolute)
  advanced: ImageModelAdvancedField[]
}

/**
 * Round 1 catalog — the two models the legacy GenerateImageNode shipped with.
 * Subsequent commits fan this out across the whole Replicate text-to-image
 * collection. See the research task that's compiling the rest.
 */
export const IMAGE_MODELS: ImageModel[] = [
  {
    id: 'flux-1.1-pro',
    label: 'Flux 1.1 Pro',
    brand: 'BFL',
    replicateSlug: 'black-forest-labs/flux-1.1-pro',
    pitch: 'Top general-purpose quality. The reliable default.',
    description:
      'BFL\'s flagship Pro tier — strong photoreal output, good prompt adherence, '
      + 'sane defaults. Use it when you don\'t know what else to pick.',
    tags: ['flagship', 'photoreal'],
    pricePerImage: 0.04,
    aspectRatios: ['1:1', '16:9', '3:2', '2:3', '4:5', '5:4', '3:4', '4:3', '9:16'],
    defaultAspectRatio: '1:1',
    advanced: [
      {
        name: 'safety_tolerance',
        type: 'integer',
        label: 'Safety tolerance',
        default: 2,
        min: 1, max: 6,
        description: '1 is the strictest; 6 is the most permissive.',
      },
      {
        name: 'prompt_upsampling',
        type: 'boolean',
        label: 'Let model rewrite prompt',
        default: false,
        description: 'BFL\'s "magic prompt" — expands your prompt server-side.',
      },
      {
        name: 'output_format',
        type: 'select',
        label: 'Output format',
        default: 'png',
        options: ['png', 'jpg'],
      },
    ],
  },
  {
    id: 'ideogram-v3-turbo',
    label: 'Ideogram V3 Turbo',
    brand: 'Ideogram',
    replicateSlug: 'ideogram-ai/ideogram-v3-turbo',
    pitch: 'Best-in-class typography. Reads like a graphic designer wrote it.',
    description:
      'Ideogram\'s fastest V3 tier. Use when the image needs to contain readable text '
      + '— posters, signage, logos, UI mocks. Slightly less photoreal than Flux Pro.',
    tags: ['typography', 'design', 'fast'],
    pricePerImage: 0.03,
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '16:10', '10:16', '1:3', '3:1'],
    defaultAspectRatio: '1:1',
    advanced: [
      {
        name: 'style_type',
        type: 'select',
        label: 'Style override',
        default: 'None',
        options: ['None', 'Auto', 'General', 'Realistic', 'Design'],
        description: '"None" lets the model decide the best style for your prompt.',
      },
      {
        name: 'magic_prompt',
        type: 'select',
        label: 'Magic prompt',
        default: 'Auto',
        options: ['Auto', 'On', 'Off'],
        description: 'Ideogram-side prompt expansion. Auto lets it choose.',
      },
    ],
  },
]

export const IMAGE_MODELS_BY_ID: Record<string, ImageModel> = Object.fromEntries(
  IMAGE_MODELS.map(m => [m.id, m]),
)

/** Set of every aspect ratio across all models — used by the shared aspect
 *  ratio combo on the node so any model's preferred ratio is available. The
 *  backend remaps incompatible ratios to a sensible per-model fallback. */
export const ALL_ASPECT_RATIOS: string[] = Array.from(
  new Set(IMAGE_MODELS.flatMap(m => m.aspectRatios)),
).sort((a, b) => {
  // 1:1 always first, then by descending first number.
  if (a === '1:1') return -1
  if (b === '1:1') return 1
  return a.localeCompare(b, undefined, { numeric: true })
})

/** Tags that have at least one model — drives the filter chip row in the
 *  gallery so we don't show empty filter buckets. */
export function activeTagsInCatalog(): ImageModelTag[] {
  const seen = new Set<ImageModelTag>()
  for (const m of IMAGE_MODELS) for (const t of m.tags) seen.add(t)
  return (Object.keys(TAG_LABELS) as ImageModelTag[]).filter(t => seen.has(t))
}
