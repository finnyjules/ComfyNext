/**
 * Final-review fix (Stage 4 metering): voice-clone settle ownership binding.
 * Without this, status.get.ts settled the CURRENT context user for ANY
 * prediction id passed in — user B polling user A's prediction id charged
 * user A's ledger, and because ledger idempotency is per-user, both users
 * could end up charged for the same job.
 *
 * These tests exercise the exported ownership helpers directly (no route
 * harness) — see server/utils/voiceCloneOwners.ts's module doc for the v1
 * process-local semantics (a restart loses ownership; settle is SKIPPED in
 * that case, never guessed at).
 *
 * Stage 5 Task 2 review finding 1: the second half of this file runs the
 * REAL /api/voice-clone/{start,status} handlers against a fake ledger,
 * because voice-clone is the one paid route whose charge lands on a LATER
 * request. Its preflight used to release the hold immediately, so N
 * sequential starts all passed the gate against the same untouched balance
 * — a genuine parallel overspend. The binding now carries the holdId and
 * the status poll settles THAT hold. The handlers rely on Nitro
 * auto-imports (defineEventHandler/readBody/getQuery/createError/
 * requireReplicateToken), stubbed as globals below before the modules are
 * imported (the loras-local-handlers.unit.spec.ts pattern).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetVoiceCloneOwnersForTests,
  decideVoiceCloneSettle,
  recordVoiceCloneOwner,
  voiceCloneHold,
  voiceCloneOwner,
} from '../../server/utils/voiceCloneOwners'
import {
  __resetMeterContextForTests,
  __setLedgerForTests,
  bindMeterContext,
} from '../../server/utils/requestMeter'
import { VOICE_CLONE_MODEL, MODEL_COSTS } from '../../server/utils/priceBook'
import { _resetRateLimits } from '../../server/lib/rateLimit'

beforeEach(() => {
  __resetVoiceCloneOwnersForTests()
})

describe('recordVoiceCloneOwner / voiceCloneOwner', () => {
  it('round-trips a recorded owner', () => {
    recordVoiceCloneOwner('pred_1', 'user_a')
    expect(voiceCloneOwner('pred_1')).toBe('user_a')
  })

  it('is undefined for a prediction id that was never recorded', () => {
    expect(voiceCloneOwner('pred_never_seen')).toBeUndefined()
  })
})

describe('decideVoiceCloneSettle', () => {
  it('the owner polling their own prediction: settles', () => {
    recordVoiceCloneOwner('pred_1', 'user_a')
    expect(decideVoiceCloneSettle('pred_1', 'user_a')).toEqual({ settle: true })
  })

  it('a non-owner polling someone else\'s prediction: no settle, reason not-owner', () => {
    recordVoiceCloneOwner('pred_1', 'user_a')
    expect(decideVoiceCloneSettle('pred_1', 'user_b')).toEqual({ settle: false, reason: 'not-owner' })
  })

  it('unknown owner (e.g. a restart lost the record): no settle, reason unknown-owner', () => {
    expect(decideVoiceCloneSettle('pred_never_recorded', 'user_a')).toEqual({ settle: false, reason: 'unknown-owner' })
  })

  it('no current user at all (unauthenticated context) against a known owner: no settle, reason not-owner', () => {
    recordVoiceCloneOwner('pred_1', 'user_a')
    expect(decideVoiceCloneSettle('pred_1', undefined)).toEqual({ settle: false, reason: 'not-owner' })
  })

  it('carries the recorded hold through to the settle decision', () => {
    recordVoiceCloneOwner('pred_1', 'user_a', { holdId: 7, credits: 450 })
    expect(voiceCloneHold('pred_1')).toEqual({ holdId: 7, credits: 450 })
    expect(decideVoiceCloneSettle('pred_1', 'user_a')).toEqual({ settle: true, hold: { holdId: 7, credits: 450 } })
  })

  it('a binding with no hold (pre-hold shape / local mode) still settles, with no hold attached', () => {
    recordVoiceCloneOwner('pred_1', 'user_a')
    expect(voiceCloneHold('pred_1')).toBeUndefined()
    expect(decideVoiceCloneSettle('pred_1', 'user_a')).toEqual({ settle: true })
  })
})

/* ------------------------------------------------------------------ *
 * Route-level metering (review finding 1): the real handlers.
 * ------------------------------------------------------------------ */

