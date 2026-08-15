/**
 * GET /api/voice-clone/status?id=...&name=...
 *
 * Polls Replicate for the voice-cloning prediction. When it transitions to
 * `succeeded`, downloads the preview clip and writes the voice into the local
 * voices store (../models/voices/<voice_id>.{json,mp3}) so it appears in the
 * Generate-speech voice gallery and validates as a voice_id combo value.
 *
 * Safe to call repeatedly — persistence is a no-op once the files are on disk.
 *
 * Must be allowlisted in server/middleware/comfyui-proxy.ts (NITRO_API_PREFIXES
 * covers /api/voice-clone).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CLONE_MODEL } from './start.post'
import { currentMeterContext, settleModel } from '../../utils/requestMeter'
import { deployMode } from '../../utils/deployMode'
import { decideVoiceCloneSettle } from '../../utils/voiceCloneOwners'

/** MiniMax voice ids are word-ish; keep only path-safe chars for the filename. */
function safeId(id: string): string | null {
  const s = (id || '').trim()
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()

  const query = getQuery(event)
  const id = String(query.id ?? '')
  const name = String(query.name ?? '').trim()
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })

  // SETTLES: this route polls a prediction started (but only preflight-
  // gated, not charged) by /api/voice-clone/start — debit-on-success means
  // the actual ledger debit happens here, in the succeeded branch below,
  // once Replicate confirms the clone actually completed. See settleModel.
  const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { Authorization: `Token ${token}` },
  })
  if (!res.ok) {
    throw createError({ statusCode: res.status, message: await res.text().catch(() => res.statusText) })
  }
  const pred = await res.json() as {
    id: string
    status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
    output?: { voice_id?: string; preview?: string; model?: string } | null
    error?: string | null
    logs?: string
  }

  let voiceId: string | null = null
  let persistError: string | null = null

  if (pred.status === 'succeeded' && pred.output?.voice_id) {
    // Debit-on-success: settle the flat CLONE_MODEL price now that Replicate
    // has confirmed the clone actually completed. jobId doubles as the
    // ledger's idempotency key, so repeated polls after success are a no-op.
    //
    // Ownership gate (final-review fix): this route settles for whoever
    // polls it with a prediction id, so without a check user B polling
    // user A's id would charge user A's ledger to user B's benefit — and
    // because ledger idempotency is per-user, BOTH could end up charged.
    // Only settle when the polling context user matches the user who paid
    // start.post.ts's preflight for this exact prediction id (see
    // voiceCloneOwners.ts). Note: this only gates the DEBIT — reading this
    // route's status/output for a prediction id you don't own is still
    // possible; that's a Stage-5 tenant-isolation rider, not solved here.
    const decision = deployMode() === 'hosted'
      ? decideVoiceCloneSettle(pred.id, currentMeterContext()?.userId)
      : { settle: true as const }
    if (decision.settle) {
      await settleModel(CLONE_MODEL, 'rep:' + pred.id)
    } else if (decision.reason === 'unknown-owner') {
      console.warn('[meter] voice-clone settle skipped — ownership unknown (restart?)', { predictionId: pred.id })
    } else {
      console.warn('[meter] voice-clone settle skipped — poller is not the owner', { predictionId: pred.id })
    }

    const safe = safeId(pred.output.voice_id)
    if (!safe) {
      persistError = `Replicate returned an unsafe voice_id: ${pred.output.voice_id}`
    } else {
      try {
        const voicesDir = path.resolve(process.cwd(), '..', 'models', 'voices')
        await fs.mkdir(voicesDir, { recursive: true })
        const jsonPath = path.join(voicesDir, `${safe}.json`)
        const mp3Path = path.join(voicesDir, `${safe}.mp3`)

        // Download the preview clip (idempotent — skip if already present).
        if (pred.output.preview && !(await fileExists(mp3Path))) {
          const dl = await fetch(pred.output.preview)
          if (dl.ok) {
            await fs.writeFile(mp3Path, Buffer.from(await dl.arrayBuffer()))
          }
        }

        const sidecar = {
          voice_id: safe,
          name: name || safe,
          model: pred.output.model || 'speech-02-hd',
          provider: 'replicate',
          prediction_id: pred.id,
          created: new Date().toISOString(),
        }
        await fs.writeFile(jsonPath, JSON.stringify(sidecar, null, 2))
        voiceId = safe
      } catch (err: any) {
        persistError = err?.message ?? String(err)
      }
    }
  }

  return {
    id: pred.id,
    status: pred.status,
    voiceId,
    error: pred.error ?? persistError ?? null,
    logs: pred.logs ? pred.logs.slice(-1500) : undefined,
  }
})
