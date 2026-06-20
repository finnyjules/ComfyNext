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
import { parseKreaBoard } from './parse'

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

export default defineEventHandler(async (event) => {
  const url = String(getQuery(event).url ?? '').trim()
  if (!KREA_MOODBOARD_URL.test(url)) {
    throw createError({ statusCode: 400, message: 'Paste a krea.ai moodboard URL (https://www.krea.ai/moodboard-feed/…).' })
  }

  const html = await fetchHtml(url)

  // Scope extraction to the board's OWN images:[…] array — NOT a page-wide URL
  // scrape, which would also pull in the relatedMoodboards thumbnails (other
  // boards in the feed) and yield extra images that aren't in the moodboard.
  const board = parseKreaBoard(html)
  if (!board) {
    throw createError({
      statusCode: 422,
      message: 'No images found on that page. It may be a private board (only public/browse boards can be fetched by URL) — use “paste JSON” for your own boards.',
    })
  }

  const idMatch = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)

  return {
    moodboards: [{
      id: idMatch ? idMatch[0] : null,
      ...board,
    }],
  }
})
