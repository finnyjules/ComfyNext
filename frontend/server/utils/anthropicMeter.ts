/**
 * Flat-rate metering for the Anthropic "assist" family (accounts spec
 * Stage 4, Task 6) — vibe, explain, copy-assist, font-suggest,
 * pipeline-suggest, agent-plan, agent-review, wardrobe/describe,
 * style-profile/fable, and taste/read. These are short single-message
 * Claude calls (Haiku/Sonnet/Fable, <=2048 tokens) that don't route through
 * runReplicate/runFal or the graph pricer, so — like Task 4's bypass routes
 * — they need their own chokepoint. This mirrors requestMeter.ts's
 * preflight-then-debit shape but skips the settle-on-success ticket: see
 * meterAssist's own doc for why.
 */
import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { deployMode } from './deployMode'
import { currentMeterContext, getLedger, MeterRefusalError } from './requestMeter'

// Flat rate — covers ~$0.01 median at 2x markup; per-token metering is noise at this price
export const ANTHROPIC_ASSIST_CREDITS = 2

/**
 * Call after a route's auth/rate-limit section, before its Anthropic fetch.
 *
 * Local mode: no-op (byte-identical to pre-metering behavior — no ledger
 * touched at all).
 *
 * Hosted mode: reads the userId the auth middleware already bound to this
 * request's meter context (requestMeter.ts's currentMeterContext). A
 * missing context here means an authed route ran with no bound identity —
 * an invariant break in our own wiring, not a client mistake (a genuinely
 * unauthenticated caller is already turned away with 401 by the auth
 * middleware before this ever runs) — so this fails closed with 500 rather
 * than a 401, per requestMeter's own "unmetered spend refused" convention
 * for preflightMeter.
 *
 * Preflights available balance >= ANTHROPIC_ASSIST_CREDITS (402 with
 * {required, available} on shortfall), then debits IMMEDIATELY rather than
 * returning a settle-later ticket: these calls are cheap and sub-second,
 * and the ten call sites don't share a single success/failure shape the way
 * a provider-job ticket would. Worst case a failed Anthropic call still
 * over-charges 2cr — accepted for now; a settle-on-success variant is a
 * fair hardening rider if that proves costly in practice.
 */
export async function meterAssist(event: H3Event): Promise<void> {
  void event // signature parity with other per-request gates (assertRateLimit); no per-event data needed today

  if (deployMode() === 'local') return

  const ctx = currentMeterContext()
  if (!ctx) throw new MeterRefusalError('unmetered spend refused', 500)

  const ledger = getLedger()
  const available = await ledger.getAvailable(ctx.userId)
  if (available < ANTHROPIC_ASSIST_CREDITS) {
    throw new MeterRefusalError('insufficient credits', 402, { required: ANTHROPIC_ASSIST_CREDITS, available })
  }

  await ledger.debit(ctx.userId, ANTHROPIC_ASSIST_CREDITS, 'anthropic_assist', `assist:${randomUUID()}`)
}
