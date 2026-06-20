/**
 * Pure parsing of a public Krea moodboard-feed page's inlined RSC payload.
 *
 * Kept free of Nuxt/nitro globals (defineEventHandler, createError, getQuery) so
 * it can be unit-tested directly against a saved payload fixture — board.get.ts
 * imports it and only handles fetching + HTTP error mapping.
 */

export interface KreaImage {
  url: string
  width: number | null
  height: number | null
}

export interface KreaBoardParsed {
  name: string
  imageCount: number
  loadedImages: number
  aesthetic: string | null
  positiveKeywords: string[]
  previewImages: string[]
  images: KreaImage[]
}

/** Extract `key:"value"` from the RSC stream, JSON-unescaping the captured string. */
function extractString(html: string, key: string): string | null {
  const m = html.match(new RegExp(`${key}:"((?:[^"\\\\]|\\\\.)*)"`))
  if (!m) return null
  try { return JSON.parse(`"${m[1]}"`) } catch { return m[1] || null }
}

/** JSON-unescape a captured string value (e.g. `&` → `&`); pass through on failure. */
function unescapeString(raw: string): string {
  try { return JSON.parse(`"${raw}"`) } catch { return raw }
}

/**
 * Pull the board's images from its OWN `images:[…]` array only.
 *
 * A moodboard-feed page also inlines `relatedMoodboards:[{…,imageUrl:"…"}]` —
 * thumbnails of OTHER boards in the feed. A page-wide URL scrape sweeps those in
 * too (the "extra images" bug), so we scope strictly to the board array.
 *
 * Structural invariants of the payload this relies on:
 *  - The target board is the first (and only) `images:[…]` in the page; related
 *    boards expose a singular `imageUrl:"…"` field, never an `images:[` array.
 *  - Image objects hold a clean URL string and numeric width/height — no `]` —
 *    so the first `]` terminates the array.
 */
export function extractBoardImages(html: string): KreaImage[] {
  const arr = html.match(/images:\[([^\]]*)\]/)
  if (!arr) return []
  const objs = arr[1]!.match(/\{[^{}]*\}/g) || []
  const out: KreaImage[] = []
  for (const o of objs) {
    const u = o.match(/url:"((?:[^"\\]|\\.)*)"/)
    if (!u) continue
    const w = o.match(/width:(\d+)/)
    const h = o.match(/height:(\d+)/)
    out.push({
      url: unescapeString(u[1]!),
      width: w ? Number(w[1]) : null,
      height: h ? Number(h[1]) : null,
    })
  }
  return out
}

/**
 * Parse a board's name, aesthetic, keywords and (scoped) images out of the page
 * HTML. Returns null when no board images could be found (e.g. a private board,
 * whose page doesn't inline the array).
 */
export function parseKreaBoard(html: string): KreaBoardParsed | null {
  const images = extractBoardImages(html)
  if (!images.length) return null

  const name = extractString(html, 'styleName') || extractString(html, ',name') || 'Krea moodboard'
  const aesthetic = extractString(html, 'tasteProfile')
  let positiveKeywords: string[] = []
  const km = html.match(/keywords:(\[(?:"(?:[^"\\]|\\.)*"(?:,)?)*\])/)
  if (km) { try { const a = JSON.parse(km[1]!); if (Array.isArray(a)) positiveKeywords = a } catch { /* ignore */ } }

  return {
    name,
    // The board's images array is ground truth. Krea's separate `imageCount`
    // field can be stale (e.g. says 8 for a 16-image board), so we don't use it.
    imageCount: images.length,
    loadedImages: images.length,
    aesthetic: aesthetic || null,
    positiveKeywords,
    previewImages: images.slice(0, 4).map((im) => im.url),
    images,
  }
}
