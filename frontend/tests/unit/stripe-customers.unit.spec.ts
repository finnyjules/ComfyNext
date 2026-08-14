import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ensureStripeCustomer } from '../../server/utils/stripeCustomers'
import { createLedger } from '../../server/utils/ledger'

async function openTestDb() {
  const db = new PGlite()
  const schema = readFileSync(join(__dirname, '../../server/db/schema.sql'), 'utf8')
  await db.exec(schema)
  await db.query(`INSERT INTO users (id) VALUES ('user_1')`)
  return { query: (sql: string, params?: unknown[]) => db.query(sql, params as any[]) }
}

describe('ensureStripeCustomer', () => {
  it('creates once, then reuses the stored mapping', async () => {
    const db = await openTestDb()
    const stripe = { customers: { create: vi.fn().mockResolvedValue({ id: 'cus_123' }) } }
    const ledger = createLedger(db)
    expect(await ensureStripeCustomer(ledger, db, stripe, 'user_1', 'a@b.co')).toBe('cus_123')
    expect(await ensureStripeCustomer(ledger, db, stripe, 'user_1', 'a@b.co')).toBe('cus_123')
    expect(stripe.customers.create).toHaveBeenCalledTimes(1)
    expect(stripe.customers.create).toHaveBeenCalledWith({ email: 'a@b.co', metadata: { userId: 'user_1' } })
  })
})

describe('ensureStripeCustomer under the ledger mutex', () => {
  it('the mapping write serializes with an in-flight ledger transaction', async () => {
    const db = await openTestDb()
    const ledger = createLedger(db)
    const stripe = { customers: { create: vi.fn().mockResolvedValue({ id: 'cus_lock' }) } }
    // Hold the mutex with a real ledger op and start the mapping concurrently:
    // the write must land AFTER the credit's COMMIT, never inside it.
    await ledger.ensureUser('user_1')
    const order: string[] = []
    const credit = ledger.credit('user_1', 100, 'seed', 'k-lock').then(() => order.push('credit-done'))
    const ensure = ensureStripeCustomer(ledger, db, stripe, 'user_1').then(() => order.push('mapping-done'))
    await Promise.all([credit, ensure])
    expect(order[0]).toBe('credit-done')
    expect(await ledger.getBalance('user_1')).toBe(100)
  })

  it('concurrent duplicate creation converges via ON CONFLICT DO NOTHING', async () => {
    const db = await openTestDb()
    const ledger = createLedger(db)
    // Simulate losing the insert race: mapping appears between the SELECT
    // and the INSERT — DO NOTHING + re-read must return the winner.
    const stripe = {
      customers: {
        create: vi.fn().mockImplementation(async () => {
          await db.query(
            `INSERT INTO stripe_customers (user_id, stripe_customer_id) VALUES ('user_1', 'cus_winner')`)
          return { id: 'cus_loser' }
        }),
      },
    }
    expect(await ensureStripeCustomer(ledger, db, stripe, 'user_1')).toBe('cus_winner')
  })
})
