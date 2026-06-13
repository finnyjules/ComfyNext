/**
 * GET /api/voices-local
 *
 * Lists the user's cloned voices in ../models/voices (where the voice-clone
 * flow drops a <voice_id>.json sidecar + a <voice_id>.mp3 preview clip).
 * Powers the "Your voices" section of the Generate-speech voice gallery.
 *
 * Must be allowlisted in server/middleware/comfyui-proxy.ts (NITRO_API_PATHS).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

export default defineEventHandler(async () => {
  const voicesDir = path.resolve(process.cwd(), '..', 'models', 'voices')

  let files: string[] = []
  try {
    files = await fs.readdir(voicesDir)
  } catch {
    return { voices: [] }
  }

  const out: Array<{
    id: string
    name: string
    model: string | null
    previewUrl: string | null
    createdAt: string | null
  }> = []

  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const id = f.slice(0, -'.json'.length)

    let meta: any = {}
    try {
      meta = JSON.parse(await fs.readFile(path.join(voicesDir, f), 'utf8'))
    } catch { continue }

    const voiceId = String(meta.voice_id || id)

    let previewUrl: string | null = null
    try {
      const st = await fs.stat(path.join(voicesDir, `${voiceId}.mp3`))
      previewUrl = `/api/voice-preview-file?id=${encodeURIComponent(voiceId)}&v=${Math.floor(st.mtimeMs)}`
    } catch { /* no preview clip */ }

    out.push({
      id: voiceId,
      name: meta.name || voiceId,
      model: meta.model ?? null,
      previewUrl,
      createdAt: meta.created ?? null,
    })
  }

  out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return { voices: out }
})
