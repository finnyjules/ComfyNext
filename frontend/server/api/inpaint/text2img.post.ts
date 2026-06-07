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

interface Body {
  prompt?: string
  aspect_ratio?: string
  count?: number
  seed?: number
}

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt is required' })

  const aspect_ratio = body?.aspect_ratio || '1:1'
  const count = Math.max(1, Math.min(4, Math.round(body?.count ?? 1)))
  const baseSeed = Number.isFinite(body?.seed) ? Math.round(body!.seed as number) : Math.floor(Date.now() % 2_000_000_000)

  const seeds = Array.from({ length: count }, (_, i) => baseSeed + i)
  const outputs = await Promise.all(
    seeds.map(async (seed) => {
      const out = await runReplicate(MODEL, {
        prompt,
        aspect_ratio,
        num_outputs: 1,
        num_inference_steps: 4,   // schnell: 1–4 (guidance-distilled, no guidance param)
        output_format: 'png',
        megapixels: '1',
        go_fast: true,
        seed,
      }, token, { timeoutMs: 120_000 })
      const url = firstOutputUrl(out)
      if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
      return fetchAsDataUrl(url)
    }),
  )

  return { images: outputs, model: MODEL }
})
