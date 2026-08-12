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
import { assertRateLimit } from '../../lib/rateLimit'

const MODEL = 'google/nano-banana-pro'

interface Body { prompt?: string; image?: string; images?: string[]; aspect_ratio?: string }

/**
 * fal failover — Replicate's nano-banana rate-limits under load (E003).
 * fal hosts the same model: text→image at fal-ai/nano-banana-pro, reference
 * edit at fal-ai/nano-banana-pro/edit (image_urls accepts data URIs).
 */
async function runNanoFal(prompt: string, imageList: string[], aspect_ratio?: string): Promise<string> {
  const app = imageList.length ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro'
  const input: Record<string, unknown> = { prompt, num_images: 1, output_format: 'png' }
  if (imageList.length) input.image_urls = imageList
  if (aspect_ratio) input.aspect_ratio = aspect_ratio
  const out = await runFal<{ images?: { url?: string }[] }>(app, input, { pollDeadlineMs: 150_000 })
  const url = out?.images?.[0]?.url
  if (!url) throw new Error('fal returned no image')
  return url
}

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'inpaint-nano-gen', 30)
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt is required' })

  const imageList = (Array.isArray(body?.images) ? body!.images : (body?.image ? [body.image] : []))
    .filter((s): s is string => typeof s === 'string' && s.length > 0)

  const input: Record<string, unknown> = { prompt, resolution: '1K', output_format: 'png' }
  if (imageList.length) input.image_input = imageList
  // Optional aspect ratio (e.g. a keyframe preview matching the shot's ratio).
  if (typeof body?.aspect_ratio === 'string' && body.aspect_ratio) input.aspect_ratio = body.aspect_ratio

  try {
    const out = await runReplicate(MODEL, input, token, { timeoutMs: 120_000 })
    const url = firstOutputUrl(out)
    if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
    return { images: [await fetchAsDataUrl(url)], model: MODEL }
  }
  catch (replicateErr: any) {
    // Failover to fal (same model) — Replicate E003s under demand spikes.
    if (!getFalToken()) throw replicateErr
    try {
      const url = await runNanoFal(prompt, imageList, typeof body?.aspect_ratio === 'string' ? body.aspect_ratio : undefined)
      return { images: [await fetchAsDataUrl(url)], model: `${MODEL} (via fal)` }
    }
    catch (falErr: any) {
      throw createError({
        statusCode: 502,
        message: `replicate: ${replicateErr?.message ?? replicateErr} · fal: ${falErr?.message ?? falErr}`,
      })
    }
  }
})
