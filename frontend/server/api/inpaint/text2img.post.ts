/**
 * POST /api/inpaint/text2img
 *
 * Text-to-image via Black Forest Labs FLUX.1 [schnell] on Replicate — the cheap,
 * fast (4-step) FLUX tier. Used by the Compositor's Generative Fill when nothing
 * is selected, to conjure a brand-new subject and drop it in as a layer.
 *
 * (Lives under inpaint/ alongside flux-fill so it shares that route group.)
 *
 * Body:
 *   prompt        string  what to generate (required)
 *   aspect_ratio  string  one of flux-dev's supported ratios (default '1:1')
 *   count         number  variations (default 1, max 4)
 *   seed          number  base seed; variation i uses seed+i
 *
 * Returns: { images: string[] } — data URLs (base64), to dodge the Replicate
 * CDN's CORS and let the client re-upload into ComfyUI's input dir.
 *
 * Helpers (runReplicate/firstOutputUrl/fetchAsDataUrl/requireReplicateToken)
 * are auto-imported from server/utils/replicate.ts.
 */
const MODEL = 'black-forest-labs/flux-schnell'
// Opt-in higher tier (taste-wall texture testing): dev renders grain/texture
// schnell's 4-step distillation airbrushes away. Existing callers omit `model`
// and get schnell exactly as before.
// Each tier owns its FULL extra-input set — models validate strictly, so a
// field one model wants can 422 another (the fal-enum lesson, Replicate edition).
const FLUX_EXTRAS = { num_outputs: 1, output_format: 'png', megapixels: '1', go_fast: true }
const MODELS: Record<string, { slug: string; input: Record<string, unknown> }> = {
  'flux-schnell': { slug: MODEL, input: { ...FLUX_EXTRAS, num_inference_steps: 4 } },
  'flux-dev': { slug: 'black-forest-labs/flux-dev', input: { ...FLUX_EXTRAS, num_inference_steps: 28, guidance: 3 } },
  'seedream-4.5': { slug: 'bytedance/seedream-4.5', input: { size: '1K' } },
}

interface Body {
  prompt?: string
  aspect_ratio?: string
  count?: number
  seed?: number
  model?: string
}

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt is required' })

  const aspect_ratio = body?.aspect_ratio || '1:1'
  const count = Math.max(1, Math.min(4, Math.round(body?.count ?? 1)))
  const baseSeed = Number.isFinite(body?.seed) ? Math.round(body!.seed as number) : Math.floor(Date.now() % 2_000_000_000)

  const tier = MODELS[body?.model ?? 'flux-schnell'] ?? MODELS['flux-schnell']!

  const seeds = Array.from({ length: count }, (_, i) => baseSeed + i)
  const outputs = await Promise.all(
    seeds.map(async (seed) => {
      const out = await runReplicate(tier.slug, {
        prompt,
        aspect_ratio,
        seed,
        ...tier.input,            // schnell: 4 steps · dev: 28 + guidance · seedream: size only
      }, token, { timeoutMs: 180_000 })
      const url = firstOutputUrl(out)
      if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
      return fetchAsDataUrl(url)
    }),
  )

  return { images: outputs, model: tier.slug }
})
