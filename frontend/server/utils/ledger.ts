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

  function assertAmount(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0)
      throw new Error(`ledger amount must be a positive integer, got ${amount}`)
  }

  /** Replay lookup: if this (user, kind, key) was already applied, return its balance-after. */
  async function replayOf(userId: string, kind: 'credit' | 'debit', key: string): Promise<number | null> {
    const { rows } = await db.query(
      `SELECT balance_after FROM ledger_entries
       WHERE user_id = $1 AND kind = $2 AND idempotency_key = $3`,
      [userId, kind, key])
    return rows.length ? rows[0].balance_after : null
  }

  async function credit(
    userId: string, amount: number, reason: string, idempotencyKey: string,
    opts: { expiresAt?: string | null, priceBookVersion?: string | null } = {},
  ): Promise<LedgerResult> {
    assertAmount(amount)
    await db.query('BEGIN')
    try {
      const replayed = await replayOf(userId, 'credit', idempotencyKey)
      if (replayed !== null) { await db.query('COMMIT'); return { ok: true, balance: replayed } }
      const { rows } = await db.query(
        `UPDATE wallets SET balance_credits = balance_credits + $2, updated_at = now()
         WHERE user_id = $1 RETURNING balance_credits`, [userId, amount])
      if (!rows.length) throw new Error(`ledger.credit: no wallet for ${userId} — call ensureUser first`)
      const balance = rows[0].balance_credits
      await db.query(
        `INSERT INTO ledger_entries
           (user_id, kind, amount, reason, idempotency_key, balance_after,
            remaining_credits, expires_at, price_book_version)
         VALUES ($1, 'credit', $2, $3, $4, $5, $2, $6, $7)`,
        [userId, amount, reason, idempotencyKey, balance,
         opts.expiresAt ?? null, opts.priceBookVersion ?? null])
      await db.query('COMMIT')
      return { ok: true, balance }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }

  /** Consume credit rows FIFO by expiry (soonest first, NULL = never expires = last). */
  async function consumeFifo(userId: string, amount: number): Promise<void> {
    let left = amount
    const { rows } = await db.query(
      `SELECT id, remaining_credits FROM ledger_entries
       WHERE user_id = $1 AND kind = 'credit' AND remaining_credits > 0
       ORDER BY expires_at ASC NULLS LAST, id ASC
       FOR UPDATE`, [userId])
    for (const row of rows) {
      if (left <= 0) break
      const take = Math.min(left, row.remaining_credits)
      await db.query(
        `UPDATE ledger_entries SET remaining_credits = remaining_credits - $2 WHERE id = $1`,
        [row.id, take])
      left -= take
    }
    // left > 0 can only happen if remaining tracking drifted from balance
    // (e.g. a settle overrun) — balance stays authoritative, so ignore.
  }

  async function debit(
    userId: string, amount: number, reason: string, idempotencyKey: string,
    opts: { priceBookVersion?: string | null } = {},
  ): Promise<LedgerResult> {
    assertAmount(amount)
    await db.query('BEGIN')
    try {
      const replayed = await replayOf(userId, 'debit', idempotencyKey)
      if (replayed !== null) { await db.query('COMMIT'); return { ok: true, balance: replayed } }
      const { rows } = await db.query(
        `SELECT balance_credits, reserved_credits FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [userId])
      if (!rows.length) throw new Error(`ledger.debit: no wallet for ${userId} — call ensureUser first`)
      const available = rows[0].balance_credits - rows[0].reserved_credits
      if (amount > available) { await db.query('ROLLBACK'); return { ok: false, reason: 'insufficient' } }
      const balance = rows[0].balance_credits - amount
      await db.query(
        `UPDATE wallets SET balance_credits = $2, updated_at = now() WHERE user_id = $1`,
        [userId, balance])
      await consumeFifo(userId, amount)
      await db.query(
        `INSERT INTO ledger_entries
           (user_id, kind, amount, reason, idempotency_key, balance_after, price_book_version)
         VALUES ($1, 'debit', $2, $3, $4, $5, $6)`,
        [userId, amount, reason, idempotencyKey, balance, opts.priceBookVersion ?? null])
      await db.query('COMMIT')
      return { ok: true, balance }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }

  async function hold(
    userId: string, estimate: number, idempotencyKey: string,
  ): Promise<{ ok: true, holdId: number } | { ok: false, reason: 'insufficient' }> {
    assertAmount(estimate)
    await db.query('BEGIN')
    try {
      const existing = await db.query(
        `SELECT id FROM holds WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey])
      if (existing.rows.length) {
        await db.query('COMMIT')
        return { ok: true, holdId: Number(existing.rows[0].id) }
      }
      const { rows } = await db.query(
        `SELECT balance_credits, reserved_credits FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [userId])
      if (!rows.length) throw new Error(`ledger.hold: no wallet for ${userId} — call ensureUser first`)
      if (estimate > rows[0].balance_credits - rows[0].reserved_credits) {
        await db.query('ROLLBACK')
        return { ok: false, reason: 'insufficient' }
      }
      await db.query(
        `UPDATE wallets SET reserved_credits = reserved_credits + $2, updated_at = now()
         WHERE user_id = $1`, [userId, estimate])
      const ins = await db.query(
        `INSERT INTO holds (user_id, amount, idempotency_key) VALUES ($1, $2, $3) RETURNING id`,
        [userId, estimate, idempotencyKey])
      await db.query('COMMIT')
      return { ok: true, holdId: Number(ins.rows[0].id) }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }

  /** Load a hold row and lock it. Returns null if missing. */
  async function lockHold(holdId: number) {
    const { rows } = await db.query(
      `SELECT id, user_id, amount, state FROM holds WHERE id = $1 FOR UPDATE`, [holdId])
    return rows[0] ?? null
  }

  async function settle(holdId: number, actual: number, reason: string): Promise<LedgerResult> {
    assertAmount(actual)
    await db.query('BEGIN')
    try {
      const h = await lockHold(holdId)
      if (!h) throw new Error(`ledger.settle: hold ${holdId} not found`)
      if (h.state !== 'open') {
        // Replay: return the balance-after of the original settle debit.
        const replayed = await replayOf(h.user_id, 'debit', `settle:${holdId}`)
        await db.query('COMMIT')
        return replayed !== null
          ? { ok: true, balance: replayed }
          : { ok: true, balance: await getBalance(h.user_id) } // was released, no debit
      }
      // Drop the reservation, then debit the actual amount unconditionally:
      // the provider job already ran — overruns overdraw and reconciliation flags them.
      await db.query(
        `UPDATE wallets SET reserved_credits = reserved_credits - $2,
                            balance_credits = balance_credits - $3, updated_at = now()
         WHERE user_id = $1`, [h.user_id, h.amount, actual])
      const balance = await getBalance(h.user_id)
      await consumeFifo(h.user_id, actual)
      await db.query(
        `INSERT INTO ledger_entries (user_id, kind, amount, reason, idempotency_key, balance_after)
         VALUES ($1, 'debit', $2, $3, $4, $5)`,
        [h.user_id, actual, reason, `settle:${holdId}`, balance])
      await db.query(`UPDATE holds SET state = 'settled' WHERE id = $1`, [holdId])
      await db.query('COMMIT')
      return { ok: true, balance }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }

  async function release(holdId: number): Promise<void> {
    await db.query('BEGIN')
    try {
      const h = await lockHold(holdId)
      if (!h) throw new Error(`ledger.release: hold ${holdId} not found`)
      if (h.state !== 'open') { await db.query('COMMIT'); return } // idempotent no-op
      await db.query(
        `UPDATE wallets SET reserved_credits = reserved_credits - $2, updated_at = now()
         WHERE user_id = $1`, [h.user_id, h.amount])
      await db.query(`UPDATE holds SET state = 'released' WHERE id = $1`, [holdId])
      await db.query('COMMIT')
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }

  return { ensureUser, getBalance, getAvailable, credit, debit, hold, settle, release }
}