const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.readBody = async (event: any) => event.body ?? {}
g.getQuery = (event: any) => event.query ?? {}
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string }) => {
  const err = new Error(opts.message ?? opts.statusMessage ?? 'error') as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
}
g.requireReplicateToken = () => 'test-replicate-token'

const CLERK_KEY = 'NUXT_CLERK_SECRET_KEY'
const savedClerkKey = process.env[CLERK_KEY]
const CLONE_CREDITS = MODEL_COSTS[VOICE_CLONE_MODEL]!.credits // 450

let startHandler: (event: any) => Promise<any>
let statusHandler: (event: any) => Promise<any>

beforeAll(async () => {
  startHandler = (await import('../../server/api/voice-clone/start.post')).default as any
  statusHandler = (await import('../../server/api/voice-clone/status.get')).default as any
})

type FakeLedger = {
  getAvailable: ReturnType<typeof vi.fn>
  hold: ReturnType<typeof vi.fn>
  settleHold: ReturnType<typeof vi.fn>
  releaseHold: ReturnType<typeof vi.fn>
  debit: ReturnType<typeof vi.fn>
}
/** A hold that REALLY reserves, so overspend is reproduced, not stubbed. */
function makeFakeLedger(startingAvailable: number): FakeLedger {
  let available = startingAvailable
  let holdSeq = 0
  return {
    getAvailable: vi.fn(async (_userId: string) => available),
    hold: vi.fn(async (_userId: string, estimate: number, _key: string) => {
      if (estimate > available) return { ok: false as const, reason: 'insufficient' as const }
      available -= estimate
      return { ok: true as const, holdId: ++holdSeq }
    }),
    settleHold: vi.fn(async (_holdId: number, _actual: number, _reason: string) => ({ ok: true as const, balance: 0, settled: true })),
    releaseHold: vi.fn(async (holdId: number) => { available += CLONE_CREDITS; void holdId }),
    debit: vi.fn(async (_userId: string, _amount: number, _reason: string, _key: string) => ({ ok: true })),
  }
}

function evt(over: Record<string, unknown> = {}): any {
  return { node: { req: { socket: { remoteAddress: '10.0.0.7' } } }, ...over }
}
function startEvent(): any {
  return evt({ body: { voiceFileUrl: 'https://example.com/voice.wav' } })
}
function statusEvent(id: string): any {
  return evt({ query: { id, name: 'My Voice' } })
}
function json(body: unknown, ok = true, status = 200): any {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body, text: async () => JSON.stringify(body) }
}

/**
 * Replicate stub. Creates return sequential prediction ids; the status GET
 * reports `succeeded` with a deliberately UNSAFE voice_id so status.get.ts
 * short-circuits before writing anything to models/voices — the settle has
 * already happened by then, which is the part under test.
 */
function makeReplicateMock(opts: { createOk?: boolean } = {}): ReturnType<typeof vi.fn> {
  let seq = 0
  return vi.fn(async (url: string) => {
    if (url.endsWith(`/models/${VOICE_CLONE_MODEL}/predictions`)) {
      if (opts.createOk === false) return json({ detail: 'rejected' }, false, 422)
      return json({ id: `pred_${++seq}`, status: 'starting' })
    }
    if (url.startsWith('https://api.replicate.com/v1/predictions/')) {
      return json({
        id: url.split('/').pop(),
        status: 'succeeded',
        output: { voice_id: 'unsafe id!', model: 'speech-02-hd' },
      })
    }
    throw new Error('unexpected fetch url: ' + url)
  })
}

let fakeLedger: FakeLedger
let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

