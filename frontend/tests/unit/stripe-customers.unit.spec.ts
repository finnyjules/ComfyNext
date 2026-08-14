import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ensureStripeCustomer } from '../../server/utils/stripeCustomers'

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
    expect(await ensureStripeCustomer(db, stripe, 'user_1', 'a@b.co')).toBe('cus_123')
    expect(await ensureStripeCustomer(db, stripe, 'user_1', 'a@b.co')).toBe('cus_123')
    expect(stripe.customers.create).toHaveBeenCalledTimes(1)
    expect(stripe.customers.create).toHaveBeenCalledWith({ email: 'a@b.co', metadata: { userId: 'user_1' } })
  })
})
