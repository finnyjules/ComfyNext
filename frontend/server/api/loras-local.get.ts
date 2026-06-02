/**
 * GET /api/loras-local
 *
 * Lists the LoRAs in ../models/loras (where cloud training drops the trained
 * .safetensors + a .json provenance sidecar). Returns name, base model,
 * provider, the public CDN url (if any), size and date so the LoRA panel can
 * show a "Your LoRAs" section alongside the curated library.
 *
 * Note: must be allowlisted in server/middleware/comfyui-proxy.ts
 * (NITRO_API_PATHS) — otherwise /api/* is proxied to ComfyUI and 404s here.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

export default defineEventHandler(async () => {
  const lorasDir = path.resolve(process.cwd(), '..', 'models', 'loras')

  let files: string[] = []
  try {
    files = await fs.readdir(lorasDir)
  } catch {
    return { loras: [] }
  }

  const out: Array<{
    filename: string
    name: string
    baseModel: string | null
    provider: string
    trigger: string | null
    aesthetic: string | null
    url: string | null
    coverUrl: string | null
    canGenerateCover: boolean
    trainedOn: string | null
    sizeBytes: number | null
  }> = []

  for (const f of files) {
    if (!f.endsWith('.safetensors')) continue
    const base = f.slice(0, -'.safetensors'.length)

    let meta: any = {}
    try {
      meta = JSON.parse(await fs.readFile(path.join(lorasDir, `${base}.json`), 'utf8'))
    } catch { /* no sidecar */ }

    let trainedOn: string | null = meta.trained_on ?? null
    let sizeBytes: number | null = null
    try {
      const st = await fs.stat(path.join(lorasDir, f))
      sizeBytes = st.size
      if (!trainedOn) trainedOn = st.mtime.toISOString()
    } catch { /* ignore */ }

    // Cover thumbnail, if one's been generated (POST /api/lora-cover). Cache-bust
    // by mtime so a regenerated cover refreshes in the gallery.
    let coverUrl: string | null = null
    for (const ext of ['webp', 'png', 'jpg']) {
      try {
        const st = await fs.stat(path.join(lorasDir, `${base}.cover.${ext}`))
        coverUrl = `/api/lora-cover?name=${encodeURIComponent(f)}&v=${Math.floor(st.mtimeMs)}`
        break
      } catch { /* no cover of this ext */ }
    }

    out.push({
      filename: f,
      name: meta.name || base,
      baseModel: meta.base_model ?? null,
      provider: meta.provider || (meta.replicate_url ? 'replicate' : 'local'),
      trigger: meta.trigger ?? null,
      aesthetic: meta.aesthetic ?? meta.taste_profile ?? null,
      url: meta.replicate_url ?? null,
      coverUrl,
      canGenerateCover: !!meta.replicate_model,
      trainedOn,
      sizeBytes,
    })
  }

  out.sort((a, b) => String(b.trainedOn || '').localeCompare(String(a.trainedOn || '')))
  return { loras: out }
})
