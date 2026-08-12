import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'

const schema = readFileSync(
  fileURLToPath(new URL('../../server/db/schema.sql', import.meta.url)), 'utf8')

async function dbAndLedgerWithUser(credits: number) {
  const db = new PGlite()
  await db.exec(schema)
  const ledger = createLedger(db)
  await ledger.ensureUser('u1')
  if (credits) await ledger.credit('u1', credits, 'topup', 'seed')
  return { db, ledger }
}

describe('ledger: concurrency (internal transaction mutex)', () => {
  it('two concurrent debits on one instance/session both apply, serialized — no interleaved BEGIN/COMMIT corruption', async () => {
    const { db, ledger: l } = await dbAndLedgerWithUser(1000)
    const [r1, r2] = await Promise.all([
      l.debit('u1', 300, 'gen', 'k-a'),
      l.debit('u1', 400, 'gen', 'k-b'),
    ])
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(await l.getBalance('u1')).toBe(300)

    const { rows } = await db.query(
      `SELECT balance_after FROM ledger_entries
       WHERE user_id = 'u1' AND kind = 'debit' ORDER BY id`)
    expect(rows).toHaveLength(2)
    const afters = rows.map(r => Number(r.balance_after)).sort((a, b) => b - a)
    // Sequential execution in either order yields balance_after values of
    // {700, 300} — never a corrupted/half-applied intermediate value.
    expect(afters).toEqual([700, 300])
  })

  it('two concurrent credits with different idempotency keys both apply', async () => {
    const { ledger: l } = await dbAndLedgerWithUser(0)
    const [r1, r2] = await Promise.all([
      l.credit('u1', 150, 'topup', 'k-credit-a'),
      l.credit('u1', 250, 'topup', 'k-credit-b'),
    ])
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(await l.getBalance('u1')).toBe(400)
  })
})
