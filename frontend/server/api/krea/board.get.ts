/**
 * GET /api/krea/board?url=<krea moodboard-feed URL>
 *
 * Scrapes a PUBLIC Krea moodboard ("browse"/community board) straight from its
 * server-rendered page — no auth required. Public board pages inline everything
 * we need in the Next.js RSC payload: image URLs, the board name, Krea's
 * aesthetic and keywords. (Private/owned boards aren't public, so their pages
 * don't carry this — those still go through the paste-JSON path.)
 *
 * The RSC payload uses JS-object-literal syntax (unquoted keys), not JSON, so we
 * extract fields with targeted regex and JSON-unescape the string values.
 *
 * Allowlisted in server/middleware/comfyui-proxy.ts via '/api/krea'.
 */

import https from 'node:https'
import zlib from 'node:zlib'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const KREA_MOODBOARD_URL = /^https?:\/\/(www\.)?krea\.ai\/moodboard-feed\//i

/**
 * Fetch the page HTML via node:https (not global fetch): Krea's pages send
 * response headers larger than undici's 16 KB default, which makes fetch throw
 * UND_ERR_HEADERS_OVERFLOW. node:https lets us raise maxHeaderSize. We also
 * decompress manually since we're below the fetch layer.
 */
function fetchHtml(url: string, redirects = 4): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Encoding': 'gzip, deflate, br' },
      maxHeaderSize: 1 << 20,
    }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        resolve(fetchHtml(new URL(res.headers.location, url).toString(), redirects - 1))
        return
      }
      if (status !== 200) { res.resume(); reject(createError({ statusCode: status, message: `Krea page returned HTTP ${status}` })); return }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c as Buffer))
      res.on('end', () => {
        try {
          let buf = Buffer.concat(chunks)
          const enc = String(res.headers['content-encoding'] || '').toLowerCase()
          if (enc === 'gzip') buf = zlib.gunzipSync(buf)
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf)
          else if (enc === 'deflate') buf = zlib.inflateSync(buf)
          resolve(buf.toString('utf8'))
        } catch (e: any) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Krea page request timed out')))
  })
}

/** Extract `key:"value"` from the RSC stream, JSON-unescaping the captured string. */
function extractString(html: string, key: string): string | null {
  const m = html.match(new RegExp(`${key}:"((?:[^"\\\\]|\\\\.)*)"`))
  if (!m) return null
  try { return JSON.parse(`"${m[1]}"`) } catch { return m[1] || null }
}

export default defineEventHandler(async (event) => {
  const url = String(getQuery(event).url ?? '').trim()
  if (!KREA_MOODBOARD_URL.test(url)) {
    throw createError({ statusCode: 400, message: 'Paste a krea.ai moodboard URL (https://www.krea.ai/moodboard-feed/…).' })
  }

  const html = await fetchHtml(url)

  // Image URLs (full-res originals; skip the optim-images thumbnails). Dedup,
  // preserve first-seen order.
  const matches = html.match(
    /https:\/\/(?:gen\.krea\.ai\/images\/[a-f0-9-]+\.png|app-uploads\.krea\.ai\/[^\s"'\\]+\.(?:png|jpe?g|webp))/gi,
  ) || []
  const seen = new Set<string>()
  const images: string[] = []
  for (const u of matches) { if (!seen.has(u)) { seen.add(u); images.push(u) } }

  if (!images.length) {
    throw createError({
      statusCode: 422,
      message: 'No images found on that page. It may be a private board (only public/browse boards can be fetched by URL) — use “paste JSON” for your own boards.',
    })
  }

  const name = extractString(html, 'styleName') || extractString(html, ',name') || 'Krea moodboard'
  const aesthetic = extractString(html, 'tasteProfile')
  let positiveKeywords: string[] = []
  const km = html.match(/keywords:(\[(?:"(?:[^"\\]|\\.)*"(?:,)?)*\])/)
  if (km) { try { const arr = JSON.parse(km[1]); if (Array.isArray(arr)) positiveKeywords = arr } catch { /* ignore */ } }

  // imageCount from the payload tells us if the page only inlined a subset.
  let totalImages = images.length
  const cm = html.match(/imageCount:(\d+)/)
  if (cm) totalImages = Number(cm[1]) || images.length

  const idMatch = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)

  return {
    moodboards: [{
      id: idMatch ? idMatch[0] : null,
      name,
      imageCount: totalImages,
      loadedImages: images.length, // how many we could actually scrape from the page
      aesthetic: aesthetic || null,
      positiveKeywords,
      previewImages: images.slice(0, 4),
      images: images.map((u) => ({ url: u, width: null, height: null })),
    }],
  }
})
