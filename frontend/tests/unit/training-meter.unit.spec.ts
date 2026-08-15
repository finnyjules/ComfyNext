/**
 * Task 5 (Stage 4 metering): the training family — the most expensive
 * action in the app (600cr, hardware-billed). Two things under test:
 *
 *  1. preflightMeterFor(userId, model) — requestMeter.ts's context-free
 *     variant for callers with no request/ALS context. Same checks as
 *     preflightMeter, minus the ALS lookup (userId is passed explicitly).
 *
 *  2. trainingProviders.ts's createReplicateProvider().start — the queue
 *     runner ticks with no HTTP request in flight, so job.userId (captured
 *     at enqueue time — see trainingQueue.ts / training-queue/index.post.ts)
 *     is threaded through to preflightMeterFor explicitly. CHARGING POLICY:
 *     debit at successful job START (a replicateId came back), never at
 *     completion — hardware time is consumed regardless of final quality.
 *     Local-mode jobs (no userId) must never touch the ledger at all.
 *
 * This file was written first per the task's TDD requirement — on the
 * unmodified tree (before this task's edits) it fails because
 * preflightMeterFor doesn't exist yet and trainingProviders.ts's start()
 * dispatches straight to Replicate with no metering. That's this file's RED,
 * alongside bypass-route-meter.unit.spec.ts's TASK5_TRAINING_ALLOWLIST
 * removal (its coverage guard now scans cloud-train/* + trainingProviders.ts
 * too, and failed until those files carried preflightMeter/settleModel/
 * METER-EXEMPT markers).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetMeterContextForTests,
  __setLedgerForTests,
  MeterRefusalError,
  preflightMeterFor,
} from '~~/server/utils/requestMeter'
import { MODEL_COSTS } from '~~/server/utils/priceBook'
import { createReplicateProvider } from '~~/server/utils/trainingProviders'
import type { TrainingJob } from '~~/server/utils/trainingQueue'
import { createJobStore } from '~~/server/utils/trainingQueue'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const KEY = 'NUXT_CLERK_SECRET_KEY'
const savedKey = process.env[KEY]
function setHosted(): void { process.env[KEY] = 'sk_test_hosted' }
function setLocal(): void { delete process.env[KEY] }

type FakeLedger = { getAvailable: ReturnType<typeof vi.fn>, debit: ReturnType<typeof vi.fn> }
function makeFakeLedger(opts: { available?: number } = {}): FakeLedger {
  const available = opts.available ?? 10_000
  return {
    getAvailable: vi.fn(async (_userId: string) => available),
    debit: vi.fn(async (_userId: string, _amount: number, _reason: string, _key: string) => ({ ok: true })),
  }
}

let fakeLedger: FakeLedger
beforeEach(() => {
  __resetMeterContextForTests()
  fakeLedger = makeFakeLedger()
  __setLedgerForTests(fakeLedger as any)
})
afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY]
  else process.env[KEY] = savedKey
  __setLedgerForTests(null)
  __resetMeterContextForTests()
  vi.unstubAllGlobals()
})

describe('preflightMeterFor (context-free variant, no ALS)', () => {
  it('local mode: returns null and never touches the ledger', async () => {
    setLocal()
    const ticket = await preflightMeterFor('u1', 'ostris/flux-dev-lora-trainer')
    expect(ticket).toBeNull()
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
  })

  it('hosted, priced model, sufficient balance: returns a ticket; settle debits provider:<model> keyed by the given jobId', async () => {
    setHosted()
    const ticket = await preflightMeterFor('u1', 'ostris/flux-dev-lora-trainer')
    expect(ticket).not.toBeNull()
    expect(fakeLedger.getAvailable).toHaveBeenCalledWith('u1')

    await ticket!.settle('train:rep_123')
    expect(fakeLedger.debit).toHaveBeenCalledWith(
      'u1', MODEL_COSTS['ostris/flux-dev-lora-trainer'].credits, 'provider:ostris/flux-dev-lora-trainer', 'train:rep_123',
    )
    // Book parity: 600cr, matching LoraTrainingNode's graph-table price.
    expect(MODEL_COSTS['ostris/flux-dev-lora-trainer'].credits).toBe(600)
  })

  it('hosted, unpriced model: fails closed (throws) rather than inventing a price', async () => {
    setHosted()
    await expect(preflightMeterFor('u1', 'not-a-real/trainer-slug')).rejects.toBeInstanceOf(MeterRefusalError)
    await expect(preflightMeterFor('u1', 'not-a-real/trainer-slug')).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining('unpriced model refused'),
    })
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted, insufficient balance: throws 402 with {required, available}, never debits', async () => {
    setHosted()
    fakeLedger.getAvailable.mockResolvedValue(100)
    const required = MODEL_COSTS['ostris/flux-dev-lora-trainer'].credits
    await expect(preflightMeterFor('u1', 'ostris/flux-dev-lora-trainer')).rejects.toMatchObject({
      statusCode: 402,
      message: 'insufficient credits',
      data: { required, available: 100 },
    })
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('never reads/needs a bound ALS context — works with none bound at all', async () => {
    setHosted()
    // __resetMeterContextForTests() in beforeEach already leaves nothing
    // bound; this just documents the guarantee explicitly.
    const ticket = await preflightMeterFor('u2', 'ostris/sdxl-lora-trainer')
    expect(ticket).not.toBeNull()
  })
})

// --- trainingProviders.ts: the queue runner's actual start() dispatch -----

function job(over: Partial<TrainingJob> = {}): TrainingJob {
  const ts = '2026-08-14T00:00:00.000Z'
  return {
    id: 'j1',
    kind: 'lora',
    status: 'starting',
    outputName: 'my_style',
    displayName: 'My Style',
    datasetUrl: 'https://replicate/files/abc',
    params: { family: 'flux' },
    progressPct: 0,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  }
}

/** Minimal Response-like stub for global fetch. */
function res(status: number, body: unknown = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response
}

