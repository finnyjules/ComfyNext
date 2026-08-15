/**
 * POST /api/training-queue
 *
 * Enqueue a training job. The browser has already zipped + uploaded the dataset
 * (→ datasetUrl) and, for LoRA, generated the aesthetic. We just persist the
 * job as `queued`; the runner (server/plugins/trainingQueueRunner.ts) starts it.
 *
 * Body: {
 *   kind: 'lora' | 'voice',
 *   datasetUrl: string,
 *   outputName: string,
 *   displayName?: string,
 *   params?: Record<string, unknown>,
 *   trigger?: string,
 *   aesthetic?: string,
 *   loraKind?: 'style' | 'character',
 * }
 */
import { jobStore, type NewTrainingJob } from '../../utils/trainingQueue'
import { assertRateLimit } from '../../lib/rateLimit'

function sanitize(name: string): string {
  return (name || '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'my_lora'
}

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'training-queue', 3, 600_000)
  const body = await readBody(event) as Partial<NewTrainingJob> & { displayName?: string }

  if (body.kind !== 'lora' && body.kind !== 'voice') {
    throw createError({ statusCode: 400, message: "kind must be 'lora' or 'voice'" })
  }
  if (!body.datasetUrl) throw createError({ statusCode: 400, message: 'datasetUrl is required' })
  if (!body.outputName) throw createError({ statusCode: 400, message: 'outputName is required' })

  const outputName = sanitize(body.outputName)
  const job = await jobStore().add({
    kind: body.kind,
    outputName,
    displayName: (body.displayName || body.outputName || outputName).trim(),
    datasetUrl: body.datasetUrl,
    params: body.params ?? {},
    trigger: body.trigger ?? null,
    aesthetic: body.aesthetic ?? null,
    loraKind: body.loraKind,
    // Captured here (not resolved later by the runner) because the runner
    // ticks with no request in flight — see trainingQueue.ts's userId doc
    // and trainingProviders.ts's charging-policy doc. Local mode: auth
    // middleware never sets event.context.userId, so this is null and the
    // runner metering nothing for local jobs.
    userId: event.context.userId ?? null,
  })

  return { job }
})
