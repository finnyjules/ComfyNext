/**
 * GET /api/training-queue
 *
 * Returns every job in the durable registry (queued / in-flight / terminal).
 * The Queue panel reads this to render the Trainings section and rehydrates
 * from it on app load, so trainings show up even after the browser (or server)
 * was closed and reopened.
 *
 * Stage 6 Task 3: in hosted mode the queue is per-user — a caller only sees
 * jobs whose userId matches theirs. A job with NO userId (pre-Stage-4 legacy,
 * or a local-mode record replayed on a hosted server) is invisible to
 * EVERYONE in hosted mode — fail closed, never guess an owner. Local mode is
 * unfiltered, exactly as before.
 */
import { jobStore } from '../../utils/trainingQueue'
import { deployMode } from '../../utils/deployMode'

export default defineEventHandler(async (event) => {
  const jobs = await jobStore().list()
  const visible = deployMode() === 'hosted'
    ? jobs.filter(j => j.userId === event.context.userId)
    : jobs
  // Newest first for display.
  visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { jobs: visible }
})
