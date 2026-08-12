/**
 * The money core (accounts spec §5.2). Append-only double-entry ledger with a
 * cached wallet balance. NOTHING else writes ledger_entries or wallet columns.
 *
 * Pure module over a minimal DB handle: PGlite in unit tests, a Neon/pg client
 * in production. The handle must be a SINGLE session (not a pool) — methods
 * issue BEGIN/COMMIT on it. Replaces mockLedger.ts (same LedgerResult shape,
 * but async).
 */
export interface LedgerDb {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>
}

export type LedgerResult =
  | { ok: true, balance: number }
  | { ok: false, reason: 'insufficient' }

export function createLedger(db: LedgerDb) {
  async function ensureUser(userId: string): Promise<void> {
    await db.query(
      `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId])
    await db.query(
      `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId])
  }

  async function getBalance(userId: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT balance_credits FROM wallets WHERE user_id = $1`, [userId])
    return Number(rows[0]?.balance_credits ?? 0)
  }

  async function getAvailable(userId: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT balance_credits - reserved_credits AS available FROM wallets WHERE user_id = $1`,
      [userId])
    return Number(rows[0]?.available ?? 0)
  }

  return { ensureUser, getBalance, getAvailable }
}
