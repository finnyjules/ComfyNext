/**
 * Stripe webhook event handling (accounts spec §5.3), separated from the
 * route so it unit-tests without signatures. Grants are keyed by the Stripe
 * EVENT id — the ledger's idempotency replay makes redelivered webhooks
 * no-ops, and the 23505 catch covers concurrent duplicate delivery.
 *
 * Refund clawback is best-effort: debit up to the available balance and
 * report a shortfall (the user may have spent the credits — recovering the
 * remainder is a manual/abuse-policy concern, logged loudly, never silent).
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
    const owed = Math.floor(Number(c?.amount_refunded ?? 0)) // cents = base credits (1cr = 1¢)
    if (owed <= 0) return { handled: false }
    const available = await deps.getAvailable(userId)
    const take = Math.min(owed, available)
    if (take > 0) await deps.debit(userId, take, 'refund_clawback', evt.id)
    if (take < owed) {
      console.error('[stripe] REFUND CLAWBACK SHORTFALL', { userId, owed, recovered: take, eventId: evt.id })
      return { handled: true, action: 'clawback_partial' }
    }
    return { handled: true, action: 'clawback' }
  }

  return { handled: false }
}
