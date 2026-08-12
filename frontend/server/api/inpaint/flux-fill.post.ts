/**
 * POST /api/inpaint/flux-fill
 *
 * Mask-based inpainting via Black Forest Labs FLUX.1 Fill. The client paints a
 * region, describes it, and the model fills only that region while preserving
 * the rest of the image. Dev tier runs on Replicate (cheap default); pro tier
 * runs on fal (~1.6× cheaper than Replicate's flux-fill-pro).
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
import { assertRateLimit } from '../../lib/rateLimit'

// Dev tier only; pro tier now dispatches to fal (fal-ai/flux-pro/v1/fill).
const MODELS = {
  dev: 'black-forest-labs/flux-fill-dev',
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
  assertRateLimit(event, 'inpaint-flux-fill', 30)
  const body = await readBody<Body>(event)

  if (!body?.image) throw createError({ statusCode: 400, message: 'image is required' })
  if (!body?.mask) throw createError({ statusCode: 400, message: 'mask is required' })

  const tier: 'dev' | 'pro' = body.tier === 'pro' ? 'pro' : 'dev'
  const prompt = (body.prompt ?? '').trim() // empty prompt = generative remove
  const count = Math.max(1, Math.min(4, Math.round(body.count ?? 1)))
  const baseSeed = Number.isFinite(body.seed) ? Math.round(body.seed as number) : Math.floor(Date.now() % 2_000_000_000)
  const seeds = Array.from({ length: count }, (_, i) => baseSeed + i)

  // Pro tier goes to fal (~1.6× cheaper than Replicate's flux-fill-pro: $0.05 vs
  // $0.08). fal's Fill schema uses image_url/mask_url (mask white = inpaint) and
  // has no guidance/steps knobs; output is images[].url. Dev tier stays on
  // Replicate (the cheap default).
  if (tier === 'pro') {
    const outputs = await Promise.all(
      seeds.map(async (seed) => {
        const result = await runFal('fal-ai/flux-pro/v1/fill', {
          image_url: body.image,
          mask_url: body.mask,
          // fal rejects an empty prompt ("Prompt is required"); an empty prompt
          // here means "remove" (see the dev/Replicate path, which allows it), so
          // fall back to a neutral seamless-fill instruction.
          prompt: falFillPrompt(prompt),
          seed,
          output_format: 'png',
        })
        const url = firstFalImageUrl(result)
        if (!url) throw createError({ statusCode: 502, message: 'fal returned no image' })
        return fetchAsDataUrl(url)
      }),
    )
    return { images: outputs, tier, model: 'fal-ai/flux-pro/v1/fill' }
  }

  const token = requireReplicateToken()
  const guidance = body.guidance ?? 30
  const steps = Math.round(body.steps ?? 28)
  const buildInput = (seed: number): Record<string, unknown> => ({
    image: body.image,
    mask: body.mask,
    prompt,
    guidance,
    seed,
    output_format: 'png',
    num_inference_steps: steps,
  })

  // Variations run as independent predictions with distinct seeds, in parallel.
  const outputs = await Promise.all(
    seeds.map(async (seed) => {
      const out = await runReplicate(MODELS.dev, buildInput(seed), token, { timeoutMs: 120_000 })
      const url = firstOutputUrl(out)
      if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
      return fetchAsDataUrl(url)
    }),
  )

  return { images: outputs, tier, model: MODELS.dev }
})
