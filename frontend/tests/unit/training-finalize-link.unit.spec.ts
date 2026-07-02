import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock node:fs so pollLora's "does the weights file already exist / write it
// out" bookkeeping never touches the real models/loras directory (which
// path.resolve(process.cwd(), '..', 'models', 'loras') would otherwise
// resolve to when vitest's cwd is frontend/). fs.access rejecting means
// "file does not exist yet" (fileExists() -> false), which is what we want
// so downloadWeights() runs and the succeeded branch proceeds to the
// registry-link call under test.
vi.mock('node:fs', () => ({
  promises: {
    access: vi.fn(async () => { throw new Error('ENOENT') }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readdir: vi.fn(async () => []),
    rm: vi.fn(async () => undefined),
  },
}))

// Mock the registry-link helper so we can spy on how it's called without
// touching the real character registry on disk.
const linkTrainedCharacter = vi.fn(async () => undefined)
vi.mock('~~/server/utils/characterLink', () => ({
  linkTrainedCharacter: (...args: unknown[]) => linkTrainedCharacter(...args),
}))

import { createReplicateProvider } from '~~/server/utils/trainingProviders'
import type { TrainingJob } from '~~/server/utils/trainingQueue'

function job(over: Partial<TrainingJob> = {}): TrainingJob {
  const ts = '2026-06-29T00:00:00.000Z'
  return {
    id: 'j1',
    kind: 'lora',
    status: 'processing',
    outputName: 'millie_v1',
    displayName: 'Millie',
    datasetUrl: 'https://replicate/files/abc',
    params: { family: 'flux' },
    trigger: 'MILLIE_TRIGGER',
    loraKind: 'character',
    replicateId: 'rep_x',
    progressPct: 90,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  }
}

/** Minimal Response-like stub for global fetch. */
function res(status: number, body: unknown = '', opts: { arrayBuffer?: boolean } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
    ...opts,
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  linkTrainedCharacter.mockClear()
})

describe('training finalize -> character registry link', () => {
  it('calls linkTrainedCharacter with the job displayName/trigger when a character-kind LoRA job succeeds', async () => {
    // First fetch: the Replicate training-status poll (succeeded, with an
    // output weights URL). Second fetch: downloadWeights() fetching the
    // weights file itself.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/trainings/')) {
        return res(200, {
          id: 'rep_x',
          status: 'succeeded',
          output: { weights: 'https://replicate.delivery/weights.safetensors', version: 'owner/model:abc123' },
        })
      }
      return res(200, 'binary-weights-content')
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createReplicateProvider(() => 'tok')
    const patch = await provider.poll(job())

    expect(patch.status).toBe('succeeded')
    expect(linkTrainedCharacter).toHaveBeenCalledTimes(1)
    expect(linkTrainedCharacter).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Millie',
      trigger: 'MILLIE_TRIGGER',
    }))
  })

  it('does NOT call linkTrainedCharacter for a style-kind (non-character) LoRA job', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/trainings/')) {
        return res(200, {
          id: 'rep_x',
          status: 'succeeded',
          output: { weights: 'https://replicate.delivery/weights.safetensors', version: 'owner/model:abc123' },
        })
      }
      return res(200, 'binary-weights-content')
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createReplicateProvider(() => 'tok')
    const patch = await provider.poll(job({ loraKind: 'style', outputName: 'style_v1', displayName: 'My Style' }))

    expect(patch.status).toBe('succeeded')
    expect(linkTrainedCharacter).not.toHaveBeenCalled()
  })
})
