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
 * OWNERSHIP GUARD (fix-wave, 2026-08-15): the skip above is gated on
 * deployMode(), not on job.userId's mere presence — JSON.stringify drops
 * `undefined` keys, so a legacy pre-deploy job and a local-mode job (which
 * writes an explicit `userId: null`) are indistinguishable on disk from "key
 * absent". In hosted mode ANY job without a string userId now refuses before
 * the provider is ever called, instead of quietly running for free.
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
  __setSpendGuardForTests,
  MeterRefusalError,
  preflightMeterFor,
} from '~~/server/utils/requestMeter'
import { MODEL_COSTS, VOICE_CLONE_MODEL } from '~~/server/utils/priceBook'
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

/**
 * Stage 5 Task 2: preflight tickets are HOLD-based, so the fake reserves
 * against a live counter. Training still charges AT START (the hold is
 * settled the moment Replicate confirms the training was created) — that
 * policy is unchanged; only the mechanism moved from debit to hold+settle.
 */
type FakeLedger = {
  getAvailable: ReturnType<typeof vi.fn>
  hold: ReturnType<typeof vi.fn>
  settleHold: ReturnType<typeof vi.fn>
  releaseHold: ReturnType<typeof vi.fn>
  debit: ReturnType<typeof vi.fn>
  setAvailable(n: number): void
}
function makeFakeLedger(opts: { available?: number } = {}): FakeLedger {
  let available = opts.available ?? 10_000
  let holdSeq = 0
  return {
    getAvailable: vi.fn(async (_userId: string) => available),
    hold: vi.fn(async (_userId: string, estimate: number, _key: string) => {
      if (estimate > available) return { ok: false as const, reason: 'insufficient' as const }
      available -= estimate
      return { ok: true as const, holdId: ++holdSeq }
    }),
    settleHold: vi.fn(async (_holdId: number, _actual: number, _reason: string) => ({ ok: true as const, balance: 0, settled: true })),
    releaseHold: vi.fn(async (_holdId: number) => {}),
    debit: vi.fn(async (_userId: string, _amount: number, _reason: string, _key: string) => ({ ok: true })),
    setAvailable(n: number) { available = n },
  }
}

let fakeLedger: FakeLedger
beforeEach(() => {
  __resetMeterContextForTests()
  fakeLedger = makeFakeLedger()
  __setLedgerForTests(fakeLedger as any)
  // Stage 7 final review C2: preflightMeterFor now runs the operator spend
  // guard first. Inject a no-op — no live controls db here — so the guard's
  // own behavior stays covered by system-controls.unit.spec.ts and these
  // hosted cases don't fail-close to 503 on a missing DATABASE_URL.
  __setSpendGuardForTests(async () => {})
})
afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY]
  else process.env[KEY] = savedKey
  __setLedgerForTests(null)
  __setSpendGuardForTests(null)
  __resetMeterContextForTests()
  vi.unstubAllGlobals()
})

