import { describe, it, expect, vi } from 'vitest'
import { tickQueue, type RunnerProvider, type ProviderResult } from '~~/server/utils/trainingRunner'
import type { TrainingJob, TrainingStatus } from '~~/server/utils/trainingQueue'

let seq = 0
function job(over: Partial<TrainingJob> = {}): TrainingJob {
  seq += 1
  const ts = `2026-06-29T00:00:${String(seq).padStart(2, '0')}.000Z`
  return {
    id: `j${seq}`,
    kind: 'lora',
    status: 'queued',
    outputName: `o${seq}`,
    displayName: `O ${seq}`,
    datasetUrl: 'url',
    params: {},
    progressPct: 0,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  }
}

/** In-memory store backed by a mutable array, mirroring JobStore semantics. */
function memStore(initial: TrainingJob[]) {
  const jobs = [...initial]
  return {
    jobs,
    list: vi.fn(async () => jobs.map(j => ({ ...j }))),
    update: vi.fn(async (id: string, patch: Partial<TrainingJob>, guard?: (cur: TrainingJob) => boolean) => {
      const idx = jobs.findIndex(j => j.id === id)
      if (idx === -1) return null
      if (guard && !guard(jobs[idx])) return { ...jobs[idx] }
      jobs[idx] = { ...jobs[idx], ...patch, id: jobs[idx].id }
      return { ...jobs[idx] }
    }),
  }
}

function provider(over: Partial<RunnerProvider> = {}): RunnerProvider {
  return {
    start: vi.fn(async (): Promise<ProviderResult> => ({ replicateId: 'rep', status: 'starting' })),
    poll: vi.fn(async (j): Promise<ProviderResult> => ({ status: j.status })),
    ...over,
  }
}

describe('tickQueue concurrency', () => {
  it('starts only enough queued jobs to fill the cap', async () => {
    const store = memStore([job(), job(), job()]) // 3 queued
    const prov = provider()
    await tickQueue(store, prov, 2)
    expect(prov.start).toHaveBeenCalledTimes(2)
    const started = store.jobs.filter(j => j.status === 'starting')
    expect(started).toHaveLength(2)
    expect(store.jobs.filter(j => j.status === 'queued')).toHaveLength(1)
  })

  it('counts in-flight jobs against the cap', async () => {
    const store = memStore([job({ status: 'processing' }), job(), job()])
    const prov = provider()
    await tickQueue(store, prov, 2)
    // 1 already processing → only 1 free slot.
    expect(prov.start).toHaveBeenCalledTimes(1)
  })

  it('starts nothing when already at the cap', async () => {
    const store = memStore([job({ status: 'processing', replicateId: 'r1' }), job({ status: 'starting', replicateId: 'r2' }), job()])
    const prov = provider()
    await tickQueue(store, prov, 2)
    expect(prov.start).not.toHaveBeenCalled()
    expect(store.jobs.find(j => j.status === 'queued')).toBeTruthy()
  })

  it('starts queued jobs FIFO by createdAt', async () => {
    const older = job({ createdAt: '2026-06-29T00:00:00.000Z' })
    const newer = job({ createdAt: '2026-06-29T09:00:00.000Z' })
    const store = memStore([newer, older]) // array order reversed on purpose
    const prov = provider()
    await tickQueue(store, prov, 1)
    expect(prov.start).toHaveBeenCalledTimes(1)
    expect((prov.start as any).mock.calls[0][0].id).toBe(older.id)
  })
})

