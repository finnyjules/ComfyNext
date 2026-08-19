/**
 * Task 1 (Stage 4 metering): request meter context + fail-closed price
 * resolution. Covers the ALS context seam, resolveCredits' priority order
 * (MODEL_COSTS → hint → LoRA category for personal slugs → null), and
 * preflightMeter's fail-closed behavior in hosted mode (local mode is a
 * pure no-op).
 *
 * ALS gotcha: bindMeterContext uses AsyncLocalStorage#enterWith, which does
 * NOT scope itself to a single call — the store persists on the async
 * context for everything that runs afterward until something else enters a
 * new store. In a sequential vitest file that means context set by one test
 * can leak into the next. We defend against that with an explicit
 * __resetMeterContextForTests() seam called in beforeEach, so every test
 * starts from a known (unbound) context and opts in explicitly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isError } from 'h3'
import {
  MeterRefusalError,
  __resetMeterContextForTests,
  __setLedgerForTests,
  __setSpendGuardForTests,
  bindMeterContext,
  clearMeterContext,
  currentMeterContext,
  preflightMeter,
  preflightMeterFor,
  resolveCredits,
  settleModel,
  setMeterPriceHint,
} from '../../server/utils/requestMeter'
import { LORA_RENDER_CREDITS, MODEL_COSTS } from '../../server/utils/priceBook'
import { __setSystemControlsDbForTests } from '../../server/utils/systemControls'

const KEY = 'NUXT_CLERK_SECRET_KEY'
const savedKey = process.env[KEY]

function setHosted(): void {
  process.env[KEY] = 'sk_test_hosted'
}
function setLocal(): void {
  delete process.env[KEY]
}

/**
 * Task 2 (Stage 5): the fake now implements the HOLD-based LedgerLike —
 * `hold` really reserves against a live available counter, so a test can
 * reproduce the parallel-preflight leak instead of only asserting call
 * arguments. `debit` stays on the shape because settleModel/anthropicMeter
 * keep their debit-only paths.
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
  let available = opts.available ?? 1000
  let holdSeq = 0
  const fake: FakeLedger = {
    getAvailable: vi.fn(async (_userId: string) => available),
    hold: vi.fn(async (_userId: string, estimate: number, _key: string) => {
      if (estimate > available) return { ok: false as const, reason: 'insufficient' as const }
      available -= estimate // a real reservation — the next hold sees less
      return { ok: true as const, holdId: ++holdSeq }
    }),
    settleHold: vi.fn(async (_holdId: number, _actual: number, _reason: string) => ({ ok: true as const, balance: 0, settled: true })),
    releaseHold: vi.fn(async (_holdId: number) => {}),
    debit: vi.fn(async (_userId: string, _amount: number, _reason: string, _key: string) => ({ ok: true })),
    setAvailable(n: number) { available = n },
  }
  return fake
}

let fakeLedger: FakeLedger

beforeEach(() => {
  __resetMeterContextForTests()
  fakeLedger = makeFakeLedger()
  __setLedgerForTests(fakeLedger as any)
  // Stage 7 Task 4: preflight now calls the operator safety-valve guard first.
  // Existing hosted tests run with no live controls db, so inject a no-op —
  // the guard's own behavior is covered in system-controls.unit.spec.ts.
  __setSpendGuardForTests(async () => {})
})

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY]
  else process.env[KEY] = savedKey
  __setLedgerForTests(null)
  __setSpendGuardForTests(null)
  __resetMeterContextForTests()
})

describe('bindMeterContext / currentMeterContext / setMeterPriceHint', () => {
  it('is null before anything is bound', () => {
    expect(currentMeterContext()).toBeNull()
  })

  it('bind then read round-trips the context', () => {
    bindMeterContext({ userId: 'u1' })
    expect(currentMeterContext()).toEqual({ userId: 'u1' })
  })

  it('setMeterPriceHint mutates the currently bound context', () => {
    bindMeterContext({ userId: 'u1' })
    setMeterPriceHint(42)
    expect(currentMeterContext()).toEqual({ userId: 'u1', priceHintCredits: 42 })
  })

  it('setMeterPriceHint does not throw when no context is bound', () => {
    expect(() => setMeterPriceHint(42)).not.toThrow()
  })

  /**
   * Regression for the ALS propagation bug found live during Task 3 (see
   * the module doc's CRITICAL ALS propagation gotcha). Reproduces the
   * exact shape of Nitro's real dispatch: a "middleware" that clears the
   * context synchronously (no prior await, matching auth.ts calling
   * clearMeterContext as its first statement), then does an internal
   * await (like resolveHostedUserId's network call) BEFORE binding — and
   * a separate "next middleware" awaited from the SAME outer caller,
   * exactly like Nitro's `await mw(event); await next(event)` stack.
   * Verified against real h3 too (not just this synthetic shape) before
   * landing the fix; a naive `bindMeterContext` that called a fresh
   * `enterWith` after the internal await failed this same shape.
   */
  it('propagates a context bound after an internal await to a SEPARATE later-awaited call (real h3 dispatch shape)', async () => {
    async function middleware(): Promise<void> {
      clearMeterContext()
      await new Promise((r) => setTimeout(r, 0)) // internal await, like resolveHostedUserId
      bindMeterContext({ userId: 'user_1' })
    }
    async function nextHandler(): Promise<ReturnType<typeof currentMeterContext>> {
      return currentMeterContext()
    }

    await middleware()
    // A SEPARATE call, awaited from the same outer scope as `middleware()`
    // above — exactly how Nitro invokes the next middleware/route handler.
    const seen = await nextHandler()

    expect(seen).toEqual({ userId: 'user_1' })
  })

  it('a hosted request that never binds (public path) is cleared, not stale, for a SEPARATE later-awaited call', async () => {
    bindMeterContext({ userId: 'stale_user' })

    async function middleware(): Promise<void> {
      clearMeterContext()
      await new Promise((r) => setTimeout(r, 0))
      // No bindMeterContext call here — mirrors the public-path short-circuit.
    }
    async function nextHandler(): Promise<ReturnType<typeof currentMeterContext>> {
      return currentMeterContext()
    }

    await middleware()
    const seen = await nextHandler()

    expect(seen).toBeNull()
  })
})

