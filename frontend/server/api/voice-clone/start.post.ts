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

  // Paid: creates a Replicate prediction on CLONE_MODEL. The ticket's HOLD
  // STAYS OPEN across the whole clone (review fix, Stage 5 Task 2). The
  // first cut released it as soon as the prediction was created, on the
  // theory that status.get.ts's debit-on-success would charge later — but
  // that leaves the balance untouched for the minutes the clone runs, so N
  // starts in a row all pass the same gate against the same credits and all
  // charge on completion. Keeping the reservation open is what makes the
  // second start see the first one's spend. Nothing double-counts: the
  // status poll SETTLES this exact hold (voiceCloneOwners.ts carries its
  // id) instead of posting an independent debit.
  //
  // The window is bounded by holdSweep's HOLD_TTL_MS (2h). MiniMax voice
  // cloning takes minutes, so a real clone settles long before the sweep;
  // a hold still open at the TTL means the job or this process died, which
  // is precisely the case the sweep exists for.
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

    // Bind this prediction to the user who paid the preflight AND to the
    // hold now reserving their credits, so status.get.ts can verify the
    // poller is the owner before charging anyone and can settle this exact
    // reservation (see voiceCloneOwners.ts's module doc).
    const userId = currentMeterContext()?.userId
    if (deployMode() === 'hosted' && userId) {
      recordVoiceCloneOwner(pred.id, userId, ticket ? { holdId: ticket.holdId, credits: ticket.credits } : undefined)
    } else if (ticket) {
      // Unreachable in practice — preflightMeter refuses a hosted request
      // with no bound user before any ticket exists. If it ever happens,
      // nobody could settle this hold, so hand it back now rather than
      // leaving it to the sweep.
      console.error('[meter] voice-clone: no owner to bind the hold to — releasing', { predictionId: pred.id })
      await ticket.release()
    }

    return { id: pred.id, status: pred.status }
  } catch (e) {
    // The prediction never started, so nothing will ever settle this hold —
    // give the reservation back instead of locking it until the sweep's TTL.
    await ticket?.release()
    throw e
  }
})
