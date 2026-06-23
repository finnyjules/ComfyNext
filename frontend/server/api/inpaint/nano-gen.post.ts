/**
 * POST /api/inpaint/nano-gen   Body: { prompt, image? }
 *
 * High-quality object generation via Google Nano Banana Pro (Gemini 3 Pro
 * Image) on Replicate — the premium model option for Generate Object.
 *  - No image → text→image (a clean, complete, isolated object).
 *  - With image (a cropped scene region) → instruction edit that paints the
 *    object into that region, matched to the surrounding scene.
 *
 * Returns: { images: string[]; model } — base64 data URLs (CORS-safe), same
 * shape as /api/inpaint/text2img. Under /api/inpaint → already proxy-allowlisted.
 * Helpers auto-imported from server/utils/replicate.ts.
 */
const MODEL = 'google/nano-banana-pro'

interface Body { prompt?: string; image?: string }

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt is required' })

  const input: Record<string, unknown> = { prompt, resolution: '1K', output_format: 'png' }
  if (body?.image) input.image_input = [body.image]

  const out = await runReplicate(MODEL, input, token, { timeoutMs: 120_000 })
  const url = firstOutputUrl(out)
  if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
  return { images: [await fetchAsDataUrl(url)], model: MODEL }
})
