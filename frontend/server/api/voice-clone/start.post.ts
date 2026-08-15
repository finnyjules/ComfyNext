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
import { preflightMeter } from '../../utils/requestMeter'

const CLONE_MODEL = 'minimax/voice-cloning'

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'voice-clone', 3, 600_000)
  const token = requireReplicateToken()

  // Paid: creates a Replicate prediction on CLONE_MODEL. This route doesn't
  // poll inline (the frontend polls /voice-clone/status separately), so there
  // is no later request in this same execution to settle from once the
  // prediction reaches a terminal state. The provider bills as soon as the
  // job is accepted (compute is consumed regardless of the eventual
  // outcome), so settle right after Replicate confirms creation below.
  const ticket = await preflightMeter(CLONE_MODEL)

  const body = await readBody(event) as {
    voiceFileUrl?: string
    accuracy?: number
    needNoiseReduction?: boolean
    needVolumeNormalization?: boolean
  }

  if (!body.voiceFileUrl) throw createError({ statusCode: 400, message: 'voiceFileUrl is required' })

  const input: Record<string, any> = {
    voice_file: body.voiceFileUrl,
    model: 'speech-02-hd',
    accuracy: typeof body.accuracy === 'number' ? body.accuracy : 0.7,
    need_noise_reduction: !!body.needNoiseReduction,
    need_volume_normalization: !!body.needVolumeNormalization,
  }

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
  await ticket?.settle('rep:' + pred.id)
  return { id: pred.id, status: pred.status }
})