describe('voice-clone routes: the hold spans the async clone', () => {
  beforeEach(() => {
    process.env[CLERK_KEY] = 'sk_test_hosted'
    _resetRateLimits()
    __resetMeterContextForTests()
    __resetVoiceCloneOwnersForTests()
    fakeLedger = makeFakeLedger(CLONE_CREDITS) // exactly ONE clone's worth
    __setLedgerForTests(fakeLedger as any)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    if (savedClerkKey === undefined) delete process.env[CLERK_KEY]
    else process.env[CLERK_KEY] = savedClerkKey
    __setLedgerForTests(null)
    __resetMeterContextForTests()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('PARALLEL OVERSPEND: a balance covering ONE clone refuses the second start while the first is still pending', async () => {
    // enterWith does not cross the beforeEach/test async boundary — every
    // test binds its own context (the request-meter.unit.spec.ts pattern).
    bindMeterContext({ userId: 'u_owner' })
    const fetchMock = makeReplicateMock()
    vi.stubGlobal('fetch', fetchMock)

    const first = await startHandler(startEvent())
    expect(first).toMatchObject({ id: 'pred_1', status: 'starting' })

    // The first clone has NOT finished (status is 'starting', nothing has
    // polled) — its 450cr must still be reserved.
    await expect(startHandler(startEvent())).rejects.toMatchObject({
      statusCode: 402,
      data: { required: CLONE_CREDITS, available: 0 },
    })
    expect(fakeLedger.hold).toHaveBeenCalledTimes(2)
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1) // the refused start never reached Replicate
  })

  it('a successful start binds the hold to the owner and does not release it', async () => {
    bindMeterContext({ userId: 'u_owner' })
    vi.stubGlobal('fetch', makeReplicateMock())

    const res = await startHandler(startEvent())

    expect(voiceCloneOwner(res.id)).toBe('u_owner')
    expect(voiceCloneHold(res.id)).toEqual({ holdId: 1, credits: CLONE_CREDITS })
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('a create that the provider rejects releases the hold and binds nothing', async () => {
    bindMeterContext({ userId: 'u_owner' })
    vi.stubGlobal('fetch', makeReplicateMock({ createOk: false }))

    await expect(startHandler(startEvent())).rejects.toMatchObject({ statusCode: 422 })

    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
    expect(voiceCloneHold('pred_1')).toBeUndefined()
  })

  it('the owner polling a succeeded clone SETTLES the start hold and never debits', async () => {
    bindMeterContext({ userId: 'u_owner' })
    vi.stubGlobal('fetch', makeReplicateMock())
    const started = await startHandler(startEvent())

    const out = await statusHandler(statusEvent(started.id))

    expect(out.status).toBe('succeeded')
    expect(fakeLedger.settleHold).toHaveBeenCalledTimes(1)
    expect(fakeLedger.settleHold).toHaveBeenCalledWith(1, CLONE_CREDITS, `provider:${VOICE_CLONE_MODEL}`)
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('a settle on an already-released hold (swept) logs loudly — output shipped uncharged', async () => {
    bindMeterContext({ userId: 'u_owner' })
    vi.stubGlobal('fetch', makeReplicateMock())
    const started = await startHandler(startEvent())
    fakeLedger.settleHold.mockResolvedValue({ ok: true, balance: 0, settled: false })

    await statusHandler(statusEvent(started.id))

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('SETTLE ON RELEASED HOLD'),
      expect.anything(),
    )
  })

  it('a NON-owner polling the same prediction settles nothing (no hold touched, no debit)', async () => {
    bindMeterContext({ userId: 'u_owner' })
    vi.stubGlobal('fetch', makeReplicateMock())
    const started = await startHandler(startEvent())

    bindMeterContext({ userId: 'u_stranger' })
    await statusHandler(statusEvent(started.id))

    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('owner bound but no hold recorded: falls back to the settleModel debit so the charge still lands', async () => {
    bindMeterContext({ userId: 'u_owner' })
    vi.stubGlobal('fetch', makeReplicateMock())
    // A binding with no holdId — e.g. one recorded by an older build.
    recordVoiceCloneOwner('pred_legacy', 'u_owner')

    await statusHandler(statusEvent('pred_legacy'))

    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.debit).toHaveBeenCalledWith(
      'u_owner', CLONE_CREDITS, `provider:${VOICE_CLONE_MODEL}`, 'rep:pred_legacy',
    )
  })
})
