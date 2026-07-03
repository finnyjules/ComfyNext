import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createJobStore, isActive, type JobStore, type TrainingJob } from '~~/server/utils/trainingQueue'

let dir: string
let file: string
let store: JobStore

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-jobs-'))
  file = path.join(dir, 'jobs.json')
  store = createJobStore(file)
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const sampleInput = {
  kind: 'lora' as const,
  outputName: 'my_style',
  displayName: 'My Style',
  datasetUrl: 'https://replicate/files/abc',
  params: { family: 'flux', steps: 500 },
}

describe('createJobStore', () => {
  it('returns an empty list when the file does not exist', async () => {
    expect(await store.list()).toEqual([])
  })

  it('add() fills defaults and persists', async () => {
    const job = await store.add(sampleInput)
    expect(job.id).toBeTruthy()
    expect(job.status).toBe('queued')
    expect(job.progressPct).toBe(0)
    expect(job.createdAt).toBe(job.updatedAt)
    expect(job.trigger).toBeNull()

    // Persisted to disk and re-readable through a fresh store.
    const reopened = createJobStore(file)
    const all = await reopened.list()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(job.id)
  })

  it('get() finds by id and returns null for unknown', async () => {
    const job = await store.add(sampleInput)
    expect((await store.get(job.id))?.id).toBe(job.id)
    expect(await store.get('nope')).toBeNull()
  })

  it('update() patches fields and bumps updatedAt but not id/createdAt', async () => {
    const job = await store.add(sampleInput)
    await new Promise(r => setTimeout(r, 2))
    const updated = await store.update(job.id, { status: 'processing', progressPct: 42, replicateId: 'rep_1' })
    expect(updated?.status).toBe('processing')
    expect(updated?.progressPct).toBe(42)
    expect(updated?.replicateId).toBe('rep_1')
    expect(updated?.id).toBe(job.id)
    expect(updated?.createdAt).toBe(job.createdAt)
    expect(updated?.updatedAt).not.toBe(job.createdAt)
  })

  it('update() ignores an attempt to change id/createdAt via patch', async () => {
    const job = await store.add(sampleInput)
    const updated = await store.update(job.id, { id: 'hacked', createdAt: 'then' } as Partial<TrainingJob>)
    expect(updated?.id).toBe(job.id)
    expect(updated?.createdAt).toBe(job.createdAt)
  })

  it('update() returns null for an unknown id', async () => {
    expect(await store.update('nope', { status: 'failed' })).toBeNull()
  })

  it('remove() deletes and reports whether anything was removed', async () => {
    const job = await store.add(sampleInput)
    expect(await store.remove(job.id)).toBe(true)
    expect(await store.list()).toEqual([])
    expect(await store.remove(job.id)).toBe(false)
  })

  it('update() with a guard skips the write when the guard rejects the current job', async () => {
    const job = await store.add(sampleInput)
    await store.update(job.id, { status: 'canceled' })
    // Guard: only apply while the job is still active. It is canceled → skip.
    const result = await store.update(job.id, { status: 'processing' }, cur => isActive(cur))
    expect(result?.status).toBe('canceled') // returns the unchanged current job
    expect((await store.get(job.id))?.status).toBe('canceled')
  })

  it('update() with a guard applies the write when the guard accepts', async () => {
    const job = await store.add(sampleInput)
    const result = await store.update(job.id, { status: 'processing', progressPct: 30 }, cur => isActive(cur))
    expect(result?.status).toBe('processing')
    expect(result?.progressPct).toBe(30)
  })

  it('serializes concurrent add() calls without losing writes', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.add({ ...sampleInput, outputName: `s_${i}`, displayName: `S ${i}` })),
    )
    const all = await store.list()
    expect(all).toHaveLength(10)
    // All ids unique.
    expect(new Set(all.map(j => j.id)).size).toBe(10)
  })

  it('serializes interleaved add/update/remove', async () => {
    const a = await store.add(sampleInput)
    await Promise.all([
      store.add({ ...sampleInput, outputName: 'b' }),
      store.update(a.id, { status: 'processing' }),
      store.add({ ...sampleInput, outputName: 'c' }),
    ])
    const all = await store.list()
    expect(all).toHaveLength(3)
    expect(all.find(j => j.id === a.id)?.status).toBe('processing')
  })
})

describe('durable-write hardening', () => {
  it('recovers jobs from the .bak when the main registry file is corrupt', async () => {
    const good = JSON.stringify([{ ...sampleInput, id: 'x', status: 'processing', progressPct: 0, createdAt: 'a', updatedAt: 'a' }])
    // Simulate a torn/corrupt main file with a valid last-good backup beside it.
    await fs.writeFile(file, '{ this is not valid json', 'utf8')
    await fs.writeFile(`${file}.bak`, good, 'utf8')
    const s = createJobStore(file)
    const all = await s.list()
    expect(all.map(j => j.id)).toEqual(['x'])
  })

  it('retains the previous good state in .bak after a subsequent write', async () => {
    const a = await store.add(sampleInput)
    await store.add({ ...sampleInput, outputName: 'b' })
    const bak = JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))
    expect(bak.map((j: TrainingJob) => j.id)).toEqual([a.id])
  })

  it('leaves no .tmp scratch file behind after writes', async () => {
    await store.add(sampleInput)
    const entries = await fs.readdir(dir)
    expect(entries.some(e => e.endsWith('.tmp'))).toBe(false)
    expect(await store.list()).toHaveLength(1)
  })
})

describe('isActive', () => {
  it('treats queued/starting/processing as active and terminal states as inactive', () => {
    const base = { } as TrainingJob
    expect(isActive({ ...base, status: 'queued' })).toBe(true)
    expect(isActive({ ...base, status: 'starting' })).toBe(true)
    expect(isActive({ ...base, status: 'processing' })).toBe(true)
    expect(isActive({ ...base, status: 'succeeded' })).toBe(false)
    expect(isActive({ ...base, status: 'failed' })).toBe(false)
    expect(isActive({ ...base, status: 'canceled' })).toBe(false)
  })
})
