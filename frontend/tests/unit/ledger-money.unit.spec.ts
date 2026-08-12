import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'

const schema = readFileSync(
  fileURLToPath(new URL('../../server/db/schema.sql', import.meta.url)), 'utf8')

async function openTestDb() {
  const db = new PGlite()
  await db.exec(schema)
  return db
}

async function ledgerWithUser(userId = 'u1') {
  const ledger = createLedger(await openTestDb())
  await ledger.ensureUser(userId)
  return ledger
}

describe('ledger: credit + debit', () => {
  it('credit then debit moves the balance', async () => {
    const l = await ledgerWithUser()
    const c = await l.credit('u1', 500, 'signup_bonus', 'bonus:u1')
    expect(c).toEqual({ ok: true, balance: 500 })
    const d = await l.debit('u1', 120, 'generation', 'prompt:abc')
    expect(d).toEqual({ ok: true, balance: 380 })
    expect(await l.getBalance('u1')).toBe(380)
  })

  it('debit beyond available is rejected and changes nothing', async () => {
    const l = await ledgerWithUser()
    await l.credit('u1', 100, 'topup', 'k1')
    const d = await l.debit('u1', 101, 'generation', 'k2')
    expect(d).toEqual({ ok: false, reason: 'insufficient' })
    expect(await l.getBalance('u1')).toBe(100)
  })

  it('replayed idempotency key returns the original result without double-applying', async () => {
    const l = await ledgerWithUser()
    await l.credit('u1', 100, 'topup', 'stripe_evt_1')
    const replay = await l.credit('u1', 100, 'topup', 'stripe_evt_1')
    expect(replay).toEqual({ ok: true, balance: 100 }) // balance-after of the ORIGINAL
    expect(await l.getBalance('u1')).toBe(100)         // not 200

    await l.debit('u1', 40, 'generation', 'prompt:x')
    const replayDebit = await l.debit('u1', 40, 'generation', 'prompt:x')
    expect(replayDebit).toEqual({ ok: true, balance: 60 })
    expect(await l.getBalance('u1')).toBe(60)
  })

  it('every movement lands in ledger_entries with balance_after', async () => {
    const db = await openTestDb()
    const l = createLedger(db)
    await l.ensureUser('u1')
    await l.credit('u1', 100, 'topup', 'k1')
    await l.debit('u1', 30, 'generation', 'k2')
    const { rows } = await db.query(
      `SELECT kind, amount, balance_after FROM ledger_entries WHERE user_id = 'u1' ORDER BY id`)
    expect(rows).toEqual([
      { kind: 'credit', amount: 100, balance_after: 100 },
      { kind: 'debit', amount: 30, balance_after: 70 },
    ])
  })

  it('rejects non-positive and non-integer amounts', async () => {
    const l = await ledgerWithUser()
    await expect(l.credit('u1', 0, 'x', 'k')).rejects.toThrow()
    await expect(l.credit('u1', -5, 'x', 'k')).rejects.toThrow()
    await expect(l.credit('u1', 1.5, 'x', 'k')).rejects.toThrow()
  })
})
