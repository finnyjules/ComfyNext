// Turn a web image URL (a pick from the image-search results) into a ComfyUI
// INPUT-folder file the unified Image node can load. The browser can't fetch
// arbitrary image hosts (CORS), so the bytes come through here and are forwarded
// to ComfyUI's /upload/image — the same landing spot as the Assets-panel copy
// in VueNodeCanvas.ensureInputFilename.
const COMFY_BACKEND = 'http://127.0.0.1:8188'
const MAX_BYTES = 30 * 1024 * 1024 // a full-res press photo is <10MB; 30 is generous

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const url = typeof body?.url === 'string' ? body.url.trim() : ''

  let parsed: URL
  try { parsed = new URL(url) } catch { throw createError({ statusCode: 400, message: 'Invalid image url' }) }
  if (!/^https?:$/.test(parsed.protocol)) throw createError({ statusCode: 400, message: 'Only http(s) urls can be imported' })
  // Never proxy into the local network — the url is external input (a search result).
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) {
    throw createError({ statusCode: 400, message: 'Refusing to fetch a local/private address' })
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ComfyNext image import)', 'Accept': 'image/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  }).catch((err: unknown) => {
    throw createError({ statusCode: 502, message: `Could not download the image: ${err instanceof Error ? err.message : String(err)}` })
  })
  if (!res.ok) throw createError({ statusCode: 502, message: `The image host returned ${res.status}` })

  const mime = (res.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase()
  if (!mime.startsWith('image/')) throw createError({ statusCode: 415, message: `Not an image (${mime || 'unknown type'})` })
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) throw createError({ statusCode: 502, message: 'The image was empty' })
  if (buf.byteLength > MAX_BYTES) throw createError({ statusCode: 413, message: 'Image too large to import (>30MB)' })

  // A readable, collision-safe input filename: sanitized url basename + short stamp.
  const rawBase = decodeURIComponent(parsed.pathname.split('/').pop() || 'image').replace(/\.[a-z0-9]+$/i, '')
  const base = rawBase.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'image'
  const ext = EXT_BY_MIME[mime] ?? '.jpg'
  const filename = `websearch_${base}_${Date.now().toString(36)}${ext}`

  const fd = new FormData()
  fd.append('image', new Blob([buf], { type: mime }), filename)
  fd.append('overwrite', 'true')
  const upload = await fetch(`${COMFY_BACKEND}/upload/image`, { method: 'POST', body: fd }).catch((err: unknown) => {
    throw createError({ statusCode: 502, message: `ComfyUI upload failed: ${err instanceof Error ? err.message : String(err)}` })
  })
  if (!upload.ok) throw createError({ statusCode: 502, message: `ComfyUI upload returned ${upload.status}` })
  const json: any = await upload.json().catch(() => ({}))
  return { name: (json?.name as string) || filename }
})
