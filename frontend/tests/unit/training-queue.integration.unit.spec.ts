/**
 * Integration: the REAL durable store (createJobStore on a temp file) driven by
 * the REAL runner (tickQueue), with only the Replicate provider faked. Proves
 * the persistence layer and scheduler cooperate across a simulated server
 * restart — the "closing/restarting doesn't abort trainings" guarantee.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createJobStore } from '~~/server/utils/trainingQueue'
import { tickQueue, type RunnerProvider, type ProviderResult } from '~~/server/utils/trainingRunner'

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-int-'))
  file = path.join(dir, 'jobs.json')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const input = {
  kind: 'lora' as const,
  outputName: 'style',
  displayName: 'Style',
  datasetUrl: 'https://replicate/files/abc',
  params: { family: 'flux' },
}

/** Fake provider that walks each job starting -> processing -> succeeded. */
function walkingProvider(): RunnerProvider {
  return {
    start: async (): Promise<ProviderResult> => ({ replicateId: 'rep', status: 'starting' }),
    poll: async (job): Promise<ProviderResult> =>
      job.status === 'starting' ? { status: 'processing', progressPct: 20 }
      : { status: 'succeeded', progressPct: 100, localFilename: `${job.outputName}.safetensors` },
  }
}

describe('runner + durable store integration', () => {
  it('resumes in-flight jobs from disk after a restart and finalizes them', async () => {
    // Enqueue 3, tick once with cap 2 -> two start, one stays queued.
    const store1 = createJobStore(file)
    await store1.add(input)
    await store1.add({ ...input, outputName: 'b' })
    await store1.add({ ...input, outputName: 'c' })
    await tickQueue(store1, walkingProvider(), 2)

    let jobs = await store1.list()
    expect(jobs.filter(j => j.status === 'starting')).toHaveLength(2)
    expect(jobs.filter(j => j.status === 'queued')).toHaveLength(1)

    // Simulate a server restart: brand-new store instance reading the same file.
    const store2 = createJobStore(file)
    // Tick: the two 'starting' jobs advance to 'processing' (still 2 active,
    // cap full) so the queued one waits.
    await tickQueue(store2, walkingProvider(), 2)
    jobs = await store2.list()
    expect(jobs.filter(j => j.status === 'processing')).toHaveLength(2)
    expect(jobs.filter(j => j.status === 'queued')).toHaveLength(1)

    // Next tick: the two processing jobs finalize (succeeded) AND the freed
    // slots let the last queued job start in the same tick.
    await tickQueue(store2, walkingProvider(), 2)
    jobs = await store2.list()
    expect(jobs.filter(j => j.status === 'succeeded')).toHaveLength(2)
    expect(jobs.filter(j => j.status === 'starting')).toHaveLength(1)

    // The last job needs two more ticks to walk starting -> processing ->
    // succeeded, draining the queue completely.
    await tickQueue(store2, walkingProvider(), 2) // starting -> processing
    await tickQueue(store2, walkingProvider(), 2) // processing -> succeeded
    jobs = await store2.list()
    expect(jobs.filter(j => j.status === 'succeeded')).toHaveLength(3)
  })

  it('terminalizes an orphaned in-flight job and lets a queued job take its slot', async () => {
    const store = createJobStore(file)
    // One job already in flight but orphaned (its remote prediction is gone),
    // plus one waiting in the queue.
    const orphan = await store.add(input)
    await store.update(orphan.id, { status: 'processing', replicateId: 'rep_gone' })
    await store.add({ ...input, outputName: 'waiting' })

    const provider: RunnerProvider = {
      start: async () => ({ replicateId: 'rep_new', status: 'starting' }),
      // Poll reports the orphan as failed (what the real provider does on 404/410).
      poll: async () => ({ status: 'failed', error: 'prediction no longer available' }),
    }

    await tickQueue(store, provider, 1) // cap 1: orphan must free the slot first
    const jobs = await store.list()
    expect(jobs.find(j => j.id === orphan.id)?.status).toBe('failed')
    expect(jobs.find(j => j.outputName === 'waiting')?.status).toBe('starting')
  })
})
