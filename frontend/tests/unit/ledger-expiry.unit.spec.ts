import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'

const schema = readFileSync(
  fileURLToPath(new URL('../../server/db/schema.sql', import.meta.url)), 'utf8')

async function freshLedger() {
  const db = new PGlite()
  await db.exec(schema)
  const ledger = createLedger(db)
  await ledger.ensureUser('u1')
  return { db, ledger }
}

describe('ledger: expiry', () => {
  it('debits consume soonest-expiring credits first', async () => {
    const { db, ledger } = await freshLedger()
    await ledger.credit('u1', 100, 'pack', 'k-pack')                                   // never expires
    await ledger.credit('u1', 100, 'subscription_grant', 'k-sub', { expiresAt: '2026-09-01' })
    await ledger.debit('u1', 80, 'generation', 'k-gen')
    const { rows } = await db.query(
      `SELECT reason, remaining_credits FROM ledger_entries
       WHERE kind = 'credit' AND user_id = 'u1' ORDER BY id`)
    expect(rows).toEqual([
      { reason: 'pack', remaining_credits: 100 },              // untouched
      { reason: 'subscription_grant', remaining_credits: 20 }, // consumed first
    ])
  })

  it('sweep expires leftover subscription credits, balance drops, pack survives', async () => {
    const { ledger } = await freshLedger()
    await ledger.credit('u1', 100, 'pack', 'k-pack')
    await ledger.credit('u1', 100, 'subscription_grant', 'k-sub', { expiresAt: '2026-09-01' })
    await ledger.debit('u1', 80, 'generation', 'k-gen') // 20 left on the grant
    const swept = await ledger.expireCredits('2026-09-02')
    expect(swept).toEqual({ expiredCredits: 20 })
    expect(await ledger.getBalance('u1')).toBe(100) // 200 - 80 - 20
  })

  it('sweep before the expiry date expires nothing', async () => {
    const { ledger } = await freshLedger()
    await ledger.credit('u1', 100, 'subscription_grant', 'k-sub', { expiresAt: '2026-09-01' })
    expect(await ledger.expireCredits('2026-08-31')).toEqual({ expiredCredits: 0 })
    expect(await ledger.getBalance('u1')).toBe(100)
  })

  it('sweep is idempotent — second run expires nothing more', async () => {
    const { ledger } = await freshLedger()
    await ledger.credit('u1', 100, 'subscription_grant', 'k-sub', { expiresAt: '2026-09-01' })
    await ledger.expireCredits('2026-09-02')
    expect(await ledger.expireCredits('2026-09-02')).toEqual({ expiredCredits: 0 })
    expect(await ledger.getBalance('u1')).toBe(0)
  })
})
