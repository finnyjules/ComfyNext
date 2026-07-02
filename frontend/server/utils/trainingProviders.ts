/**
 * Replicate provider for the training queue: start + poll(+finalize) for both
 * LoRA (style/character) and voice clones. Mirrors the logic that used to live
 * in /api/cloud-train/{start,status} and /api/voice-clone/{start,status}, moved
 * server-side so it runs headlessly from the queue runner.
 *
 * Token is passed in (fetched fresh by the plugin each tick) rather than read
 * from the request, since there's no request when the runner ticks.
 */
import { promises as fs } from 'node:fs'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import type { TrainingJob } from './trainingQueue'
import type { ProviderResult, RunnerProvider } from './trainingRunner'
import { linkTrainedCharacter } from './characterLink'

const exec = promisify(execCb)

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'my_lora'
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

const REPLICATE = 'https://api.replicate.com/v1'
function authHeaders(token: string, json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Token ${token}` }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

// --- shared download (direct .safetensors or .tar containing one) ------------

async function downloadWeights(outputUrl: string, destPath: string): Promise<{ ok: true } | { ok: false, error: string }> {
  try {
    const dlRes = await fetch(outputUrl)
    if (!dlRes.ok) return { ok: false, error: `download HTTP ${dlRes.status}` }
    const buf = Buffer.from(await dlRes.arrayBuffer())

    const looksLikeTar = /\.tar(\.gz)?($|\?)/i.test(outputUrl)
    if (!looksLikeTar) {
      await fs.writeFile(destPath, buf)
      return { ok: true }
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comfynext-lora-'))
    const tarPath = path.join(tmpDir, 'out.tar')
    try {
      await fs.writeFile(tarPath, buf)
      await exec(`tar -xf ${JSON.stringify(tarPath)} -C ${JSON.stringify(tmpDir)}`)
      const entries = await fs.readdir(tmpDir, { recursive: true }) as string[]
      const safetensor = entries.find(e => e.endsWith('.safetensors'))
      if (!safetensor) return { ok: false, error: 'tar archive contained no .safetensors file' }
      await fs.copyFile(path.join(tmpDir, safetensor), destPath)
      return { ok: true }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}

// --- LoRA --------------------------------------------------------------------

function loraTrainerModel(family: unknown): string {
  return family === 'flux' ? 'ostris/flux-dev-lora-trainer' : 'ostris/sdxl-lora-trainer'
}

async function startLora(job: TrainingJob, token: string): Promise<ProviderResult> {
  const p = job.params as Record<string, any>
  const trainerModel = loraTrainerModel(p.family)

  const modelRes = await fetch(`${REPLICATE}/models/${trainerModel}`, { headers: authHeaders(token) })
  if (!modelRes.ok) throw new Error(`Could not look up trainer model ${trainerModel}: ${await modelRes.text().catch(() => modelRes.statusText)}`)
  const version = (await modelRes.json() as { latest_version?: { id?: string } }).latest_version?.id
  if (!version) throw new Error(`Trainer model ${trainerModel} has no latest version`)

  const input: Record<string, any> = {
    input_images: job.datasetUrl,
    steps: p.steps ?? 500,
    learning_rate: p.learningRate ?? 0.0004,
    lora_rank: p.loraRank ?? 16,
    batch_size: p.batchSize ?? 1,
    seed: p.seed ?? Math.floor(Math.random() * 1_000_000_000),
    autocaption: false,
  }
  if (job.trigger) input.trigger_word = job.trigger

  const acctRes = await fetch(`${REPLICATE}/account`, { headers: authHeaders(token) })
  if (!acctRes.ok) throw new Error(`Could not resolve Replicate account: ${await acctRes.text().catch(() => acctRes.statusText)}`)
  const username = (await acctRes.json() as { username?: string }).username
  if (!username) throw new Error('Replicate account returned no username')

  const destName = `jules-${sanitize(job.outputName).toLowerCase().replace(/_/g, '-')}`
  const destination = `${username}/${destName}`

  const createRes = await fetch(`${REPLICATE}/models`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ owner: username, name: destName, visibility: 'private', hardware: 'gpu-t4', description: 'LoRA trained from ComfyNext.' }),
  })
  if (!createRes.ok && createRes.status !== 409) {
    const text = await createRes.text().catch(() => '')
    if (!/already exists/i.test(text)) throw new Error(`Could not create destination model ${destination}: ${text || createRes.statusText}`)
  }

  const trainRes = await fetch(`${REPLICATE}/models/${trainerModel}/versions/${version}/trainings`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ destination, input }),
  })
  if (!trainRes.ok) throw new Error(await trainRes.text().catch(() => trainRes.statusText))
  const training = await trainRes.json() as { id: string, status: string }

  return { replicateId: training.id, destination, status: 'starting' }
}

async function pollLora(job: TrainingJob, token: string): Promise<ProviderResult> {
  if (!job.replicateId) return {}
  const res = await fetch(`${REPLICATE}/trainings/${job.replicateId}`, { headers: authHeaders(token) })
  if (!res.ok) {
    // 404/410 = the training is gone (expired/deleted). Terminalize so the job
    // stops occupying a concurrency slot; a transient 5xx throws and retries.
    if (res.status === 404 || res.status === 410) {
      return { status: 'failed', error: `Replicate training ${job.replicateId} is no longer available (HTTP ${res.status}).` }
    }
    throw new Error(await res.text().catch(() => res.statusText))
  }
  const pred = await res.json() as {
    id: string
    status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
    output?: string | string[] | { weights?: string, url?: string, version?: string } | null
    error?: string | null
    logs?: string
  }

  const logsTail = pred.logs ? pred.logs.slice(-1500) : null
  const out: any = pred.output
  const outputUrl: string | null = out == null ? null
    : typeof out === 'string' ? out
    : Array.isArray(out) ? out[0]
    : (out.weights || out.url || null)

  if (pred.status === 'processing' || pred.status === 'starting') {
    // Inch the bar so the UI shows life; real % isn't exposed by the trainer.
    const next = Math.min(90, (job.progressPct || 0) + (pred.status === 'processing' ? 3 : 0))
    return { status: pred.status, progressPct: next, logsTail }
  }

  if (pred.status === 'succeeded' && outputUrl) {
    const lorasDir = path.resolve(process.cwd(), '..', 'models', 'loras')
    await fs.mkdir(lorasDir, { recursive: true })
    const filename = `${sanitize(job.outputName)}.safetensors`
    const localPath = path.join(lorasDir, filename)

    if (!(await fileExists(localPath))) {
      const dl = await downloadWeights(outputUrl, localPath)
      if (!dl.ok) return { status: 'failed', error: dl.error, logsTail }
      const modelRef = out && typeof out === 'object' && !Array.isArray(out) && typeof out.version === 'string' ? out.version : null
      const sidecar = {
        name: sanitize(job.outputName),
        base_model: (job.params as any).family === 'flux' ? 'flux-dev' : 'sdxl',
        provider: 'replicate',
        trigger: job.trigger || null,
        replicate_prediction_id: pred.id,
        replicate_model: modelRef,
        replicate_url: outputUrl,
        aesthetic: job.aesthetic || null,
        kind: job.loraKind === 'character' ? 'character' : 'style',
        trained_on: new Date().toISOString(),
      }
      await fs.writeFile(localPath.replace(/\.safetensors$/, '.json'), JSON.stringify(sidecar, null, 2))
      // Link the character registry so this identity shows up in the
      // Characters panel (ready, with a LoRA chip) without a manual step.
      // Best-effort: the weights + sidecar are already safely on disk, so a
      // registry hiccup here shouldn't fail the poll/finalize.
      if (job.loraKind === 'character') {
        await linkTrainedCharacter({ displayName: job.displayName, weightsFilename: filename, trigger: job.trigger ?? null }).catch((err) => {
          console.warn('[training] registry link failed', err)
        })
      }
    }
    return { status: 'succeeded', progressPct: 100, localFilename: filename, logsTail }
  }

  if (pred.status === 'succeeded' && !outputUrl) {
    return { status: 'failed', error: 'Training succeeded but returned no weights URL.', logsTail }
  }
  return { status: pred.status, error: pred.error ?? null, logsTail }
}

// --- Voice -------------------------------------------------------------------

function safeVoiceId(id: string): string | null {
  const s = (id || '').trim()
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null
}

async function startVoice(job: TrainingJob, token: string): Promise<ProviderResult> {
  const p = job.params as Record<string, any>
  const input: Record<string, any> = {
    voice_file: job.datasetUrl,
    model: 'speech-02-hd',
    accuracy: typeof p.accuracy === 'number' ? p.accuracy : 0.7,
    need_noise_reduction: !!p.needNoiseReduction,
    need_volume_normalization: !!p.needVolumeNormalization,
  }
  const res = await fetch(`${REPLICATE}/models/minimax/voice-cloning/predictions`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ input }),
  })
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText))
  const pred = await res.json() as { id: string, status: string }
  return { replicateId: pred.id, status: 'starting' }
}

async function pollVoice(job: TrainingJob, token: string): Promise<ProviderResult> {
  if (!job.replicateId) return {}
  const res = await fetch(`${REPLICATE}/predictions/${job.replicateId}`, { headers: authHeaders(token) })
  if (!res.ok) {
    // 404/410 = the prediction is gone. Terminalize so the job frees its slot;
    // a transient 5xx throws and is retried on the next tick.
    if (res.status === 404 || res.status === 410) {
      return { status: 'failed', error: `Replicate prediction ${job.replicateId} is no longer available (HTTP ${res.status}).` }
    }
    throw new Error(await res.text().catch(() => res.statusText))
  }
  const pred = await res.json() as {
    id: string
    status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
    output?: { voice_id?: string, preview?: string, model?: string } | null
    error?: string | null
    logs?: string
  }
  const logsTail = pred.logs ? pred.logs.slice(-1500) : null

  if (pred.status === 'starting' || pred.status === 'processing') {
    const next = Math.min(90, (job.progressPct || 0) + (pred.status === 'processing' ? 5 : 0))
    return { status: pred.status, progressPct: next, logsTail }
  }

  if (pred.status === 'succeeded' && pred.output?.voice_id) {
    const safe = safeVoiceId(pred.output.voice_id)
    if (!safe) return { status: 'failed', error: `Replicate returned an unsafe voice_id: ${pred.output.voice_id}`, logsTail }
    const voicesDir = path.resolve(process.cwd(), '..', 'models', 'voices')
    await fs.mkdir(voicesDir, { recursive: true })
    const jsonPath = path.join(voicesDir, `${safe}.json`)
    const mp3Path = path.join(voicesDir, `${safe}.mp3`)
    if (pred.output.preview && !(await fileExists(mp3Path))) {
      const dl = await fetch(pred.output.preview)
      if (dl.ok) await fs.writeFile(mp3Path, Buffer.from(await dl.arrayBuffer()))
    }
    const sidecar = {
      voice_id: safe,
      name: job.displayName || safe,
      model: pred.output.model || 'speech-02-hd',
      provider: 'replicate',
      prediction_id: pred.id,
      created: new Date().toISOString(),
    }
    await fs.writeFile(jsonPath, JSON.stringify(sidecar, null, 2))
    return { status: 'succeeded', progressPct: 100, localFilename: `${safe}.json`, logsTail }
  }

  if (pred.status === 'succeeded') {
    return { status: 'failed', error: 'Voice clone succeeded but returned no voice_id.', logsTail }
  }
  return { status: pred.status, error: pred.error ?? null, logsTail }
}

// --- dispatch ----------------------------------------------------------------

/** Build a RunnerProvider that reads a fresh token per call via getToken(). */
export function createReplicateProvider(getToken: () => string): RunnerProvider {
  return {
    start: (job) => job.kind === 'voice' ? startVoice(job, getToken()) : startLora(job, getToken()),
    poll: (job) => job.kind === 'voice' ? pollVoice(job, getToken()) : pollLora(job, getToken()),
  }
}

/** Cancel a running Replicate training/prediction (best-effort). */
export async function cancelReplicate(job: TrainingJob, token: string): Promise<void> {
  if (!job.replicateId) return
  const endpoint = job.kind === 'voice'
    ? `${REPLICATE}/predictions/${job.replicateId}/cancel`
    : `${REPLICATE}/trainings/${job.replicateId}/cancel`
  await fetch(endpoint, { method: 'POST', headers: authHeaders(token) }).catch(() => {})
}