describe('tickQueue polling + finalize', () => {
  it('polls in-flight jobs and applies the returned patch', async () => {
    const store = memStore([job({ status: 'processing', id: 'p1' })])
    const prov = provider({
      poll: vi.fn(async (): Promise<ProviderResult> => ({ status: 'succeeded', localFilename: 'p1.safetensors', progressPct: 100 })),
    })
    await tickQueue(store, prov, 2)
    expect(prov.poll).toHaveBeenCalledTimes(1)
    const j = store.jobs.find(x => x.id === 'p1')!
    expect(j.status).toBe('succeeded')
    expect(j.localFilename).toBe('p1.safetensors')
  })

  it('frees a slot in the same tick when an in-flight job finalizes', async () => {
    const store = memStore([job({ status: 'processing', id: 'p1' }), job({ status: 'processing', id: 'p2' }), job()])
    const prov = provider({
      poll: vi.fn(async (j): Promise<ProviderResult> =>
        j.id === 'p1' ? { status: 'succeeded' } : { status: 'processing' }),
    })
    await tickQueue(store, prov, 2)
    // p1 finalized → 1 active remains → 1 free slot → start the queued one.
    expect(prov.start).toHaveBeenCalledTimes(1)
  })

  it('does not crash the tick when poll throws; job keeps its status', async () => {
    const store = memStore([job({ status: 'processing', id: 'p1' }), job()])
    const prov = provider({
      poll: vi.fn(async () => { throw new Error('network blip') }),
    })
    await tickQueue(store, prov, 2)
    expect(store.jobs.find(j => j.id === 'p1')!.status).toBe('processing')
    // The free slot is still filled despite the poll error.
    expect(prov.start).toHaveBeenCalledTimes(1)
  })

  it('does not resurrect a job that was canceled while its poll was in flight', async () => {
    const store = memStore([job({ status: 'processing', id: 'p1' })])
    const prov = provider({
      // Simulate a concurrent cancel landing mid-poll: the job goes terminal
      // before the (stale) 'processing' poll result is applied.
      poll: vi.fn(async (): Promise<ProviderResult> => {
        store.jobs[0].status = 'canceled'
        return { status: 'processing', progressPct: 50 }
      }),
    })
    await tickQueue(store, prov, 2)
    expect(store.jobs.find(j => j.id === 'p1')!.status).toBe('canceled')
  })

  it('marks a job failed when start throws', async () => {
    const store = memStore([job({ id: 'q1' })])
    const prov = provider({
      start: vi.fn(async () => { throw new Error('Replicate rejected') }),
    })
    await tickQueue(store, prov, 2)
    const j = store.jobs.find(x => x.id === 'q1')!
    expect(j.status).toBe('failed')
    expect(j.error).toBe('Replicate rejected')
  })

  it('reaps an interrupted start (starting + no replicateId) as failed, never re-starting or polling it', async () => {
    // This state only arises when the process crashed between reserving the
    // slot and persisting the Replicate id. Re-starting would double-bill; the
    // runner must fail it so the user can resubmit, and free its slot.
    const store = memStore([job({ status: 'starting', id: 's1', replicateId: undefined }), job({ id: 'q1' })])
    const prov = provider()
    await tickQueue(store, prov, 1)
    const s1 = store.jobs.find(j => j.id === 's1')!
    expect(s1.status).toBe('failed')
    expect(s1.error).toMatch(/interrupt|resubmit|restart/i)
    expect(prov.poll).not.toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
    // Its freed slot lets the queued job start in the same tick.
    expect((prov.start as any).mock.calls.some((c: any[]) => c[0].id === 'q1')).toBe(true)
  })

  it('leaves a fresh starting-with-no-id job alone (a concurrent process may be mid-start)', async () => {
    // Multiple dev servers tick the same registry file. A job another process
    // reserved seconds ago looks identical to crash debris except for its age —
    // so only stale entries may be reaped. Fresh ones keep their slot.
    const fresh = job({ status: 'starting', id: 's1', replicateId: undefined, updatedAt: new Date().toISOString() })
    const store = memStore([fresh, job({ id: 'q1' })])
    const prov = provider()
    await tickQueue(store, prov, 1)
    const s1 = store.jobs.find(j => j.id === 's1')!
    expect(s1.status).toBe('starting')
    expect(s1.error).toBeFalsy()
    // It still holds its concurrency slot, and it can't be polled (no id yet).
    expect(prov.start).not.toHaveBeenCalled()
    expect(prov.poll).not.toHaveBeenCalled()
  })

  it('reaps a starting-with-no-id job whose updatedAt is unparseable', async () => {
    // A mangled timestamp must count as stale, not immortal — otherwise the
    // job holds a concurrency slot forever.
    const store = memStore([job({ status: 'starting', id: 's1', replicateId: undefined, updatedAt: 'not-a-date' })])
    const prov = provider()
    await tickQueue(store, prov, 1)
    expect(store.jobs.find(j => j.id === 's1')!.status).toBe('failed')
  })

  it('reserves a queued job as starting before calling provider.start (crash-safe ordering)', async () => {
    // If start() rejects, the job must end failed (reserved then failed), and
    // it must never be left as plain 'queued' which a restart would re-run.
    const store = memStore([job({ id: 'q1' })])
    const prov = provider({ start: vi.fn(async () => { throw new Error('boom') }) })
    await tickQueue(store, prov, 1)
    expect(store.jobs.find(j => j.id === 'q1')!.status).toBe('failed')
  })

  it('does nothing on an empty queue', async () => {
    const store = memStore([])
    const prov = provider()
    await tickQueue(store, prov, 2)
    expect(prov.start).not.toHaveBeenCalled()
    expect(prov.poll).not.toHaveBeenCalled()
  })
})
