/**
 * Live-Neon ledger tests — the cross-SESSION cases PGlite cannot express
 * (PGlite is a single connection; these races need two real sessions).
 *
 * Gated: runs only when NEON_TEST_DATABASE_URL is set. Invoke as
 *   NEON_TEST_DATABASE_URL=$(grep '^DATABASE_URL=' .env.hosted | cut -d= -f2-) \
 *     npx vitest run tests/unit/ledger-neon-live.unit.spec.ts
 *
 * Uses throwaway per-run user ids (never truncates — the same database will
 * hold real money later; a test that deletes rows is a loaded gun).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createLedger } from '../../server/utils/ledger'
import { connectLedgerDb, type LedgerDbHandle } from '../../server/utils/ledgerDb'

const url = process.env.NEON_TEST_DATABASE_URL
const runId = `neontest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const opened: LedgerDbHandle[] = []

function open(): LedgerDbHandle {
  const db = connectLedgerDb(url!)
  opened.push(db)
  return db
}

afterAll(async () => {
  for (const db of opened) await db.end()
})

describe.skipIf(!url)('ledger against live Neon', () => {
  it('round-trips ensure/credit/debit/hold/settle on a real session', async () => {
    const db = open()
    const ledger = createLedger(db)
    const user = `${runId}-happy`

    await ledger.ensureUser(user)
    expect(await ledger.credit(user, 1000, 'test_grant', `${runId}-c1`)).toEqual({ ok: true, balance: 1000 })
    expect(await ledger.debit(user, 300, 'test_spend', `${runId}-d1`)).toEqual({ ok: true, balance: 700 })

    const h = await ledger.hold(user, 200, `${runId}-h1`)
    if (!h.ok) throw new Error('hold refused with sufficient funds')
    expect(await ledger.getAvailable(user)).toBe(500)

    const s = await ledger.settle(h.holdId, 150, 'test_settle')
    expect(s).toEqual({ ok: true, balance: 550, settled: true })
    expect(await ledger.getAvailable(user)).toBe(550)
  })

  it('replays a credit that loses the cross-session unique race (23505 path)', async () => {
    // Session A commits the winning credit while session B is already past
    // its replay check: B's INSERT blocks on the unique index until A
    // commits, then raises 23505 — the catch must convert that into a
    // replay of A's result, not an error.
    const dbA = open()
    const dbB = open()
    const ledgerB = createLedger(dbB)
    const user = `${runId}-race-credit`
    const key = `${runId}-webhook-1`

    await createLedger(dbA).ensureUser(user)

    // Hand-drive session A so we control exactly when it commits.
    await dbA.query('BEGIN')
    await dbA.query(
      `UPDATE wallets SET balance_credits = balance_credits + 500 WHERE user_id = $1`, [user])
    await dbA.query(
      `INSERT INTO ledger_entries
         (user_id, kind, amount, reason, idempotency_key, balance_after, remaining_credits)
       VALUES ($1, 'credit', 500, 'test_grant', $2, 500, 500)`, [user, key])

    // B starts the same credit: replay check sees nothing (A uncommitted),
    // so B's INSERT blocks on A's uncommitted unique-index entry.
    const bResult = ledgerB.credit(user, 500, 'test_grant', key)
    await new Promise(r => setTimeout(r, 300)) // let B reach the blocked INSERT
    await dbA.query('COMMIT')

    expect(await bResult).toEqual({ ok: true, balance: 500 })
    const { rows } = await dbA.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1 AND idempotency_key = $2`,
      [user, key])
    expect(rows[0].n).toBe(1) // one committed row, no double-credit
  })

  it('replays a debit that loses the cross-session unique race', async () => {
    const dbA = open()
    const dbB = open()
    const ledgerB = createLedger(dbB)
    const user = `${runId}-race-debit`
    const key = `${runId}-charge-1`

    const ledgerA = createLedger(dbA)
    await ledgerA.ensureUser(user)
    await ledgerA.credit(user, 1000, 'test_grant', `${runId}-seed`)

    await dbA.query('BEGIN')
    await dbA.query(
      `UPDATE wallets SET balance_credits = balance_credits - 400 WHERE user_id = $1`, [user])
    await dbA.query(
      `INSERT INTO ledger_entries
         (user_id, kind, amount, reason, idempotency_key, balance_after)
       VALUES ($1, 'debit', 400, 'test_spend', $2, 600)`, [user, key])

    const bResult = ledgerB.debit(user, 400, 'test_spend', key)
    await new Promise(r => setTimeout(r, 300))
    await dbA.query('COMMIT')

    expect(await bResult).toEqual({ ok: true, balance: 600 })
    const { rows } = await dbA.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1 AND idempotency_key = $2`,
      [user, key])
    expect(rows[0].n).toBe(1) // charged once, not twice
  })

  it('wallets CHECK rejects negative reserved_credits at the database', async () => {
    const db = open()
    const ledger = createLedger(db)
    const user = `${runId}-check`
    await ledger.ensureUser(user)
    await expect(
      db.query(`UPDATE wallets SET reserved_credits = -1 WHERE user_id = $1`, [user]),
    ).rejects.toMatchObject({ code: '23514' }) // check_violation
  })
})
