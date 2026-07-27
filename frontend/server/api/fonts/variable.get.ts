/**
 * GET /api/fonts/variable?id=<catalog id>
 *
 * Serves the VARIABLE ttf for a catalogued family, for Vector Type Studio.
 *
 * This is a different SOURCE from /api/scene3d/google-font-file, not a
 * parameter tweak: fonts.googleapis.com/css2 never hands back the variable
 * file (curl UA → static per-weight ttf cuts; browser UA → woff2 that is still
 * a single static instance, split by unicode-range). The variable ttfs live in
 * the google/fonts repo, where the axis list is baked into the filename.
 *
 * It is deliberately NOT a general proxy. The only input is a catalog id; the
 * upstream path comes from `VARIABLE_FONTS_BY_ID[id].ttfPath`, a curated
 * constant. A caller cannot make this route fetch a URL of its choosing.
 *
 * In-memory cache keyed by id, 24h TTL, ~50-entry cap (evict oldest by `at`) —
 * mirrors server/api/scene3d/google-font-file.get.ts.
 */
import { VARIABLE_FONTS_BY_ID } from '~/data/variable-fonts'

const TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 50
const REPO_BASE = 'https://raw.githubusercontent.com/google/fonts/main/'

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

/** Repo path → absolute raw URL. Segment-wise encoding, because the filename
 *  legitimately contains `[`, `]` and `,` (the axis list) which must survive. */
function repoUrl(ttfPath: string): string {
  return REPO_BASE + ttfPath.split('/').map(encodeURIComponent).join('/')
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = String(query.id ?? '').trim()
  if (!id) throw createError({ statusCode: 400, message: 'id is required' })

  const entry = VARIABLE_FONTS_BY_ID[id]
  if (!entry?.ttfPath) {
    throw createError({ statusCode: 404, message: `Unknown variable font id: ${id}` })
  }

  const cached = cache.get(id)
  if (cached && Date.now() - cached.at < TTL_MS) {
    setHeader(event, 'Content-Type', 'font/ttf')
    setHeader(event, 'Cache-Control', 'public, max-age=86400, immutable')
    return cached.buf
  }

  let buf: Buffer
  try {
    const r = await fetch(repoUrl(entry.ttfPath), { signal: AbortSignal.timeout(15_000) })
    if (!r.ok) {
      if (r.status === 404) {
        // The catalog path has gone stale (renamed/removed upstream) — that is
        // a catalog bug, not a bad request, but there is no font to serve.
        throw createError({ statusCode: 404, message: `No variable font file at ${entry.ttfPath}` })
      }
      throw createError({ statusCode: 502, message: `Google Fonts repo returned ${r.status}` })
    }
    buf = Buffer.from(await r.arrayBuffer())
  } catch (err: any) {
    if (err?.statusCode) throw err
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw createError({ statusCode: 502, message: 'Google Fonts repo timed out' })
    }
    throw createError({ statusCode: 502, message: `Couldn't fetch variable font: ${err?.message ?? err}` })
  }

  evictIfNeeded()
  cache.set(id, { at: Date.now(), buf })

  setHeader(event, 'Content-Type', 'font/ttf')
  setHeader(event, 'Cache-Control', 'public, max-age=86400, immutable')
  return buf
})
