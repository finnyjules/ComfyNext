import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'

const schema = readFileSync(
  fileURLToPath(new URL('../../server/db/schema.sql', import.meta.url)), 'utf8')

// Fresh in-memory Postgres per test — no server, no cleanup.
export async function openTestDb() {
  const db = new PGlite()
  await db.exec(schema)
  return db
}

describe('ledger: user + wallet bootstrap', () => {
  it('ensureUser creates user and zero wallet, idempotently', async () => {
    const ledger = createLedger(await openTestDb())
    await ledger.ensureUser('user_a')
    await ledger.ensureUser('user_a') // second call must not throw
    expect(await ledger.getBalance('user_a')).toBe(0)
    expect(await ledger.getAvailable('user_a')).toBe(0)
  })

  it('getBalance of an unknown user is 0, not an error', async () => {
    const ledger = createLedger(await openTestDb())
    expect(await ledger.getBalance('nobody')).toBe(0)
  })
})
