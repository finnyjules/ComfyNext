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
import {
  MeterRefusalError,
  __resetMeterContextForTests,
  __setLedgerForTests,
  bindMeterContext,
  clearMeterContext,
  currentMeterContext,
  preflightMeter,
  resolveCredits,
  setMeterPriceHint,
} from '../../server/utils/requestMeter'
import { LORA_RENDER_CREDITS, MODEL_COSTS } from '../../server/utils/priceBook'

const KEY = 'NUXT_CLERK_SECRET_KEY'
const savedKey = process.env[KEY]

function setHosted(): void {
  process.env[KEY] = 'sk_test_hosted'
}
function setLocal(): void {
  delete process.env[KEY]
}

type FakeLedger = {
  getAvailable: ReturnType<typeof vi.fn>
  debit: ReturnType<typeof vi.fn>
}

function makeFakeLedger(opts: { available?: number; debitImpl?: () => Promise<{ ok: boolean }> } = {}): FakeLedger {
  const available = opts.available ?? 1000
  return {
    getAvailable: vi.fn(async (_userId: string) => available),
    debit: vi.fn(opts.debitImpl ?? (async (_userId: string, _amount: number, _reason: string, _key: string) => ({ ok: true }))),
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
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('(b) hosted, no bound context: throws a 500 refusal', async () => {
    setHosted()
    await expect(preflightMeter('black-forest-labs/flux-dev')).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining('unmetered spend refused'),
    })
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
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
  })

  it('(d) hosted, personal LoRA slug: prices by category, checks available, settle debits correctly', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(100)

    const ticket = await preflightMeter('finnyjules/jules-jene')
    expect(ticket).not.toBeNull()
    expect(fakeLedger.getAvailable).toHaveBeenCalledWith('u1')

    await ticket!.settle('fal:REQ1')
    expect(fakeLedger.debit).toHaveBeenCalledWith('u1', LORA_RENDER_CREDITS, 'provider:finnyjules/jules-jene', 'fal:REQ1')
  })

  it('(e) hosted, priced slug with insufficient available: throws 402 with {required, available}', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    const priced = 'black-forest-labs/flux-dev'
    const required = MODEL_COSTS[priced].credits
    fakeLedger.getAvailable.mockResolvedValue(required - 1)

    await expect(preflightMeter(priced)).rejects.toMatchObject({
      statusCode: 402,
      data: { required, available: required - 1 },
    })
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('(f) hint overrides an unpriced slug so preflight succeeds', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    setMeterPriceHint(15)
    fakeLedger.getAvailable.mockResolvedValue(100)

    const ticket = await preflightMeter('black-forest-labs/not-in-book')
    expect(ticket).not.toBeNull()

    await ticket!.settle('job-hinted')
    expect(fakeLedger.debit).toHaveBeenCalledWith('u1', 15, 'provider:black-forest-labs/not-in-book', 'job-hinted')
  })

  it('(g) settle logs loudly and does not rethrow when the ledger debit throws', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(100)
    fakeLedger.debit.mockRejectedValue(new Error('ledger exploded'))

    const ticket = await preflightMeter('finnyjules/jules-jene')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(ticket!.settle('job-boom')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[meter] DEBIT FAILED after successful job'),
        expect.anything(),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('(g2) settle also logs loudly (does not throw) when the ledger resolves ok:false', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(100)
    fakeLedger.debit.mockResolvedValue({ ok: false })

    const ticket = await preflightMeter('finnyjules/jules-jene')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(ticket!.settle('job-insufficient')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[meter] DEBIT FAILED after successful job'),
        expect.anything(),
      )
    } finally {
      spy.mockRestore()
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
