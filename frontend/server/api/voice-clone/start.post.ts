/**
 * POST /api/voice-clone/start
 *
 * Body: {
 *   voiceFileUrl: string,        // from /voice-clone/upload
 *   accuracy?: number,           // 0-1, default 0.7
 *   needNoiseReduction?: boolean,
 *   needVolumeNormalization?: boolean,
 * }
 *
 * Starts a minimax/voice-cloning prediction (a normal prediction, NOT the
 * trainings API). The clone is locked to the speech-02-hd model so the resulting
 * voice works in the Generate speech node. Returns the prediction id; the
 * frontend polls /voice-clone/status with it (plus the user-chosen name).
 */
import { assertRateLimit } from '../../lib/rateLimit'
import { currentMeterContext, preflightMeter } from '../../utils/requestMeter'
import { VOICE_CLONE_MODEL } from '../../utils/priceBook'
import { deployMode } from '../../utils/deployMode'
import { recordVoiceCloneOwner } from '../../utils/voiceCloneOwners'

// Re-exported (not re-declared) so status.get.ts's `import { CLONE_MODEL }
// from './start.post'` keeps working — VOICE_CLONE_MODEL in priceBook.ts is
// now the single source of truth for this slug (see trainingProviders.ts).
export const CLONE_MODEL = VOICE_CLONE_MODEL

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'voice-clone', 3, 600_000)
  const token = requireReplicateToken()

  const body = await readBody(event) as {
    voiceFileUrl?: string
    accuracy?: number
    needNoiseReduction?: boolean
    needVolumeNormalization?: boolean
  }

  if (!body.voiceFileUrl) throw createError({ statusCode: 400, message: 'voiceFileUrl is required' })

  // Paid: creates a Replicate prediction on CLONE_MODEL. Preflight is a GATE
  // ONLY here — the ticket's hold is released as soon as the prediction is
  // created (or fails to be), because settlement happens in status.get.ts on
  // confirmed success via settleModel's own debit (debit-on-success — the
  // clone is async and can fail after creation, so charging here would bill
  // a user for a job that never completes). Holding the reservation open
  // across that window would double-count the same credits (reserved here,
  // debited there) and, if this process died, lock them until holdSweep's
  // TTL. Balance-during-the-clone behavior is therefore unchanged from the
  // pre-hold implementation: gated at start, charged at success.
  const ticket = await preflightMeter(CLONE_MODEL)

  const input: Record<string, any> = {
    voice_file: body.voiceFileUrl,
    model: 'speech-02-hd',
    accuracy: typeof body.accuracy === 'number' ? body.accuracy : 0.7,
    need_noise_reduction: !!body.needNoiseReduction,
    need_volume_normalization: !!body.needVolumeNormalization,
  }

  try {
    const res = await fetch(
      `https://api.replicate.com/v1/models/${CLONE_MODEL}/predictions`,
      {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw createError({ statusCode: res.status, message: text || res.statusText })
    }

    const pred = await res.json() as { id: string; status: string }

    // Bind this prediction to the user who paid the preflight, so
    // status.get.ts's debit-on-success settle can verify the poller is the
    // owner before charging anyone (see voiceCloneOwners.ts's module doc).
    if (deployMode() === 'hosted') {
      const userId = currentMeterContext()?.userId
      if (userId) recordVoiceCloneOwner(pred.id, userId)
    }

    return { id: pred.id, status: pred.status }
  } finally {
    // Success or failure, the gate has done its job — hand the reservation
    // back rather than holding it across an async clone this request will
    // never see the end of.
    await ticket?.release()
  }
})