/** Wires up the fetch sequence a successful LoRA training start makes. */
function stubLoraStartFetches(trainingId = 'train_abc') {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url.includes('/account')) return res(200, { username: 'jules' })
    if (url.includes('/trainings')) return res(200, { id: trainingId, status: 'starting' })
    if (url.includes('/models') && !url.includes('/versions')) {
      // Both the model-lookup GET and the destination-create POST hit this
      // shape; the lookup (GET, no body semantics here) needs latest_version.
      return res(200, { latest_version: { id: 'v1' }, username: 'jules' })
    }
    return res(200, {})
  }))
  return calls
}

function stubVoiceStartFetches(predictionId = 'pred_abc') {
  vi.stubGlobal('fetch', vi.fn(async () => res(200, { id: predictionId, status: 'starting' })))
}

describe('trainingProviders.createReplicateProvider().start — debit-at-start metering', () => {
  it('local-mode job (no userId): starts on Replicate but never touches the ledger', async () => {
    setHosted() // ledger IS reachable — proves the skip is the userId guard, not deployMode
    fakeLedger.getAvailable.mockResolvedValue(10_000)
    stubLoraStartFetches('train_local')

    const provider = createReplicateProvider(() => 'tok')
    const result = await provider.start(job({ userId: undefined }))

    expect(result.replicateId).toBe('train_local')
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted job with userId, family flux: preflights ostris/flux-dev-lora-trainer at 600cr, settles train:<id> after Replicate confirms the start', async () => {
    setHosted()
    fakeLedger.getAvailable.mockResolvedValue(10_000)
    stubLoraStartFetches('train_flux_1')

    const provider = createReplicateProvider(() => 'tok')
    const result = await provider.start(job({ userId: 'u1', params: { family: 'flux' } }))

    expect(result.replicateId).toBe('train_flux_1')
    expect(fakeLedger.getAvailable).toHaveBeenCalledWith('u1')
    expect(fakeLedger.debit).toHaveBeenCalledWith(
      'u1', 600, 'provider:ostris/flux-dev-lora-trainer', 'train:train_flux_1',
    )
  })

  it('hosted job with userId, family sdxl_sd15: preflights ostris/sdxl-lora-trainer, still 600cr', async () => {
    setHosted()
    fakeLedger.getAvailable.mockResolvedValue(10_000)
    stubLoraStartFetches('train_sdxl_1')

    const provider = createReplicateProvider(() => 'tok')
    await provider.start(job({ userId: 'u1', params: { family: 'sdxl_sd15' } }))

    expect(fakeLedger.debit).toHaveBeenCalledWith(
      'u1', 600, 'provider:ostris/sdxl-lora-trainer', 'train:train_sdxl_1',
    )
  })

  it('hosted voice job with userId: preflights minimax/voice-cloning, settles train:<prediction id>', async () => {
    setHosted()
    fakeLedger.getAvailable.mockResolvedValue(10_000)
    stubVoiceStartFetches('pred_voice_1')

    const provider = createReplicateProvider(() => 'tok')
    const result = await provider.start(job({ kind: 'voice', userId: 'u1', params: {} }))

    expect(result.replicateId).toBe('pred_voice_1')
    expect(fakeLedger.debit).toHaveBeenCalledWith(
      'u1', MODEL_COSTS['minimax/voice-cloning'].credits, 'provider:minimax/voice-cloning', 'train:pred_voice_1',
    )
  })

  it('insufficient credits: refuses BEFORE touching Replicate, throws with "insufficient credits" (what tickQueue records on the failed job)', async () => {
    setHosted()
    fakeLedger.getAvailable.mockResolvedValue(0)
    const fetchSpy = vi.fn(async () => res(200, {}))
    vi.stubGlobal('fetch', fetchSpy)

    const provider = createReplicateProvider(() => 'tok')
    await expect(provider.start(job({ userId: 'u1' }))).rejects.toMatchObject({ message: 'insufficient credits' })

    expect(fetchSpy).not.toHaveBeenCalled() // never reached Replicate — no hardware spend happened
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('Replicate rejects the training creation after a successful preflight: ticket is never settled (no charge for a job that never started)', async () => {
    setHosted()
    fakeLedger.getAvailable.mockResolvedValue(10_000)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/account')) return res(200, { username: 'jules' })
      if (url.includes('/trainings')) return res(500, 'upstream error') // the actual training-create call fails
      return res(200, { latest_version: { id: 'v1' } })
    }))

    const provider = createReplicateProvider(() => 'tok')
    await expect(provider.start(job({ userId: 'u1' }))).rejects.toThrow()

    expect(fakeLedger.getAvailable).toHaveBeenCalled() // preflight DID run
    expect(fakeLedger.debit).not.toHaveBeenCalled() // but never charged — start never confirmed
  })
})

// --- trainingQueue.ts: userId threading at enqueue time --------------------

describe('trainingQueue userId field (threaded from enqueue to the runner)', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cn-meter-jobs-')) })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  const sampleInput = {
    kind: 'lora' as const,
    outputName: 'my_style',
    displayName: 'My Style',
    datasetUrl: 'https://replicate/files/abc',
    params: { family: 'flux' },
  }

  it('add() persists a supplied userId', async () => {
    const store = createJobStore(path.join(dir, 'jobs.json'))
    const j = await store.add({ ...sampleInput, userId: 'u1' })
    expect(j.userId).toBe('u1')
    expect((await store.get(j.id))?.userId).toBe('u1')
  })

  it('add() defaults userId to null when absent (local-mode enqueue shape)', async () => {
    const store = createJobStore(path.join(dir, 'jobs.json'))
    const j = await store.add(sampleInput)
    expect(j.userId).toBeNull()
  })
})
