/**
 * POST /api/inpaint/remove-bg
 *
 * Cloud background removal via Replicate (851-labs/background-remover) — the
 * "generator" path, higher quality than a local rembg node. Returns the cutout
 * as a transparent PNG so it can replace the image layer in the Compositor.
 *
 * (Lives under inpaint/ alongside flux-fill / text2img so it shares that route
 * group — Nuxt dev only hot-registers new files in already-watched dirs.)
 *
 * Body:
 *   image  string  data URL (or public http URL) of the source image
 *
 * Returns: { image: string }  — a data URL (base64 PNG with alpha), to dodge
 * the Replicate CDN's CORS and let the client re-upload into ComfyUI's input.
 *
 * Helpers (runReplicate/firstOutputUrl/fetchAsDataUrl/requireReplicateToken)
 * are auto-imported from server/utils/replicate.ts.
 */
const MODEL = '851-labs/background-remover'

interface Body {
  image?: string
}

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  if (!body?.image) throw createError({ statusCode: 400, message: 'image is required' })

  const out = await runReplicate(MODEL, {
    image: body.image,
    format: 'png',          // keep alpha
  }, token, { timeoutMs: 120_000 })

  const url = firstOutputUrl(out)
  if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })

  return { image: await fetchAsDataUrl(url), model: MODEL }
})
