/**
 * GET /api/replicate-cover?slug=<owner>/<name>
 *
 * Returns the cover image URL Replicate ships on a model's page. Used by the
 * ModelGallery modal to give each card a real preview instead of a brand
 * wordmark. Server-side because Replicate's API requires a bearer token and
 * isn't CORS-friendly for direct browser calls.
 *
 * Response: `{ url: string | null }`. `null` means the model exists but has
 * no cover image set; the gallery falls back to the brand wordmark in that
 * case.
 */
export default defineEventHandler(async (event) => {
  const slug = String(getQuery(event).slug ?? '').trim()
  if (!slug || !/^[\w.-]+\/[\w.-]+$/.test(slug)) {
    throw createError({ statusCode: 400, message: 'slug must be "owner/name"' })
  }

  const config = useRuntimeConfig()
  const token = (config as any).replicateToken
  if (!token) {
    throw createError({
      statusCode: 500,
      message: 'Replicate token not configured. Set NUXT_REPLICATE_TOKEN.',
    })
  }

  let info: any
  try {
    const r = await fetch(`https://api.replicate.com/v1/models/${slug}`, {
      headers: { Authorization: `Token ${token}` },
    })
    if (r.status === 404) {
      // Surface as 404 so the client can negative-cache it and stop retrying.
      throw createError({ statusCode: 404, message: `model ${slug} not found` })
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw createError({
        statusCode: 502,
        message: `Replicate API ${r.status}: ${text || r.statusText}`,
      })
    }
    info = await r.json()
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({
      statusCode: 502,
      message: `Couldn't reach Replicate: ${err?.message ?? err}`,
    })
  }

  // `cover_image_url` is canonical; some older models only carry a cover via
  // `default_example.output[0]` so we try that as a fallback.
  const cover = typeof info?.cover_image_url === 'string' && info.cover_image_url.length > 0
    ? info.cover_image_url
    : null

  let fallback: string | null = null
  if (!cover) {
    const out = info?.default_example?.output
    if (Array.isArray(out) && typeof out[0] === 'string') fallback = out[0]
    else if (typeof out === 'string') fallback = out
  }

  return { url: cover ?? fallback }
})
