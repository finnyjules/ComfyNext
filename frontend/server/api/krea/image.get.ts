/**
 * GET /api/krea/image?url=<krea image url>
 *
 * Streams a Krea-hosted image through the server so the trainer can pull the
 * bytes into a File object (the Krea image CDNs send no CORS header, so the
 * browser can't fetch them directly). Host-allowlisted so this can't be used as
 * a general open proxy / SSRF vector. No auth needed — the image URLs are
 * unguessable but publicly served.
 *
 * Allowlisted in server/middleware/comfyui-proxy.ts via '/api/krea'.
 */

const ALLOWED_HOSTS = new Set([
  'gen.krea.ai',
  'app-uploads.krea.ai',
  'optim-images.krea.ai',
])
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'

export default defineEventHandler(async (event) => {
  const url = getQuery(event).url
  if (typeof url !== 'string' || !url) {
    throw createError({ statusCode: 400, message: 'Missing url' })
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid url' })
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw createError({ statusCode: 403, message: 'Only Krea image hosts are allowed.' })
  }

  const upstream = await fetch(parsed.toString(), { headers: { 'User-Agent': UA } })
  if (!upstream.ok || !upstream.body) {
    throw createError({ statusCode: upstream.status || 502, message: `Image fetch failed (${upstream.status})` })
  }

  setHeader(event, 'Content-Type', upstream.headers.get('content-type') || 'image/png')
  setHeader(event, 'Cache-Control', 'private, max-age=3600')
  return sendStream(event, upstream.body as any)
})
