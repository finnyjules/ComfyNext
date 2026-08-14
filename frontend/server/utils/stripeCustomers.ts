/**
 * userId ↔ Stripe customer mapping (accounts spec §5.3 / stripe_customers
 * table). Get-or-create; the unique constraint makes concurrent creation
 * safe (second insert loses, we re-read).
 */
import type { LedgerDb } from './ledger'

interface StripeCustomersApi {
  customers: { create(params: { email?: string; metadata: { userId: string } }): Promise<{ id: string }> }
}

export async function ensureStripeCustomer(
  db: LedgerDb,
  stripe: StripeCustomersApi,
  userId: string,
  email?: string | null,
): Promise<string> {
  const existing = await db.query(
    `SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [userId])
  if (existing.rows.length) return existing.rows[0].stripe_customer_id
  const customer = await stripe.customers.create({ email: email ?? undefined, metadata: { userId } })
  try {
    await db.query(
      `INSERT INTO stripe_customers (user_id, stripe_customer_id) VALUES ($1, $2)`,
      [userId, customer.id])
  } catch (e: any) {
    if (e?.code === '23505') {
      const again = await db.query(
        `SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [userId])
      if (again.rows.length) return again.rows[0].stripe_customer_id
    }
    throw e
  }
  return customer.id
}
