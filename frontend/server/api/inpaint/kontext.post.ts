/**
 * POST /api/inpaint/kontext
 *
 * Mask-FREE instruction editing via FLUX.1 Kontext on Replicate. The user gives
 * the whole image plus an instruction ("make the sky a sunset") and the model
 * decides the region itself — the complement to the masked /flux-fill route.
 *
 * Body:
 *   image   string  data URL (or public http URL) of the source image
 *   prompt  string  the edit instruction
 *   count   number  variations (default 1, max 4)
 *   seed    number  base seed; variation i uses seed+i
 *
 * Returns: { images: string[] }  — data URLs (base64), to dodge CORS like /flux-fill.
 */
const MODEL = 'black-forest-labs/flux-kontext-dev'

interface Body { image?: string; prompt?: string; count?: number; seed?: number }

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  if (!body?.image) throw createError({ statusCode: 400, message: 'image is required' })
  const prompt = (body.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt (the edit instruction) is required' })

  const count = Math.max(1, Math.min(4, Math.round(body.count ?? 1)))
  const baseSeed = Number.isFinite(body.seed) ? Math.round(body.seed as number) : Math.floor(Date.now() % 2_000_000_000)

  const seeds = Array.from({ length: count }, (_, i) => baseSeed + i)
  const images = await Promise.all(
    seeds.map(async (seed) => {
      const out = await runReplicate(
        MODEL,
        {
          prompt,
          input_image: body.image,
          aspect_ratio: 'match_input_image',
          output_format: 'png',
          seed,
        },
        token,
        { timeoutMs: 120_000 },
      )
      const url = firstOutputUrl(out)
      if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
      return fetchAsDataUrl(url)
    }),
  )

  return { images, model: MODEL }
})
