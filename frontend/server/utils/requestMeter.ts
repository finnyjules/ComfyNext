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
 * IMPORTANT ALS caveat: bindMeterContext uses enterWith, which is NOT
 * call-scoped — the store it sets persists on the current async execution
 * context for everything that runs after it (that's what makes it usable
 * from Nitro's per-request middleware chain in the first place: bind once
 * in auth middleware, read it anywhere downstream in that request). It also
 * means nothing here can auto-clear the context at request end; Nitro's
 * per-request AsyncLocalStorage entry point provides that isolation. Test
 * code must reset explicitly (see __resetMeterContextForTests).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { deployMode } from './deployMode'
import { costForModel, LORA_RENDER_CREDITS, MODEL_COSTS } from './priceBook'
import { getLiveLedger } from './ledgerLive'

export interface MeterContext { userId: string; priceHintCredits?: number }

const als = new AsyncLocalStorage<MeterContext | null>()

/** auth middleware calls this once per request (after resolving the user). */
export function bindMeterContext(ctx: MeterContext): void {
  als.enterWith(ctx)
}

/** Chokepoints (preflightMeter, routes) read the currently bound context. */
export function currentMeterContext(): MeterContext | null {
  return als.getStore() ?? null
}

/**
 * Routes that know their own price (e.g. a route-level flat fee) call this
 * AFTER bindMeterContext has already run for the request, to attach a hint
 * resolveCredits can fall back to when the model itself is unpriced.
 */
export function setMeterPriceHint(credits: number): void {
  const ctx = als.getStore()
  if (!ctx) return
  ctx.priceHintCredits = credits
}

/** Test-only seam: clears the bound context so tests don't bleed into each
 * other via enterWith's non-call-scoped persistence. */
export function __resetMeterContextForTests(): void {
  als.enterWith(null)
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
  if (hasOwnerSegment) {
    const knownPublicOrgs = new Set(Object.keys(MODEL_COSTS).map((slug) => slug.split('/')[0]))
    if (!knownPublicOrgs.has(owner)) return LORA_RENDER_CREDITS
  }

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
 * Local mode → null (no-op ticket, no ledger touched at all). Hosted mode
 * fails closed at every step: no bound context, no price, or insufficient
 * balance all refuse the request rather than letting spend through unpriced
 * or unmetered.
 */
export async function preflightMeter(model: string): Promise<MeterTicket | null> {
  if (deployMode() === 'local') return null

  const ctx = currentMeterContext()
  if (!ctx) throw new MeterRefusalError('unmetered spend refused', 500)

  const credits = resolveCredits(model, ctx.priceHintCredits)
  if (credits === null) throw new MeterRefusalError(`unpriced model refused: ${model}`, 500)

  const ledger = getLedger()
  const available = await ledger.getAvailable(ctx.userId)
  if (available < credits) {
    throw new MeterRefusalError('insufficient credits', 402, { required: credits, available })
  }

  const userId = ctx.userId
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
