/**
 * Production LedgerDb: one dedicated pg connection over TCP, per the contract
 * in ledger.ts — the handle must be a single session (never a shared pool),
 * because ledger methods issue BEGIN/COMMIT on it directly.
 *
 * Reconnect policy: Neon suspends idle computes and drops TCP on the way
 * down, so a long-lived Client WILL die between requests. Each query lazily
 * (re)connects when the previous client has errored or ended. This is safe
 * with the ledger's transaction mutex: a connection lost MID-transaction
 * fails that ledger call (its ROLLBACK also fails, surfacing the error to
 * the caller), and the NEXT call gets a fresh session with no open
 * transaction — Postgres discarded the broken one at disconnect.
 */
import { Client } from 'pg'
import type { LedgerDb } from './ledger'

export interface LedgerDbHandle extends LedgerDb {
  end(): Promise<void>
}

export function connectLedgerDb(connectionString: string): LedgerDbHandle {
  let client: Client | null = null
  let dead = false
  // Serializes connect attempts so concurrent first queries share one client.
  let connecting: Promise<Client> | null = null

  function getClient(): Promise<Client> {
    if (client && !dead) return Promise.resolve(client)
    if (!connecting) {
      const next = new Client({ connectionString })
      connecting = next.connect().then(() => {
        next.on('error', () => { dead = true })
        next.on('end', () => { dead = true })
        client = next
        dead = false
        connecting = null
        return next
      }, (e) => {
        connecting = null
        throw e
      })
    }
    return connecting
  }

  return {
    async query(sql: string, params?: unknown[]) {
      const c = await getClient()
      const res = await c.query(sql, params as any[])
      return { rows: res.rows }
    },
    async end() {
      const c = client
      client = null
      dead = true
      if (c) await c.end().catch(() => {})
    },
  }
}

/**
 * Hosted-mode singleton: one shared ledger DB session for the whole server
 * process (all callers already funnel through one createLedger instance's
 * mutex). Lazy — reads DATABASE_URL at first use, never at import time.
 */
let shared: LedgerDbHandle | null = null

export function getSharedLedgerDb(): LedgerDbHandle {
  if (!shared) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('ledgerDb: DATABASE_URL is not set (hosted mode requires it)')
    shared = connectLedgerDb(url)
  }
  return shared
}
