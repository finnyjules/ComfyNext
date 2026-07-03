// Web image search for the canvas agent's `searchImages` command. Sibling of
// vibe.post.ts: thin stateless proxy, user-supplied key (Brave Search API this
// time), no SDK. The browser can't call Brave directly (CORS + key exposure);
// this normalizes the payload down to what the picker grid needs.
import { normalizeBraveImageResults, probeImageDimensions } from '~~/server/utils/imageSearch'

const BRAVE_IMAGES = 'https://api.search.brave.com/res/v1/images/search'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiKey, query, count } = body || {}

  if (!apiKey || typeof apiKey !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing Brave Search API key' })
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw createError({ statusCode: 400, message: 'Missing search query' })
  }
  const n = Math.min(Math.max(Number(count) || 24, 1), 50)

  const params = new URLSearchParams({ q: query.trim(), count: String(n), safesearch: 'strict' })
  const res = await fetch(`${BRAVE_IMAGES}?${params}`, {
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
  }).catch((err: unknown) => {
    throw createError({ statusCode: 502, message: `Could not reach Brave Search: ${err instanceof Error ? err.message : String(err)}` })
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[image-search] Brave error:', res.status, errText.slice(0, 500))
    const message = res.status === 401 || res.status === 403 || res.status === 422
      ? 'Brave rejected the API key — check it in Settings → AI.'
      : res.status === 429
        ? 'Brave rate limit hit — try again in a moment.'
        : `Brave Search error: ${res.status}`
    throw createError({ statusCode: res.status, message })
  }

  const data = await res.json().catch(() => null)
  const results = normalizeBraveImageResults(data)
  // Brave doesn't always send the original dimensions, and the picker uses them
  // to badge + de-prioritize thumbnail-grade images ("the import is low quality").
  // Probe the gaps in parallel — header-only ranged fetches, best-effort.
  await Promise.all(results.map(async (r) => {
    if (r.width && r.height) return
    const d = await probeImageDimensions(r.imageUrl)
    if (d) { r.width = d.width; r.height = d.height }
  }))
  return { results }
})
