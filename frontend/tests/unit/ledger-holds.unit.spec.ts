import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'

const schema = readFileSync(
  fileURLToPath(new URL('../../server/db/schema.sql', import.meta.url)), 'utf8')

async function ledgerWithUser(credits: number) {
  const db = new PGlite()
  await db.exec(schema)
  const ledger = createLedger(db)
  await ledger.ensureUser('u1')
  if (credits) await ledger.credit('u1', credits, 'topup', 'seed')
  return ledger
}

async function dbAndLedgerWithUser(credits: number) {
  const db = new PGlite()
  await db.exec(schema)
  const ledger = createLedger(db)
  await ledger.ensureUser('u1')
  if (credits) await ledger.credit('u1', credits, 'topup', 'seed')
  return { db, ledger }
}

describe('ledger: holds', () => {
  it('hold reserves; available drops, balance does not', async () => {
    const l = await ledgerWithUser(1000)
    const h = await l.hold('u1', 600, 'train:job1')
    expect(h.ok).toBe(true)
    expect(await l.getBalance('u1')).toBe(1000)
    expect(await l.getAvailable('u1')).toBe(400)
  })

  it('holds beyond available are rejected (concurrent holds cannot overspend)', async () => {
    const l = await ledgerWithUser(1000)
    await l.hold('u1', 600, 'job1')
    const second = await l.hold('u1', 600, 'job2')
    expect(second).toEqual({ ok: false, reason: 'insufficient' })
  })

  it('settle debits the actual amount and frees the reservation', async () => {
    const l = await ledgerWithUser(1000)
    const h = await l.hold('u1', 600, 'job1')
    if (!h.ok) throw new Error('hold failed')
    const s = await l.settle(h.holdId, 450, 'training')
    expect(s).toEqual({ ok: true, balance: 550, settled: true })
    expect(await l.getAvailable('u1')).toBe(550) // reservation gone
  })

  it('settle above the estimate still debits (operator absorbs overrun)', async () => {
    const l = await ledgerWithUser(600)
    const h = await l.hold('u1', 600, 'job1')
    if (!h.ok) throw new Error('hold failed')
    const s = await l.settle(h.holdId, 700, 'training')
    expect(s).toEqual({ ok: true, balance: -100, settled: true })
  })

  it('release frees the reservation with no debit; double release is a no-op', async () => {
    const l = await ledgerWithUser(1000)
    const h = await l.hold('u1', 600, 'job1')
    if (!h.ok) throw new Error('hold failed')
    await l.release(h.holdId)
    await l.release(h.holdId)
    expect(await l.getBalance('u1')).toBe(1000)
    expect(await l.getAvailable('u1')).toBe(1000)
  })

  it('replayed hold key returns the same hold, reserving once', async () => {
    const l = await ledgerWithUser(1000)
    const h1 = await l.hold('u1', 600, 'job1')
    const h2 = await l.hold('u1', 600, 'job1')
    expect(h1).toEqual(h2)
    expect(await l.getAvailable('u1')).toBe(400)
  })

  it('settle after settle replays the original result', async () => {
    const l = await ledgerWithUser(1000)
    const h = await l.hold('u1', 600, 'job1')
    if (!h.ok) throw new Error('hold failed')
    const s1 = await l.settle(h.holdId, 450, 'training')
    const s2 = await l.settle(h.holdId, 450, 'training')
    expect(s1).toEqual(s2)
    expect(s1).toEqual({ ok: true, balance: 550, settled: true })
    expect(s2).toEqual({ ok: true, balance: 550, settled: true })
    expect(await l.getBalance('u1')).toBe(550)
  })

  it('settle after release is distinguishable from a real settle: settled:false, no charge', async () => {
    const { db, ledger: l } = await dbAndLedgerWithUser(1000)
    const h = await l.hold('u1', 600, 'job1')
    if (!h.ok) throw new Error('hold failed')
    await l.release(h.holdId)
    const s = await l.settle(h.holdId, 450, 'training')
    expect(s).toEqual({ ok: true, balance: 1000, settled: false })
    expect(await l.getBalance('u1')).toBe(1000)
    expect(await l.getAvailable('u1')).toBe(1000)
    const { rows } = await db.query(
      `SELECT id FROM ledger_entries WHERE user_id = 'u1' AND idempotency_key LIKE 'settle:%'`)
    expect(rows).toEqual([])
  })
})
