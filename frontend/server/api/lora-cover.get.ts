/**
 * GET /api/lora-cover?name=<lora filename>
 *
 * Streams the cached cover image for a LoRA (models/loras/<base>.cover.webp),
 * generated on demand by POST /api/lora-cover. 404 if none exists yet.
 *
 * Must be allowlisted in server/middleware/comfyui-proxy.ts (NITRO_API_PATHS).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Strip the extension and reject anything with path-traversal characters. */
function safeBase(name: string): string | null {
  const base = (name || '').replace(/\.safetensors$/i, '')
  return /^[a-zA-Z0-9_-]+$/.test(base) ? base : null
}

export default defineEventHandler(async (event) => {
  const base = safeBase(String(getQuery(event).name ?? ''))
  if (!base) throw createError({ statusCode: 400, message: 'Invalid LoRA name' })

  const lorasDir = path.resolve(process.cwd(), '..', 'models', 'loras')
  for (const ext of ['webp', 'png', 'jpg'] as const) {
    const p = path.join(lorasDir, `${base}.cover.${ext}`)
    try {
      const buf = await fs.readFile(p)
      setHeader(event, 'Content-Type', ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)
      setHeader(event, 'Cache-Control', 'private, max-age=60')
      return buf
    } catch { /* try next extension */ }
  }
  throw createError({ statusCode: 404, message: 'No cover yet' })
})
