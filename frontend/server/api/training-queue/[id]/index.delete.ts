/**
 * DELETE /api/training-queue/:id
 *
 * Remove a job from the registry. Used to dismiss/clear terminal jobs
 * (succeeded / failed / canceled) from the queue panel. Does NOT cancel a
 * running job — use /cancel for that first.
 */
import { jobStore } from '../../../utils/trainingQueue'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })
  const removed = await jobStore().remove(id)
  return { removed }
})
