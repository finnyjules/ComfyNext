/**
 * POST /api/inpaint/nano-gen   Body: { prompt, image?, images? }
 *
 * High-quality object generation via Google Nano Banana Pro (Gemini 3 Pro
 * Image) on Replicate — the premium model option for Generate Object.
 *  - No image → text→image (a clean, complete, isolated object).
 *  - With `image` (a cropped scene region) → instruction edit that paints the
 *    object into that region, matched to the surrounding scene.
 *  - With `images` (an ordered list) → multi-image edit, e.g. wardrobe try-on
 *    ([person, garment]). `image_input` is an array natively; the prompt refers
 *    to "the first/second image". `images` takes precedence over `image`.
 *
 * Returns: { images: string[]; model } — base64 data URLs (CORS-safe), same
 * shape as /api/inpaint/text2img. Under /api/inpaint → already proxy-allowlisted.
 * Helpers auto-imported from server/utils/replicate.ts.
 */
const MODEL = 'google/nano-banana-pro'

interface Body { prompt?: string; image?: string; images?: string[] }

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt is required' })

  const imageList = (Array.isArray(body?.images) ? body!.images : (body?.image ? [body.image] : []))
    .filter((s): s is string => typeof s === 'string' && s.length > 0)

  const input: Record<string, unknown> = { prompt, resolution: '1K', output_format: 'png' }
  if (imageList.length) input.image_input = imageList

  const out = await runReplicate(MODEL, input, token, { timeoutMs: 120_000 })
  const url = firstOutputUrl(out)
  if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
  return { images: [await fetchAsDataUrl(url)], model: MODEL }
})
