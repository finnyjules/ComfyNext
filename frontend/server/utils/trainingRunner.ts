/**
 * Scheduling core for the training queue. Pure: the store and the Replicate
 * provider are injected, so the concurrency/lifecycle logic unit-tests without
 * the Nitro runtime or network. server/plugins/trainingQueue.ts wires the real
 * store + provider and ticks this on an interval.
 */
import { isActive, type TrainingJob, type TrainingStatus } from './trainingQueue'

/** Patch a provider returns from start()/poll(); the runner merges it into the store. */
export interface ProviderResult {
  status?: TrainingStatus
  replicateId?: string | null
  destination?: string | null
  progressPct?: number
  logsTail?: string | null
  error?: string | null
  localFilename?: string | null
}

export interface RunnerStore {
  list(): Promise<TrainingJob[]>
  update(id: string, patch: Partial<TrainingJob>, guard?: (cur: TrainingJob) => boolean): Promise<TrainingJob | null>
}

export interface RunnerProvider {
  /** Kick off the Replicate training/prediction; returns at least replicateId + status. */
  start(job: TrainingJob): Promise<ProviderResult>
  /** Poll Replicate; on success download + finalize and return the terminal status. */
  poll(job: TrainingJob): Promise<ProviderResult>
}

const ACTIVE: TrainingStatus[] = ['starting', 'processing']

/**
 * One tick: poll everything in flight, then start as many queued jobs as the
 * concurrency cap allows. Errors on a single job never abort the tick — they're
 * recorded on that job (poll) or retried next tick (left as-is).
 */
export async function tickQueue(
  store: RunnerStore,
  provider: RunnerProvider,
  maxConcurrency: number,
): Promise<void> {
  const jobs = await store.list()

  // 0. Reap interrupted starts. A job left 'starting' with no replicateId means
  //    the process crashed between reserving the slot (step 2) and persisting
  //    the Replicate id. We can't re-start it (would risk a duplicate, billed
  //    training) nor poll it (no id → stuck forever holding a slot), so fail it
  //    and let the user resubmit.
  const interrupted = jobs.filter(j => j.status === 'starting' && !j.replicateId)
  await Promise.all(interrupted.map(j => store.update(
    j.id,
    { status: 'failed', error: 'Training start was interrupted (server restart) before it was confirmed. Please resubmit.' },
    cur => cur.status === 'starting' && !cur.replicateId,
  )))

  // 1. Poll in-flight jobs (skip the ones just reaped — they have no id to poll).
  const active = jobs.filter(j => ACTIVE.includes(j.status) && !(j.status === 'starting' && !j.replicateId))
  await Promise.all(active.map(async (job) => {
    try {
      const patch = await provider.poll(job)
      // Guard on isActive so a stale poll result can't resurrect a job that was
      // canceled (or otherwise went terminal) while this poll was in flight.
      if (patch && Object.keys(patch).length > 0) await store.update(job.id, patch, isActive)
    } catch {
      // Network blip — leave the job in its current status and retry next tick.
    }
  }))

  // 2. Fill free slots with queued jobs (FIFO by createdAt). Recompute the
  //    active count from fresh state so jobs that just finalized free a slot.
  const after = await store.list()
  const activeCount = after.filter(j => ACTIVE.includes(j.status)).length
  const slots = Math.max(0, maxConcurrency - activeCount)
  if (slots <= 0) return

  const queued = after
    .filter(j => j.status === 'queued')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, slots)

  for (const job of queued) {
    // Reserve the slot FIRST (guarded on still-queued) so a crash mid-start
    // leaves the job 'starting'-with-no-id — reaped on the next tick — rather
    // than 'queued', which a restart would re-run into a duplicate training.
    const reserved = await store.update(job.id, { status: 'starting' }, cur => cur.status === 'queued')
    if (!reserved || reserved.status !== 'starting') continue // canceled meanwhile
    try {
      const patch = await provider.start(job)
      await store.update(job.id, { status: 'starting', ...patch }, cur => cur.status === 'starting')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await store.update(job.id, { status: 'failed', error: message }, cur => cur.status === 'starting')
    }
  }
}
