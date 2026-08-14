/**
 * Stripe → Sailor credit granting (accounts spec §5.3). Signature-verified;
 * this is THE ONLY code path that turns money into credits. Public path
 * (signature is the auth), hosted-only.
 */
import { isHosted } from '~~/server/utils/deployMode'
import { getStripe } from '~~/server/utils/stripeClient'
import { getLiveLedger } from '~~/server/utils/ledgerLive'
import { getSharedLedgerDb } from '~~/server/utils/ledgerDb'
import { handleStripeEvent } from '~~/server/utils/stripeEvents'

export default defineEventHandler(async (event) => {
  if (!isHosted()) throw createError({ statusCode: 404, message: 'Not found' })
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw createError({ statusCode: 500, message: 'Webhook secret not configured' })

  const sig = getRequestHeader(event, 'stripe-signature')
  const raw = await readRawBody(event)
  if (!sig || !raw) throw createError({ statusCode: 400, message: 'Missing signature or body' })

  let evt: { id: string; type: string; data: { object: any } }
  try {
    evt = await getStripe().webhooks.constructEventAsync(raw, sig, secret) as any
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid webhook signature' })
  }

  const ledger = getLiveLedger()
  const db = getSharedLedgerDb()
  const result = await handleStripeEvent(evt, {
    credit: (u, c, reason, key) => ledger.credit(u, c, reason, key),
    debit: (u, c, reason, key) => ledger.debit(u, c, reason, key),
    getAvailable: u => ledger.getAvailable(u),
    lookupUserByCustomer: async (cusId) => {
      const { rows } = await db.query(
        `SELECT user_id FROM stripe_customers WHERE stripe_customer_id = $1`, [cusId])
      return rows.length ? rows[0].user_id : null
    },
  })
  return { ok: true, ...result }
})
