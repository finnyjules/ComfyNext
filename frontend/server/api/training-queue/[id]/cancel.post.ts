/**
 * POST /api/training-queue/:id/cancel
 *
 * Cancel a job. If it's queued, just mark it canceled. If it's running on
 * Replicate, also fire the Replicate cancel endpoint first. Terminal jobs are
 * left untouched.
 */
import { jobStore } from '../../../utils/trainingQueue'
import { cancelReplicate } from '../../../utils/trainingProviders'
import { getReplicateToken } from '../../../utils/secrets'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })

  const store = jobStore()
  const job = await store.get(id)
  if (!job) throw createError({ statusCode: 404, message: 'Job not found' })

  if (job.status === 'starting' || job.status === 'processing') {
    const token = getReplicateToken()
    if (token) await cancelReplicate(job, token)
  }

  const updated = await store.update(id, { status: 'canceled' })
  return { job: updated }
})
