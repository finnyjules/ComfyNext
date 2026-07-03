import { describe, it, expect, vi, afterEach } from 'vitest'
import { createReplicateProvider } from '~~/server/utils/trainingProviders'
import type { TrainingJob } from '~~/server/utils/trainingQueue'

function job(over: Partial<TrainingJob> = {}): TrainingJob {
  const ts = '2026-06-29T00:00:00.000Z'
  return {
    id: 'j1',
    kind: 'lora',
    status: 'processing',
    outputName: 'my_style',
    displayName: 'My Style',
    datasetUrl: 'https://replicate/files/abc',
    params: { family: 'flux' },
    replicateId: 'rep_x',
    progressPct: 10,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  }
}

/** Minimal Response-like stub for global fetch. */
function res(status: number, body: unknown = '', opts: { json?: boolean } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('poll on an orphaned Replicate prediction (404/410 = gone)', () => {
  it('marks a LoRA job failed when the training 404s, instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(404, 'not found')))
    const provider = createReplicateProvider(() => 'tok')
    const patch = await provider.poll(job({ kind: 'lora' }))
    expect(patch.status).toBe('failed')
    expect(patch.error).toMatch(/404|not found|no longer/i)
  })

  it('marks a voice job failed when the prediction 404s, instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(404, 'not found')))
    const provider = createReplicateProvider(() => 'tok')
    const patch = await provider.poll(job({ kind: 'voice' }))
    expect(patch.status).toBe('failed')
    expect(patch.error).toMatch(/404|not found|no longer/i)
  })

  it('still THROWS on a transient 500 so the runner retries next tick (not terminalized)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(500, 'upstream error')))
    const provider = createReplicateProvider(() => 'tok')
    await expect(provider.poll(job({ kind: 'lora' }))).rejects.toThrow()
  })
})
