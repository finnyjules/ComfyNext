/**
 * Background training-queue runner. Runs inside the Nitro server, so it keeps
 * starting/polling/finalizing trainings after the browser window is closed —
 * the fix for "closing the window aborts the training".
 *
 * On startup it simply begins ticking against the persisted registry, which
 * naturally resumes any in-flight jobs (resume-after-restart) and starts any
 * still-queued ones. A module singleton guards against Nitro HMR spawning
 * duplicate intervals in dev.
 *
 * Renamed from trainingQueue.ts 2026-08-13 (see commit bc052731c).
 */
import { jobStore } from '../utils/trainingQueue'
import { tickQueue } from '../utils/trainingRunner'
import { createReplicateProvider } from '../utils/trainingProviders'
import { getReplicateToken } from '../utils/secrets'

const TICK_MS = 5000

// Survives HMR: store the timer on globalThis so a re-import clears the old one.
const g = globalThis as unknown as { __cnTrainingQueueTimer?: ReturnType<typeof setInterval> }

export default defineNitroPlugin(() => {
  if (g.__cnTrainingQueueTimer) clearInterval(g.__cnTrainingQueueTimer)

  const maxConcurrency = Math.max(1, Number((useRuntimeConfig() as any).trainingMaxConcurrency) || 2)
  const provider = createReplicateProvider(() => {
    const token = getReplicateToken()
    if (!token) throw new Error('Replicate token not configured')
    return token
  })

  let running = false
  const tick = async () => {
    if (running) return // never overlap ticks
    // Skip entirely while no token is set — jobs wait, nothing fails spuriously.
    if (!getReplicateToken()) return
    running = true
    try {
      await tickQueue(jobStore(), provider, maxConcurrency)
    } catch (err) {
      console.error('[training-queue] tick failed:', err)
    } finally {
      running = false
    }
  }

  g.__cnTrainingQueueTimer = setInterval(tick, TICK_MS)
  console.log(`[training-queue] runner started (maxConcurrency=${maxConcurrency}, tick=${TICK_MS}ms)`)
})
