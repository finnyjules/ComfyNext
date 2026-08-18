/**
 * DELETE /api/training-queue/:id
 *
 * Remove a job from the registry. Used to dismiss/clear terminal jobs
 * (succeeded / failed / canceled) from the queue panel. Does NOT cancel a
 * running job — use /cancel for that first.
 *
 * Stage 6 Task 3: in hosted mode, deleting another user's job (or an
 * ownerless legacy job) 404s exactly like a missing id — no existence
 * disclosure — and the store mutation never runs. Local mode is ungated,
 * exactly as before.
 */
import { jobStore } from '../../../utils/trainingQueue'
import { deployMode } from '../../../utils/deployMode'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })
  const store = jobStore()
  if (deployMode() === 'hosted') {
    const job = await store.get(id)
    if (!job || job.userId !== event.context.userId) {
      throw createError({ statusCode: 404, message: 'Job not found' })
    }
  }
  const removed = await store.remove(id)
  return { removed }
})