describe('preflightMeterFor (context-free variant, no ALS)', () => {
  it('local mode: returns null and never touches the ledger', async () => {
    setLocal()
    const ticket = await preflightMeterFor('u1', 'ostris/flux-dev-lora-trainer')
    expect(ticket).toBeNull()
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.hold).not.toHaveBeenCalled()
  })

  it('hosted, priced model, sufficient balance: returns a ticket; settle settles the hold as provider:<model>', async () => {
    setHosted()
    const ticket = await preflightMeterFor('u1', 'ostris/flux-dev-lora-trainer')
    expect(ticket).not.toBeNull()
    expect(fakeLedger.hold).toHaveBeenCalledWith(
      'u1', MODEL_COSTS['ostris/flux-dev-lora-trainer'].credits, expect.stringMatching(/^meter:/),
    )

    await ticket!.settle('train:rep_123')
    expect(fakeLedger.settleHold).toHaveBeenCalledWith(
      1, MODEL_COSTS['ostris/flux-dev-lora-trainer'].credits, 'provider:ostris/flux-dev-lora-trainer',
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
    fakeLedger.setAvailable(100)
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
  it('local mode, no userId: runs unmetered (provider called, ledger never touched)', async () => {
    setLocal()
    stubLoraStartFetches('train_local')

    const provider = createReplicateProvider(() => 'tok')
    const result = await provider.start(job({ userId: undefined }))

    expect(result.replicateId).toBe('train_local')
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted mode, absent userId (legacy/keyless job): refuses BEFORE touching Replicate, never starts the provider', async () => {
    setHosted() // ledger IS reachable — proves the refusal is deployMode-driven, not a ledger failure
    fakeLedger.setAvailable(10_000)
    const fetchSpy = vi.fn(async () => res(200, {}))
    vi.stubGlobal('fetch', fetchSpy)

    const provider = createReplicateProvider(() => 'tok')
    await expect(provider.start(job({ userId: undefined }))).rejects.toMatchObject({
      message: expect.stringContaining('re-queue this training'),
    })

    expect(fetchSpy).not.toHaveBeenCalled() // provider.start's Replicate calls never fired
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted mode, explicit-null userId (local-mode-shaped record replayed on a hosted server): same refusal as absent', async () => {
    setHosted()
    fakeLedger.setAvailable(10_000)
    const fetchSpy = vi.fn(async () => res(200, {}))
    vi.stubGlobal('fetch', fetchSpy)

    const provider = createReplicateProvider(() => 'tok')
    await expect(provider.start(job({ userId: null }))).rejects.toMatchObject({
      message: expect.stringContaining('re-queue this training'),
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted job with userId, family flux: preflights ostris/flux-dev-lora-trainer at 600cr, settles train:<id> after Replicate confirms the start', async () => {
    setHosted()
    fakeLedger.setAvailable(10_000)
    stubLoraStartFetches('train_flux_1')

    const provider = createReplicateProvider(() => 'tok')
    const result = await provider.start(job({ userId: 'u1', params: { family: 'flux' } }))

    expect(result.replicateId).toBe('train_flux_1')
    expect(fakeLedger.hold).toHaveBeenCalledWith('u1', 600, expect.stringMatching(/^meter:/))
    expect(fakeLedger.settleHold).toHaveBeenCalledWith(1, 600, 'provider:ostris/flux-dev-lora-trainer')
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
  })

  it('hosted job with userId, family sdxl_sd15: preflights ostris/sdxl-lora-trainer, still 600cr', async () => {
    setHosted()
    fakeLedger.setAvailable(10_000)
    stubLoraStartFetches('train_sdxl_1')

    const provider = createReplicateProvider(() => 'tok')
    await provider.start(job({ userId: 'u1', params: { family: 'sdxl_sd15' } }))

    expect(fakeLedger.settleHold).toHaveBeenCalledWith(1, 600, 'provider:ostris/sdxl-lora-trainer')
  })

  it('hosted voice job with userId: preflights minimax/voice-cloning, settles train:<prediction id>', async () => {
    setHosted()
    fakeLedger.setAvailable(10_000)
    stubVoiceStartFetches('pred_voice_1')

    const provider = createReplicateProvider(() => 'tok')
    const result = await provider.start(job({ kind: 'voice', userId: 'u1', params: {} }))

    expect(result.replicateId).toBe('pred_voice_1')
    expect(fakeLedger.settleHold).toHaveBeenCalledWith(
      1, MODEL_COSTS['minimax/voice-cloning'].credits, 'provider:minimax/voice-cloning',
    )
  })

  it('insufficient credits: refuses BEFORE touching Replicate, message carries the required/available numbers (what tickQueue records on the failed job — it only reads err.message)', async () => {
    setHosted()
    fakeLedger.setAvailable(37)
    const fetchSpy = vi.fn(async () => res(200, {}))
    vi.stubGlobal('fetch', fetchSpy)

    const provider = createReplicateProvider(() => 'tok')
    await expect(provider.start(job({ userId: 'u1' }))).rejects.toMatchObject({
      message: 'insufficient credits — need 600, have 37',
    })

    expect(fetchSpy).not.toHaveBeenCalled() // never reached Replicate — no hardware spend happened
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('Replicate rejects the training creation after a successful preflight: hold is RELEASED, never settled (no charge, no locked credits)', async () => {
    setHosted()
    fakeLedger.setAvailable(10_000)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/account')) return res(200, { username: 'jules' })
      if (url.includes('/trainings')) return res(500, 'upstream error') // the actual training-create call fails
      return res(200, { latest_version: { id: 'v1' } })
    }))

    const provider = createReplicateProvider(() => 'tok')
    await expect(provider.start(job({ userId: 'u1' }))).rejects.toThrow()

    expect(fakeLedger.hold).toHaveBeenCalled() // preflight DID reserve
    expect(fakeLedger.settleHold).not.toHaveBeenCalled() // but never charged — start never confirmed
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1) // and the reservation came back
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

// --- priceBook.ts: VOICE_CLONE_MODEL / MODEL_COSTS parity ------------------

describe('priceBook VOICE_CLONE_MODEL', () => {
  it('names a row that actually exists in MODEL_COSTS (single source of truth for the slug)', () => {
    expect(MODEL_COSTS[VOICE_CLONE_MODEL]).toBeDefined()
    expect(VOICE_CLONE_MODEL).toBe('minimax/voice-cloning')
  })
})
