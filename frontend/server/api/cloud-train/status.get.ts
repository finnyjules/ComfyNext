/**
 * GET /api/cloud-train/status?id=...&outputName=...&family=...
 *
 * Polls Replicate for the prediction status. When it transitions to
 * `succeeded`, downloads the output (either a direct .safetensors or a .tar
 * containing one), saves to ../models/loras/<outputName>.safetensors, and
 * writes a sidecar .json with provenance.
 *
 * Safe to call repeatedly — the download step is a no-op once the file is
 * already on disk.
 */
import { promises as fs } from 'node:fs'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'

const exec = promisify(execCb)

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'my_lora'
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

/**
 * Replicate's Flux LoRA trainer returns a URL to a .tar containing
 * `lora.safetensors` and a config. SDXL trainers usually return a direct
 * .safetensors URL. We auto-detect by extension.
 */
async function downloadAndPlace(
  outputUrl: string,
  destPath: string,
): Promise<{ ok: true } | { ok: false, error: string }> {
  try {
    const dlRes = await fetch(outputUrl)
    if (!dlRes.ok) return { ok: false, error: `download HTTP ${dlRes.status}` }
    const buf = Buffer.from(await dlRes.arrayBuffer())

    const looksLikeTar = /\.tar(\.gz)?($|\?)/i.test(outputUrl)
    if (!looksLikeTar) {
      await fs.writeFile(destPath, buf)
      return { ok: true }
    }

    // Extract .tar into a temp dir, find the .safetensors, copy it to destPath.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comfynext-lora-'))
    const tarPath = path.join(tmpDir, 'out.tar')
    try {
      await fs.writeFile(tarPath, buf)
      await exec(`tar -xf ${JSON.stringify(tarPath)} -C ${JSON.stringify(tmpDir)}`)
      const entries = await fs.readdir(tmpDir, { recursive: true }) as string[]
      const safetensor = entries.find((e) => e.endsWith('.safetensors'))
      if (!safetensor) {
        return { ok: false, error: 'tar archive contained no .safetensors file' }
      }
      await fs.copyFile(path.join(tmpDir, safetensor), destPath)
      return { ok: true }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const token = (config as any).replicateToken
  if (!token) {
    throw createError({ statusCode: 500, message: 'Replicate token not configured.' })
  }

  const query = getQuery(event)
  const id = String(query.id ?? '')
  const outputName = sanitize(String(query.outputName ?? 'my_lora'))
  const family = String(query.family ?? 'flux')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })

  const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { Authorization: `Token ${token}` },
  })
  if (!res.ok) {
    throw createError({ statusCode: res.status, message: await res.text().catch(() => res.statusText) })
  }
  const pred = await res.json() as {
    id: string
    status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
    output?: string | string[] | null
    error?: string | null
    logs?: string
    metrics?: { predict_time?: number }
  }

  let localFilename: string | null = null
  let downloadError: string | null = null

  if (pred.status === 'succeeded' && pred.output) {
    const outputUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output
    const lorasDir = path.resolve(process.cwd(), '..', 'models', 'loras')
    await fs.mkdir(lorasDir, { recursive: true })
    const filename = `${outputName}.safetensors`
    const localPath = path.join(lorasDir, filename)

    if (await fileExists(localPath)) {
      localFilename = filename // already downloaded; idempotent poll
    } else {
      const dl = await downloadAndPlace(outputUrl, localPath)
      if (dl.ok) {
        localFilename = filename
        // Sidecar JSON — referenced by the FluxLoRA inference node to map
        // a local filename back to its public Replicate URL.
        const sidecar = {
          name: outputName,
          base_model: family === 'flux' ? 'flux-dev' : 'sdxl',
          provider: 'replicate',
          replicate_prediction_id: pred.id,
          replicate_url: outputUrl,
          trained_on: new Date().toISOString(),
        }
        await fs.writeFile(
          localPath.replace(/\.safetensors$/, '.json'),
          JSON.stringify(sidecar, null, 2),
        )
      } else {
        downloadError = dl.error
      }
    }
  }

  // Tail last ~1500 chars of logs so the surface can show progress hints.
  const logsTail = pred.logs ? pred.logs.slice(-1500) : undefined

  return {
    id: pred.id,
    status: pred.status,
    output: pred.output ?? null,
    error: pred.error ?? downloadError ?? null,
    logs: logsTail,
    predictTime: pred.metrics?.predict_time ?? null,
    localFilename,
  }
})
