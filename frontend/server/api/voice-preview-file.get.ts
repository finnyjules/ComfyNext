/**
 * GET /api/voice-preview-file?id=<voice_id>
 *
 * Streams the preview clip for a cloned voice (../models/voices/<id>.mp3),
 * downloaded by /api/voice-clone/status. 404 if none exists.
 *
 * Must be allowlisted in server/middleware/comfyui-proxy.ts (NITRO_API_PATHS).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Reject anything with path-traversal characters. */
function safeId(id: string): string | null {
  return /^[a-zA-Z0-9_-]+$/.test(id || '') ? id : null
}

export default defineEventHandler(async (event) => {
  const id = safeId(String(getQuery(event).id ?? ''))
  if (!id) throw createError({ statusCode: 400, message: 'Invalid voice id' })

  const voicesDir = path.resolve(process.cwd(), '..', 'models', 'voices')
  try {
    const buf = await fs.readFile(path.join(voicesDir, `${id}.mp3`))
    setHeader(event, 'Content-Type', 'audio/mpeg')
    setHeader(event, 'Cache-Control', 'private, max-age=60')
    return buf
  } catch {
    throw createError({ statusCode: 404, message: 'No preview clip' })
  }
})
