/**
 * GET /api/training-queue
 *
 * Returns every job in the durable registry (queued / in-flight / terminal).
 * The Queue panel reads this to render the Trainings section and rehydrates
 * from it on app load, so trainings show up even after the browser (or server)
 * was closed and reopened.
 */
import { jobStore } from '../../utils/trainingQueue'

export default defineEventHandler(async () => {
  const jobs = await jobStore().list()
  // Newest first for display.
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { jobs }
})