describe('resolveCredits', () => {
  it('uses MODEL_COSTS when the exact slug is priced', () => {
    const knownSlug = Object.keys(MODEL_COSTS)[0]
    expect(resolveCredits(knownSlug)).toBe(MODEL_COSTS[knownSlug].credits)
  })

  it('falls back to the hint for an unpriced public-org slug', () => {
    expect(resolveCredits('black-forest-labs/not-in-book', 33)).toBe(33)
  })

  it('returns null for an unpriced public-org slug with no hint', () => {
    expect(resolveCredits('black-forest-labs/not-in-book')).toBeNull()
  })

  it('falls back to the LoRA category for a personal slug with no hint', () => {
    expect(resolveCredits('finnyjules/jules-jene')).toBe(LORA_RENDER_CREDITS)
  })

  it('a hint still wins over the LoRA category for a personal slug', () => {
    expect(resolveCredits('finnyjules/jules-jene', 99)).toBe(99)
  })

  it('returns null for a slug with no owner segment and no hint', () => {
    expect(resolveCredits('no-slash-here')).toBeNull()
  })
})

describe('preflightMeter', () => {
  it('(a) local mode: returns null and never touches the ledger', async () => {
    setLocal()
    const ticket = await preflightMeter('black-forest-labs/flux-dev')
    expect(ticket).toBeNull()
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.hold).not.toHaveBeenCalled()
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('(a2) hosted, a paused system: preflight throws 503 and NO hold is taken', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    // The real safety-valve guard, backed by a paused controls db — proves the
    // wire-up refuses BEFORE the ledger hold.
    __setSpendGuardForTests(null)
    __setSystemControlsDbForTests({
      query: async (sql: string) => {
        if (/FROM system_controls/i.test(sql)) return { rows: [{ global_paused: true }] }
        return { rows: [] }
      },
    })
    try {
      const err = await preflightMeter('black-forest-labs/flux-dev').then(() => null, e => e)
      expect(err).toBeInstanceOf(MeterRefusalError)
      expect(err.statusCode).toBe(503)
      expect(fakeLedger.hold).not.toHaveBeenCalled()
      expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    } finally {
      __setSystemControlsDbForTests(null)
    }
  })

  it('(b) hosted, no bound context: throws a 500 refusal', async () => {
    setHosted()
    await expect(preflightMeter('black-forest-labs/flux-dev')).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining('unmetered spend refused'),
    })
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.hold).not.toHaveBeenCalled()
  })

  it('(b2) the rejection is a MeterRefusalError instance', async () => {
    setHosted()
    await expect(preflightMeter('black-forest-labs/flux-dev')).rejects.toBeInstanceOf(MeterRefusalError)
  })

  it('(c) hosted, unpriced public-org slug: throws a 500 unpriced refusal', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    await expect(preflightMeter('black-forest-labs/not-in-book')).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining('unpriced model refused: black-forest-labs/not-in-book'),
    })
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.hold).not.toHaveBeenCalled()
  })

  it('(d) hosted, personal LoRA slug: prices by category, RESERVES via hold, settle settles that hold', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)

    const ticket = await preflightMeter('finnyjules/jules-jene')
    expect(ticket).not.toBeNull()
    expect(fakeLedger.hold).toHaveBeenCalledWith('u1', LORA_RENDER_CREDITS, expect.stringMatching(/^meter:/))

    await ticket!.settle('fal:REQ1')
    expect(fakeLedger.settleHold).toHaveBeenCalledWith(1, LORA_RENDER_CREDITS, 'provider:finnyjules/jules-jene')
    // The hold IS the charge — no separate debit on the provider path.
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('(e) hosted, priced slug the hold refuses: throws 402 with {required, available} read from getAvailable', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    const priced = 'black-forest-labs/flux-dev'
    const required = MODEL_COSTS[priced].credits
    fakeLedger.setAvailable(required - 1)

    await expect(preflightMeter(priced)).rejects.toMatchObject({
      statusCode: 402,
      data: { required, available: required - 1 },
    })
    expect(fakeLedger.hold).toHaveBeenCalledTimes(1)
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('(e2) hosted, the hold THROWS (no wallet row for this user): refuses 402, never a raw 500', async () => {
    // Review finding 3: ledger.hold throws a plain Error ("no wallet for
    // <id> — call ensureUser first") for a user with no wallet row. A
    // non-h3 error is stripped by Nitro's prod handler to a generic 500, so
    // the user saw "Server Error" instead of "you have no credits". A user
    // with no wallet has zero credits — that is a refusal, not a fault.
    setHosted()
    bindMeterContext({ userId: 'u_no_wallet' })
    const priced = 'black-forest-labs/flux-dev'
    const required = MODEL_COSTS[priced].credits
    fakeLedger.hold.mockRejectedValue(new Error('ledger.hold: no wallet for u_no_wallet — call ensureUser first'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const err = await preflightMeter(priced).then(() => null, e => e)
      expect(err).toBeInstanceOf(MeterRefusalError)
      expect(err.statusCode).toBe(402)
      expect(err.message).toBe('insufficient credits')
      expect(err.data).toEqual({ required, available: 0 })
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[meter] HOLD FAILED'),
        expect.anything(),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('(e3) a thrown hold does not fall through to getAvailable (that would throw too)', async () => {
    setHosted()
    bindMeterContext({ userId: 'u_no_wallet' })
    fakeLedger.hold.mockRejectedValue(new Error('ledger.hold: no wallet for u_no_wallet'))
    fakeLedger.getAvailable.mockRejectedValue(new Error('no wallet for u_no_wallet'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(preflightMeter('black-forest-labs/flux-dev')).rejects.toMatchObject({ statusCode: 402 })
    } finally {
      spy.mockRestore()
    }
  })

  it('(f) hint overrides an unpriced slug so preflight succeeds', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    setMeterPriceHint(15)
    fakeLedger.setAvailable(100)

    const ticket = await preflightMeter('black-forest-labs/not-in-book')
    expect(ticket).not.toBeNull()

    await ticket!.settle('job-hinted')
    expect(fakeLedger.settleHold).toHaveBeenCalledWith(1, 15, 'provider:black-forest-labs/not-in-book')
  })

  it('(g) settle logs loudly and does not rethrow when settleHold throws', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    fakeLedger.settleHold.mockRejectedValue(new Error('ledger exploded'))

    const ticket = await preflightMeter('finnyjules/jules-jene')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(ticket!.settle('job-boom')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[meter] SETTLE FAILED after successful job'),
        expect.anything(),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('(g2) settle escalates loudly when the hold was already released (settled:false — output shipped uncharged)', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    fakeLedger.settleHold.mockResolvedValue({ ok: true, balance: 0, settled: false })

    const ticket = await preflightMeter('finnyjules/jules-jene')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(ticket!.settle('job-released')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[meter] SETTLE ON RELEASED HOLD'),
        expect.anything(),
      )
    } finally {
      spy.mockRestore()
    }
  })

  /**
   * THE LEAK REPRODUCTION (Stage 5 Task 2). Under the old debit-only
   * preflight, every in-flight request checked `getAvailable` against an
   * untouched balance: N parallel expensive calls all passed the same
   * preflight and only discovered the shortfall at settle time, when the
   * provider work had already been paid for. With holds, preflight #1
   * RESERVES its estimate, so preflight #3 sees only what is left.
   *
   * Broken control (observed RED, before requestMeter.ts was converted):
   *   AssertionError: promise resolved "{ settle: [AsyncFunction settle] }"
   *   instead of rejecting
   * — the third preflight sailed through because the old code path never
   * called `hold` at all (fakeLedger.hold call count was 0).
   */
  it('sequential preflights cannot overshoot one balance (hold-based)', async () => {
    setHosted()
    const model = 'black-forest-labs/flux-dev'
    const price = MODEL_COSTS[model].credits // 5cr
    fakeLedger.setAvailable(price * 2)

    await preflightMeterFor('u1', model) // reserves 5 — ok
    await preflightMeterFor('u1', model) // reserves 5 — ok, nothing left
    await expect(preflightMeterFor('u1', model)).rejects.toMatchObject({ statusCode: 402 })

    expect(fakeLedger.hold).toHaveBeenCalledTimes(3)
    expect(fakeLedger.hold.mock.results[2]).toBeDefined()
  })

  it('ticket.release releases the hold and never settles it', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)

    const ticket = await preflightMeter('finnyjules/jules-jene')
    await ticket!.release()

    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('ticket.release swallows + logs a releaseHold failure (must never crash a failure path)', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    fakeLedger.releaseHold.mockRejectedValue(new Error('ledger exploded'))

    const ticket = await preflightMeter('finnyjules/jules-jene')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(ticket!.release()).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[meter] HOLD RELEASE FAILED'),
        expect.anything(),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('each preflight gets its own idempotency key (two holds are never deduped into one)', async () => {
    setHosted()
    fakeLedger.setAvailable(1000)

    await preflightMeterFor('u1', 'black-forest-labs/flux-dev')
    await preflightMeterFor('u1', 'black-forest-labs/flux-dev')

    const keys = fakeLedger.hold.mock.calls.map(c => c[2])
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[0]).toMatch(/^meter:/)
  })
})

// Final-review fix: h3's isError is a duck-check on
// `constructor.__h3_error__`, not `instanceof H3Error` — a MeterRefusalError
// that fails this check gets rewrapped by h3's toNodeListener catch with
// `unhandled = true`, and Nitro's prod error handler then strips
// message/data and replaces them with a generic "Server Error" before the
// response reaches the client. Assert against the REAL h3 `isError`, not a
// reimplementation of the duck-check, so this test tracks h3's actual
// behavior across upgrades.
describe('MeterRefusalError is h3-shaped', () => {
  it('isError(real h3) recognizes MeterRefusalError', () => {
    expect(isError(new MeterRefusalError('insufficient credits', 402, { required: 5, available: 1 }))).toBe(true)
  })

  it('a thrown 402 refusal still carries {required, available} in .data', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    const priced = 'black-forest-labs/flux-dev'
    const required = MODEL_COSTS[priced].credits
    fakeLedger.setAvailable(required - 1)

    try {
      await preflightMeter(priced)
      throw new Error('expected preflightMeter to throw')
    } catch (err) {
      expect(isError(err)).toBe(true)
      expect((err as MeterRefusalError).fatal).toBe(false)
      expect((err as MeterRefusalError).unhandled).toBe(false)
      expect((err as MeterRefusalError).data).toEqual({ required, available: required - 1 })
    }
  })
})

// Review escalation 2026-08-14: unknown owners REFUSE — only allowlisted
// personal-LoRA orgs get category pricing, so a typo'd public org can never
// silently underprice as an 8cr LoRA render.
describe('resolveCredits owner allowlist (fail-closed)', () => {
  it('allowlisted personal org prices as LoRA category', () => {
    expect(resolveCredits('finnyjules/jules-jene')).toBe(8)
  })
  it("typo'd public org refuses instead of pricing as LoRA", () => {
    expect(resolveCredits('black-forset-labs/flux-dev')).toBeNull()
  })
  it('never-seen owner refuses', () => {
    expect(resolveCredits('stranger/some-model')).toBeNull()
  })
})

// Task 4: settleModel — debit-only settlement for async jobs whose success
// is confirmed on a LATER request (voice-clone/status polling the prediction
// started, but only preflight-gated, by voice-clone/start).
describe('settleModel', () => {
  it('local mode: no-op, never touches the ledger', async () => {
    setLocal()
    await settleModel('finnyjules/jules-jene', 'rep:pred1')
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted: debits the current context user with exact args', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })

    await settleModel('finnyjules/jules-jene', 'rep:pred1')

    expect(fakeLedger.debit).toHaveBeenCalledWith('u1', LORA_RENDER_CREDITS, 'provider:finnyjules/jules-jene', 'rep:pred1')
  })

  it('hosted, priced model with a hint: hint is ignored in favor of the priced entry', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    const priced = 'black-forest-labs/flux-dev'

    await settleModel(priced, 'rep:pred2')

    expect(fakeLedger.debit).toHaveBeenCalledWith('u1', MODEL_COSTS[priced].credits, `provider:${priced}`, 'rep:pred2')
  })

  it('hosted, no bound context: logs loudly, does not throw, never touches the ledger', async () => {
    setHosted()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(settleModel('finnyjules/jules-jene', 'rep:pred3')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[meter] settleModel without context'),
        expect.anything(),
      )
      expect(fakeLedger.debit).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('hosted, unpriced model with no hint: logs loudly, does not throw, never touches the ledger', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(settleModel('black-forest-labs/not-in-book', 'rep:pred4')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalled()
      expect(fakeLedger.debit).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('hosted: a refused debit (ledger throws) logs loudly and does not throw — job stays delivered unmetered', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.debit.mockRejectedValue(new Error('ledger exploded'))

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(settleModel('finnyjules/jules-jene', 'rep:pred5')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[meter] DEBIT FAILED after successful job'),
        expect.anything(),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('hosted: a refused debit (ledger resolves ok:false) logs loudly and does not throw', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.debit.mockResolvedValue({ ok: false })

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(settleModel('finnyjules/jules-jene', 'rep:pred6')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[meter] DEBIT FAILED after successful job'),
        expect.anything(),
      )
    } finally {
      spy.mockRestore()
    }
  })
})
