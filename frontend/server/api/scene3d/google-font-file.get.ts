/**
 * GET /api/scene3d/google-font-file?family=<name>&weight=<int>
 *
 * Proxies a single Google Fonts family+weight down to a raw, parseable TTF
 * binary. The Google Fonts CSS endpoint (fonts.googleapis.com/css2) serves
 * woff2 to modern browser user-agents but plain truetype to old clients —
 * we send an explicit `curl/8` User-Agent to force the ttf variant, since
 * opentype.js (the 3D Studio's font parser) can't read woff2.
 *
 * In-memory cache keyed `family@weight`, 24h TTL, ~50-entry cap (evict
 * oldest by `at`) — mirrors server/utils/googleCatalog.ts's cache style.
 */
const TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 50
const CURL_UA = 'curl/8'

interface CacheEntry {
  at: number
  buf: Buffer
}

const cache = new Map<string, CacheEntry>()

function evictIfNeeded() {
  if (cache.size < MAX_ENTRIES) return
  let oldestKey: string | null = null
  let oldestAt = Infinity
  for (const [key, entry] of cache) {
    if (entry.at < oldestAt) {
      oldestAt = entry.at
      oldestKey = key
    }
  }
  if (oldestKey) cache.delete(oldestKey)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const family = String(query.family ?? '').trim()
  if (!family) throw createError({ statusCode: 400, message: 'family is required' })

  const weightRaw = query.weight
  const weight = Number.isFinite(Number(weightRaw)) && weightRaw !== undefined && weightRaw !== ''
    ? Math.round(Number(weightRaw))
    : 400

  const cacheKey = `${family}@${weight}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < TTL_MS) {
    setHeader(event, 'Content-Type', 'font/ttf')
    setHeader(event, 'Cache-Control', 'public, max-age=86400, immutable')
    return cached.buf
  }

  // css2 convention: spaces in family names become `+` (not %20). Percent-encode
  // everything else first so a stray `&`/`#` in a family value can't inject
  // extra query params into the upstream request.
  const familyParam = encodeURIComponent(family).replace(/%20/g, '+')
  const cssUrl = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weight}&display=swap`

  let css: string
  try {
    const r = await fetch(cssUrl, { headers: { 'User-Agent': CURL_UA }, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) {
      if (r.status === 400 || r.status === 404) {
        throw createError({ statusCode: 404, message: 'Unknown font family or unsupported weight' })
      }
      throw createError({ statusCode: 502, message: `Google Fonts css2 returned ${r.status}` })
    }
    css = await r.text()
  } catch (err: any) {
    if (err?.statusCode) throw err
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw createError({ statusCode: 502, message: 'Google Fonts timed out' })
    }
    throw createError({ statusCode: 502, message: `Couldn't reach Google Fonts: ${err?.message ?? err}` })
  }

  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\('truetype'\)/)
  const ttfUrl = match?.[1]
  if (!ttfUrl) {
    throw createError({ statusCode: 502, message: 'No truetype font URL found in Google Fonts response' })
  }

  let buf: Buffer
  try {
    const r = await fetch(ttfUrl, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) throw createError({ statusCode: 502, message: `Font binary fetch returned ${r.status}` })
    buf = Buffer.from(await r.arrayBuffer())
  } catch (err: any) {
    if (err?.statusCode) throw err
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw createError({ statusCode: 502, message: 'Google Fonts timed out' })
    }
    throw createError({ statusCode: 502, message: `Couldn't fetch font binary: ${err?.message ?? err}` })
  }

  evictIfNeeded()
  cache.set(cacheKey, { at: Date.now(), buf })

  setHeader(event, 'Content-Type', 'font/ttf')
  setHeader(event, 'Cache-Control', 'public, max-age=86400, immutable')
  return buf
})
