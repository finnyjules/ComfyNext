/**
 * POST /api/inpaint/flux-fill
 *
 * Mask-based inpainting via Black Forest Labs FLUX.1 Fill on Replicate. The
 * client paints a region, describes it, and the model fills only that region
 * while preserving the rest of the image.
 *
 * Body:
 *   image    string  data URL (or public http URL) of the source image
 *   mask     string  data URL of the mask — WHITE = inpaint, BLACK = keep
 *   prompt   string  what to put in the masked area (empty = generative remove)
 *   tier     'dev' | 'pro'   model tier (default 'dev', the cheap one)
 *   count    number  how many variations to generate in parallel (default 1, max 4)
 *   guidance number  prompt adherence
 *   steps    number  inference steps
 *   seed     number  base seed; variation i uses seed+i for reproducible spread
 *
 * Returns: { images: string[] }  — each a data URL (base64), to dodge CORS on
 * the Replicate CDN and let the client re-upload into ComfyUI's input dir.
 *
 * Mirrors the create-then-poll convention of the /api/vector/* routes
 * (runReplicate/firstOutputUrl/requireReplicateToken are auto-imported from
 * server/utils/replicate.ts).
 */
const MODELS = {
  dev: 'black-forest-labs/flux-fill-dev',
  pro: 'black-forest-labs/flux-fill-pro',
} as const

interface Body {
  image?: string
  mask?: string
  prompt?: string
  tier?: 'dev' | 'pro'
  count?: number
  guidance?: number
  steps?: number
  seed?: number
}

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  if (!body?.image) throw createError({ statusCode: 400, message: 'image is required' })
  if (!body?.mask) throw createError({ statusCode: 400, message: 'mask is required' })

  const tier: 'dev' | 'pro' = body.tier === 'pro' ? 'pro' : 'dev'
  const model = MODELS[tier]
  const prompt = (body.prompt ?? '').trim() // empty prompt = generative remove
  const count = Math.max(1, Math.min(4, Math.round(body.count ?? 1)))
  const guidance = body.guidance ?? (tier === 'pro' ? 60 : 30)
  const steps = Math.round(body.steps ?? (tier === 'pro' ? 50 : 28))
  const baseSeed = Number.isFinite(body.seed) ? Math.round(body.seed as number) : Math.floor(Date.now() % 2_000_000_000)

  // dev exposes `num_inference_steps`; pro exposes `steps`. Keep to documented
  // fields only — Replicate rejects unknown input keys.
  const buildInput = (seed: number): Record<string, unknown> => {
    const common: Record<string, unknown> = {
      image: body.image,
      mask: body.mask,
      prompt,
      guidance,
      seed,
      output_format: 'png',
    }
    if (tier === 'pro') common.steps = steps
    else common.num_inference_steps = steps
    return common
  }

  // Variations run as independent predictions with distinct seeds, in parallel.
  const seeds = Array.from({ length: count }, (_, i) => baseSeed + i)
  const outputs = await Promise.all(
    seeds.map(async (seed) => {
      const out = await runReplicate(model, buildInput(seed), token, { timeoutMs: 120_000 })
      const url = firstOutputUrl(out)
      if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
      return fetchAsDataUrl(url)
    }),
  )

  return { images: outputs, tier, model }
})
