/**
 * Request meter core (accounts spec Stage 4, Task 1): per-request billing
 * context + fail-closed price resolution. This is the chokepoint every
 * paid-provider route funnels through before dispatch (preflight) and after
 * a job completes (settle) — later tasks wire auth middleware and routes to
 * these exact names.
 *
 * Context is carried via AsyncLocalStorage rather than threaded through
 * every call signature, because provider dispatch runs many layers below
 * the route handler (agent tools, node executors, etc.) and none of those
 * layers should need a userId parameter added just to make metering work.
 *
 * CRITICAL ALS propagation gotcha (found live during Task 3, verified
 * against real h3 dispatch — see requestMeter.unit.spec.ts's h3-shaped
 * regression test and tests/unit/meter-context-h3.integration.spec.ts):
 * AsyncLocalStorage#enterWith mutates the store for "whatever is currently
 * the active async context frame". A sibling h3 middleware/route handler
 * invoked via a SEPARATE `await` from Nitro's dispatcher subscribes its own
 * continuation once the handler's synchronous prefix suspends — i.e. the
 * dispatcher's continuation is created AFTER that synchronous prefix
 * (which includes the internal `await resolveHostedUserId(event)`'s own
 * suspension), not before it. If bindMeterContext called a *fresh*
 * enterWith AFTER that internal await (the naive approach), the enterWith
 * would run on a continuation descended from the internal await — a frame
 * the dispatcher's own (already-created) continuation is not an ancestor
 * of — so the new store would never reach the next middleware/route
 * handler: verified with a minimal real-h3 repro where a downstream
 * handler saw `null` despite enterWith having already run. enterWith
 * called BEFORE a callee's first internal await, by contrast, DOES
 * propagate correctly to the awaiting caller and everything scheduled
 * after it — because invoking a function runs its synchronous prefix
 * (including any enterWith there) before the caller's `await` even
 * subscribes.
 *
 * The fix: never re-enter after the first await. Store a single mutable
 * BOX (`{ current: MeterContext | null }`) via enterWith, always as the
 * very first synchronous operation of a request (clearMeterContext, called
 * first in auth.ts, before any internal await). Every later update
 * (bindMeterContext, setMeterPriceHint) MUTATES that same box's `.current`
 * in place instead of calling enterWith again — so the box reference
 * already correctly propagated to every downstream continuation simply
 * reflects the new value when read, no re-entry required.
 *
 * clearMeterContext ALWAYS creates a brand-new box (never mutates an
 * inherited one) — this is also what makes clear-then-bind safe against
 * cross-request bleed: enterWith is not call-scoped, so a later request on
 * the same async chain could otherwise inherit a PREVIOUS request's box
 * object; starting every request with a fresh box severs that link before
 * anything of this request's own gets attached to it.
 *
 * Nothing here can auto-clear the context at request end; Nitro's
 * per-request entry point (auth.ts calling clearMeterContext first) is
 * what provides that isolation. Test code must reset explicitly (see
 * __resetMeterContextForTests).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { deployMode } from './deployMode'
import { costForModel, LORA_RENDER_CREDITS, LORA_SLUG_OWNERS, MODEL_COSTS } from './priceBook'
import { getLiveLedger } from './ledgerLive'

export interface MeterContext { userId: string; priceHintCredits?: number }

interface MeterContextBox { current: MeterContext | null }

const als = new AsyncLocalStorage<MeterContextBox>()

/**
 * auth middleware calls this once per request (after resolving the user).
 * Mutates the box already bound by clearMeterContext in place — see the
 * module doc's ALS propagation gotcha for why this must NOT call
 * enterWith itself in the common (already-cleared) case. Falls back to
 * enterWith only when no box exists yet (standalone/test callers that
 * invoke this without a prior clearMeterContext in the same call).
 */
export function bindMeterContext(ctx: MeterContext): void {
  const box = als.getStore()
  if (box) {
    box.current = ctx
  } else {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[meter] bindMeterContext without a cleared box — context may not propagate; call clearMeterContext() first')
    }
    als.enterWith({ current: ctx })
  }
}

/**
 * Clears any bound context by entering a FRESH box (never mutates an
 * inherited one — see the module doc). Review escalation 2026-08-14: auth
 * middleware must call this on EVERY hosted request, before any
 * short-circuit, so no request can ever inherit a predecessor's identity —
 * only requests that pass the guard and resolve a user get a freshly bound
 * context afterward (via bindMeterContext mutating THIS box).
 */
export function clearMeterContext(): void {
  als.enterWith({ current: null })
}

/** Chokepoints (preflightMeter, routes) read the currently bound context. */
export function currentMeterContext(): MeterContext | null {
  return als.getStore()?.current ?? null
}

/**
 * Routes that know their own price (e.g. a route-level flat fee) call this
 * AFTER bindMeterContext has already run for the request, to attach a hint
 * resolveCredits can fall back to when the model itself is unpriced.
 */
export function setMeterPriceHint(credits: number): void {
  const box = als.getStore()
  if (!box?.current) return
  box.current.priceHintCredits = credits
}

/** Test-only seam: clears the bound context so tests don't bleed into each
 * other via enterWith's non-call-scoped persistence. Thin alias over the
 * production clearMeterContext — kept as a separate export so test call
 * sites read as test-only regardless of what production code does. */
export function __resetMeterContextForTests(): void {
  clearMeterContext()
}

export class MeterRefusalError extends Error {
  statusCode: number
  data?: unknown
  constructor(message: string, statusCode: number, data?: unknown) {
    super(message)
    this.name = 'MeterRefusalError'
    this.statusCode = statusCode
    this.data = data
  }
}

