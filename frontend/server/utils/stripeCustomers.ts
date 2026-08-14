/**
 * userId ↔ Stripe customer mapping (accounts spec §5.3 / stripe_customers
 * table). Get-or-create.
 *
 * Concurrency contract (final-review finding): the mapping WRITE runs under
 * the ledger's transaction mutex via ledger.withLock — a raw write on the
 * shared session outside the mutex can interleave into an open money
 * transaction (vanishing on its rollback, or aborting it on a constraint
 * error). Reads and the Stripe network call stay OUTSIDE the lock so the
 * money mutex is never held across network I/O. ON CONFLICT DO NOTHING +
 * re-read makes concurrent creation converge on one winner.
 */
import type { LedgerDb } from './ledger'
import type { createLedger } from './ledger'

interface StripeCustomersApi {
  customers: { create(params: { email?: string; metadata: { userId: string } }): Promise<{ id: string }> }
}

export async function ensureStripeCustomer(
  ledger: Pick<ReturnType<typeof createLedger>, 'withLock'>,
  db: LedgerDb,
  stripe: StripeCustomersApi,
  userId: string,
  email?: string | null,
): Promise<string> {
  const existing = await db.query(
    `SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [userId])
  if (existing.rows.length) return existing.rows[0].stripe_customer_id

  const customer = await stripe.customers.create({ email: email ?? undefined, metadata: { userId } })

  return await ledger.withLock(async () => {
    await db.query(
      `INSERT INTO stripe_customers (user_id, stripe_customer_id) VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, customer.id])
    const rows = await db.query(
      `SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [userId])
    return rows.rows[0].stripe_customer_id
  })
}
