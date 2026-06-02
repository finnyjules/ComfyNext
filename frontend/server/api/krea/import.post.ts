/**
 * POST /api/krea/import
 *
 * Body:    { url: string }            // a Krea moodboard-feed URL or a bare id
 * Header:  x-krea-token: <bearer>     // the user's Krea token (held client-side,
 *                                     // sent per request; never persisted server-side)
 *
 * Calls Krea's moodboards API and returns the gallery's moodboards normalized to
 * what the trainer importer needs: image URLs + Krea's own aesthetic,
 * keywords and palette. Per-image generation prompts are NOT exposed by this
 * endpoint (only generated boards have them, via a separate per-asset call).
 *
 * The token is the user's own session credential. We pass it straight through to
 * Krea and never store or log it. Must be allowlisted in
 * server/middleware/comfyui-proxy.ts (NITRO_API_PREFIXES) — it is via '/api/krea'.
 */

const KREA_API = 'https://forge.krea.ai/api/moodboards'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'

/** Pull the gallery/board UUID out of a moodboard-feed URL, or accept a bare id. */
function extractId(input: string): string | null {
  const s = (input || '').trim()
  const uuid = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return uuid ? uuid[0] : null
}

interface KreaImage { url?: string, width?: number, height?: number, id?: string }
interface KreaBoard {
  id?: string
  name?: string
  visibility?: string
  imageCount?: number
  totalImages?: number
  previewImages?: string[]
  images?: KreaImage[]
  tasteProfile?: string
  positiveKeywords?: string[]
  palette?: { hex: string, weight: number }[]
}

export default defineEventHandler(async (event) => {
  // Tolerate the common copy mistakes: a leading "Bearer "/"Token " scheme, or
  // wrapping quotes pasted along with the value.
  let token = getHeader(event, 'x-krea-token')?.trim() ?? ''
  token = token.replace(/^(Bearer|Token)\s+/i, '').replace(/^["']|["']$/g, '').trim()
  if (!token) {
    throw createError({ statusCode: 400, message: 'Missing Krea token. Paste your token in the importer first.' })
  }

  const body = await readBody(event) as { url?: string }
  const id = extractId(body?.url ?? '')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Could not find a moodboard id in that URL.' })
  }

  const res = await fetch(`${KREA_API}/${id}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA, Accept: 'application/json' },
  })
  if (!res.ok) {
    const upstream = (await res.text().catch(() => '')).slice(0, 300)
    if (res.status === 401 || res.status === 403) {
      throw createError({
        statusCode: 401,
        message: `Krea rejected the token (HTTP ${res.status}). It may be a short-lived session token that expired before loading — grab a fresh one and Load within a few seconds. Krea said: ${upstream || '(no body)'}`,
      })
    }
    throw createError({ statusCode: res.status, message: `Krea API error (HTTP ${res.status}): ${upstream || res.statusText}` })
  }

  const raw = await res.json()
  // The endpoint returns an array of boards (gallery), but tolerate a single object.
  const boards: KreaBoard[] = Array.isArray(raw) ? raw : [raw]

  const moodboards = boards.map((b) => ({
    id: b.id ?? null,
    name: b.name || 'Untitled board',
    visibility: b.visibility ?? null,
    imageCount: b.imageCount ?? b.totalImages ?? (b.images?.length ?? 0),
    aesthetic: b.tasteProfile ?? null,
    positiveKeywords: Array.isArray(b.positiveKeywords) ? b.positiveKeywords : [],
    palette: Array.isArray(b.palette) ? b.palette : [],
    previewImages: Array.isArray(b.previewImages) ? b.previewImages.slice(0, 4) : [],
    images: (b.images ?? [])
      .map((im) => ({ url: im.url, width: im.width ?? null, height: im.height ?? null }))
      .filter((im) => typeof im.url === 'string' && im.url.length > 0),
  }))

  return { moodboards }
})
