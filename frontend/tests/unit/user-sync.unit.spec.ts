import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'
import { ensureUserWithBonus, SIGNUP_BONUS_CREDITS } from '../../server/utils/userSync'

async function openTestDb() {
  const db = new PGlite()
  const schema = readFileSync(join(__dirname, '../../server/db/schema.sql'), 'utf8')
  await db.exec(schema)
  return { query: (sql: string, params?: unknown[]) => db.query(sql, params as any[]) }
}

describe('ensureUserWithBonus', () => {
  it('creates user + wallet and grants the signup bonus exactly once', async () => {
    const db = await openTestDb()
    const ledger = createLedger(db)
    await ensureUserWithBonus(ledger, db, 'user_a', 'a@example.com')
    expect(await ledger.getBalance('user_a')).toBe(SIGNUP_BONUS_CREDITS)

    // Called again (webhook + lazy fallback both fire): still exactly one bonus
    await ensureUserWithBonus(ledger, db, 'user_a', 'a@example.com')
    expect(await ledger.getBalance('user_a')).toBe(SIGNUP_BONUS_CREDITS)

    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1 AND reason = 'signup_bonus'`,
      ['user_a'])
    expect(rows[0].n).toBe(1)
  })

  it('records the email on the user row and backfills it if first sync had none', async () => {
    const db = await openTestDb()
    const ledger = createLedger(db)
    await ensureUserWithBonus(ledger, db, 'user_b', null)
    await ensureUserWithBonus(ledger, db, 'user_b', 'b@example.com')
    const { rows } = await db.query(`SELECT email FROM users WHERE id = $1`, ['user_b'])
    expect(rows[0].email).toBe('b@example.com')
  })

  it('concurrent calls do not double-grant (idempotency under the mutex)', async () => {
    const db = await openTestDb()
    const ledger = createLedger(db)
    await Promise.all([
      ensureUserWithBonus(ledger, db, 'user_c', 'c@example.com'),
      ensureUserWithBonus(ledger, db, 'user_c', 'c@example.com'),
      ensureUserWithBonus(ledger, db, 'user_c', 'c@example.com'),
    ])
    expect(await ledger.getBalance('user_c')).toBe(SIGNUP_BONUS_CREDITS)
  })
})
