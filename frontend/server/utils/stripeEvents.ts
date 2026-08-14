/**
 * Stripe webhook event handling (accounts spec §5.3), separated from the
 * route so it unit-tests without signatures. Grants are keyed by the Stripe
 * EVENT id — the ledger's idempotency replay makes redelivered webhooks
 * no-ops, and the 23505 catch covers concurrent duplicate delivery.
 *
 * Refund clawback is best-effort and per-refund: `charge.amount_refunded` is
 * CUMULATIVE across every refund on the charge, and each partial refund
 * fires its own event, so keying by the event id would over-claw on a
 * charge's second partial refund. Instead we iterate the itemized
 * `charge.refunds.data` array and debit EACH REFUND keyed by its own Stripe
 * refund id — the ledger's idempotency replay then makes a refund already
 * processed by an earlier event a no-op, and a newly-seen refund claws
 * exactly its own amount. When `refunds.data` is absent (older API version
 * / unexpanded event), we fall back to the old cumulative-amount-keyed-by-
 * event-id behavior, which is exact for a charge's first/only refund but
 * over-claws on later partial refunds of the same charge.
 *
 * Every debit's result is checked: debit up to the available balance, and
 * if the debit is refused (e.g. the wallet drained between the availability
 * check and the ledger's own locked check) or is capped short of what's
 * owed, log loudly and count it as a shortfall — recovering the remainder
 * is a manual/abuse-policy concern, never silently swallowed.
 */
export interface StripeEventDeps {
  credit(userId: string, credits: number, reason: string, key: string): Promise<{ ok: boolean }>
  debit(userId: string, credits: number, reason: string, key: string): Promise<{ ok: boolean; reason?: string }>
  getAvailable(userId: string): Promise<number>
  lookupUserByCustomer(customerId: string): Promise<string | null>
}

import { packById } from './packs'

export async function handleStripeEvent(
  evt: { id: string; type: string; data: { object: any } },
  deps: StripeEventDeps,
): Promise<{ handled: boolean; action?: string }> {
  if (evt.type === 'checkout.session.completed') {
    const s = evt.data.object
    if (s?.payment_status !== 'paid') return { handled: false }
    const userId = s?.metadata?.userId
    const pack = packById(String(s?.metadata?.packId ?? ''))
    const credits = Number(s?.metadata?.credits)
    if (!userId || !pack) throw new Error('stripe webhook: completed session missing userId/packId metadata')
    if (credits !== pack.credits) throw new Error(`stripe webhook: pack mismatch — metadata says ${credits}, table says ${pack.credits}`)
    await deps.credit(userId, pack.credits, `pack_purchase:${pack.id}`, evt.id)
    return { handled: true, action: 'granted' }
  }

  if (evt.type === 'charge.refunded') {
    const c = evt.data.object
    const customerId = c?.customer
    if (!customerId) return { handled: false }
    const userId = await deps.lookupUserByCustomer(String(customerId))
    if (!userId) return { handled: false }

    const itemized: Array<{ id: string; amount: number }> = Array.isArray(c?.refunds?.data) ? c.refunds.data : []
    // Fallback synthesizes a single "refund" keyed by the event id — see
    // the module doc comment above for why this over-claws on a charge's
    // later partial refunds and is only exact for the first/only one.
    const refunds = itemized.length > 0
      ? itemized
      : [{ id: evt.id, amount: Math.floor(Number(c?.amount_refunded ?? 0)) }] // cents = base credits (1cr = 1¢)

    let attempted = false
    let anyShortfall = false
    for (const refund of refunds) {
      const wanted = Math.floor(Number(refund?.amount ?? 0))
      if (wanted <= 0) continue
      attempted = true
      const available = await deps.getAvailable(userId)
      const take = Math.min(wanted, available)
      let recovered = 0
      if (take > 0) {
        const result = await deps.debit(userId, take, 'refund_clawback', String(refund.id))
        if (result.ok) {
          recovered = take
        } else {
          console.error('[stripe] CLAWBACK DEBIT REFUSED', { userId, refundId: refund.id, wanted, eventId: evt.id })
        }
      }
      if (recovered < wanted) {
        anyShortfall = true
        console.error('[stripe] REFUND CLAWBACK SHORTFALL', { userId, refundId: refund.id, wanted, recovered, eventId: evt.id })
      }
    }

    if (!attempted) return { handled: false }
    return { handled: true, action: anyShortfall ? 'clawback_partial' : 'clawback' }
  }

  return { handled: false }
}