/**
 * MODEL_COSTS[model].credits, else hint, else LoRA category for personal
 * slugs (a slug whose owner segment is not a known public provider org),
 * else null. KNOWN_PUBLIC_ORGS is derived from Object.keys(MODEL_COSTS) at
 * call time — never hardcode a second list that can drift from the price
 * book.
 */
export function resolveCredits(model: string, hint?: number): number | null {
  const priced = costForModel(model)
  if (priced) return priced.credits

  if (typeof hint === 'number') return hint

  const owner = model.split('/')[0]
  const hasOwnerSegment = owner.length > 0 && owner !== model
  if (hasOwnerSegment && LORA_SLUG_OWNERS.includes(owner)) return LORA_RENDER_CREDITS
  // Unknown owner that is neither a booked public org nor an allowlisted
  // personal-LoRA org: REFUSE (null). A typo'd public slug must fail loudly
  // upstream rather than silently underprice as an 8cr LoRA render.
  return null
}

export interface MeterTicket { settle(jobId: string): Promise<void> }

type LedgerLike = {
  getAvailable(userId: string): Promise<number>
  debit(userId: string, amount: number, reason: string, idempotencyKey: string): Promise<{ ok: boolean }>
}

// Test-only injection point (mirrors __setClerkClientForTests in auth.ts /
// __setStripeForTests in stripeClient.ts) — tests never need DATABASE_URL.
let ledgerOverride: LedgerLike | null = null
export function __setLedgerForTests(ledger: LedgerLike | null): void {
  ledgerOverride = ledger
}
function getLedger(): LedgerLike {
  return ledgerOverride ?? getLiveLedger()
}

/**
 * Shared core for both preflightMeter (ALS-bound userId) and preflightMeterFor
 * (explicit userId, for callers with no request/ALS context). Local mode →
 * null (no-op ticket, no ledger touched at all). Hosted mode fails closed at
 * every step: no price or insufficient balance both refuse rather than
 * letting spend through unpriced or unmetered.
 */
async function preflightForUser(userId: string, model: string, priceHintCredits?: number): Promise<MeterTicket | null> {
  if (deployMode() === 'local') return null

  const credits = resolveCredits(model, priceHintCredits)
  if (credits === null) throw new MeterRefusalError(`unpriced model refused: ${model}`, 500)

  const ledger = getLedger()
  const available = await ledger.getAvailable(userId)
  if (available < credits) {
    throw new MeterRefusalError('insufficient credits', 402, { required: credits, available })
  }

  return {
    async settle(jobId: string): Promise<void> {
      try {
        const result = await ledger.debit(userId, credits, `provider:${model}`, jobId)
        if (!result.ok) {
          console.error('[meter] DEBIT FAILED after successful job', { userId, model, credits, jobId, result })
        }
      } catch (e) {
        console.error('[meter] DEBIT FAILED after successful job', { userId, model, credits, jobId, error: e })
      }
    },
  }
}

/**
 * Local mode → null (no-op ticket, no ledger touched at all). Hosted mode
 * fails closed at every step: no bound context, no price, or insufficient
 * balance all refuse the request rather than letting spend through unpriced
 * or unmetered.
 */
export async function preflightMeter(model: string): Promise<MeterTicket | null> {
  if (deployMode() === 'local') return null

  const ctx = currentMeterContext()
  if (!ctx) throw new MeterRefusalError('unmetered spend refused', 500)

  return preflightForUser(ctx.userId, model, ctx.priceHintCredits)
}

/**
 * Context-free variant of preflightMeter for callers with no request in
 * flight — e.g. server/plugins/trainingQueueRunner.ts's timer-driven runner,
 * which starts training jobs on a tick with no AsyncLocalStorage context to
 * read a userId from (see this module's doc on ALS propagation). The caller
 * supplies userId explicitly (threaded through from wherever the job was
 * enqueued — see trainingQueue.ts's TrainingJob.userId). Same checks as
 * preflightMeter minus the ALS lookup; ticket shape and settle semantics are
 * identical. Never call this without a real userId — there is no "unbound
 * context" refusal here to catch that mistake for you, unlike preflightMeter.
 */
export async function preflightMeterFor(userId: string, model: string): Promise<MeterTicket | null> {
  return preflightForUser(userId, model)
}

/**
 * Settle a known-priced model for the CURRENT context user without a fresh
 * preflight — for async jobs whose success is confirmed on a later request
 * (e.g. voice-clone status polling). The idempotency key makes repeated
 * status polls after success a no-op. A refused debit (balance drained
 * between start and completion) delivers the job UNCHARGED and logs loudly —
 * never blocks the user's result. Local mode: no-op.
 */
export async function settleModel(model: string, jobId: string): Promise<void> {
  if (deployMode() === 'local') return

  const ctx = currentMeterContext()
  if (!ctx) {
    console.error('[meter] settleModel without context', { model, jobId })
    return
  }

  const credits = resolveCredits(model, ctx.priceHintCredits)
  if (credits === null) {
    console.error('[meter] settleModel: unpriced model', { model, jobId, userId: ctx.userId })
    return
  }

  const userId = ctx.userId
  const ledger = getLedger()
  try {
    const result = await ledger.debit(userId, credits, `provider:${model}`, jobId)
    if (!result.ok) {
      console.error('[meter] DEBIT FAILED after successful job', { userId, model, credits, jobId, result })
    }
  } catch (e) {
    console.error('[meter] DEBIT FAILED after successful job', { userId, model, credits, jobId, error: e })
  }
}
