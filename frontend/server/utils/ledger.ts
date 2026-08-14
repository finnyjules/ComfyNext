/**
 * The money core (accounts spec §5.2). Append-only double-entry ledger with a
 * cached wallet balance. NOTHING else writes ledger_entries or wallet columns.
 *
 * Pure module over a minimal DB handle: PGlite in unit tests, a Neon/pg client
 * in production. The handle must be a SINGLE session (not a pool) — methods
 * issue BEGIN/COMMIT on it, and the underlying connection must see at most
 * one in-flight transaction at a time. Replaces mockLedger.ts (same
 * LedgerResult shape, but async).
 *
 * Concurrency contract: createLedger() serializes its OWN calls against a
 * given db handle — every transactional method runs through an internal
 * mutex (runExclusive), so two calls on the SAME ledger instance queue up
 * rather than interleaving their BEGIN/COMMIT. That is the only guarantee
 * this module provides. Multiple ledger INSTANCES sharing one underlying
 * session are still unsafe (their BEGIN/COMMIT pairs can interleave and the
 * second BEGIN silently joins the first transaction) — either give each
 * createLedger() call its own dedicated connection (e.g. pool.connect() on
 * Neon) or route all callers through one shared instance. Note also that
 * Neon's serverless HTTP driver is one-shot per query and cannot run
 * multi-statement transactions at all — production callers need the
 * WebSocket Pool/Client, or plain pg over TCP.
 *
 * Idempotency keys beginning `settle:` or `expire:` are reserved by this
 * module (used internally for settle-debit and expiry-debit rows) — callers
 * must not construct their own idempotency keys with those prefixes.
 */
export interface LedgerDb {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>
}

export type LedgerResult =
  | { ok: true, balance: number }
  | { ok: false, reason: 'insufficient' }

export function createLedger(db: LedgerDb) {
  // Per-instance transaction mutex: only one BEGIN..COMMIT/ROLLBACK may be
  // in flight on `db` at a time. Callers queue; a rejected fn does not
  // poison the chain (the stored link swallows the error, the caller still
  // sees it via the returned, un-caught promise).
  let txChain: Promise<unknown> = Promise.resolve()
  function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = txChain.then(fn)
    txChain = result.catch(() => {})
    return result
  }

  /**
   * `email`, if given, is written inside this same mutex-serialized
   * transaction — not as a separate statement — so it can't land inside
   * another concurrent caller's open BEGIN…COMMIT window on the shared
   * session and get silently reverted by that caller's rollback.
   */
  async function ensureUser(userId: string, email?: string | null): Promise<void> {
    return runExclusive(async () => {
      await db.query('BEGIN')
      try {
        await db.query(
          `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId])
        if (email) {
          await db.query(
            `UPDATE users SET email = $2 WHERE id = $1 AND (email IS NULL OR email <> $2)`,
            [userId, email])
        }
        await db.query(
          `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId])
        await db.query('COMMIT')
      } catch (e) {
        await db.query('ROLLBACK')
        throw e
      }
    })
  }

  // getBalance/getAvailable stay OUTSIDE runExclusive on purpose: settle()
  // calls getBalance from inside the mutex — wrapping it would self-deadlock.
  // Consequence: a concurrent read may observe an in-flight transaction's
  // uncommitted same-session state. Harmless for money (writes are serialized).
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

  /**
   * A 23505 on the (user_id, kind, idempotency_key) unique index means another
   * SESSION committed this exact operation between our replay check and our
   * insert (e.g. the same Stripe webhook delivered to two app instances). The
   * per-instance mutex cannot see that race — only the index can.
   */
  function isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
  }

  /** Replay lookup: if this (user, kind, key) was already applied, return its balance-after. */
  async function replayOf(userId: string, kind: 'credit' | 'debit', key: string): Promise<number | null> {
    const { rows } = await db.query(
      `SELECT balance_after FROM ledger_entries
       WHERE user_id = $1 AND kind = $2 AND idempotency_key = $3`,
      [userId, kind, key])
    return rows.length ? Number(rows[0].balance_after) : null
  }

  async function credit(
    userId: string, amount: number, reason: string, idempotencyKey: string,
    opts: { expiresAt?: string | null, priceBookVersion?: string | null } = {},
  ): Promise<LedgerResult> {
    assertAmount(amount)
    return runExclusive(async () => {
      await db.query('BEGIN')
      try {
        const replayed = await replayOf(userId, 'credit', idempotencyKey)
        if (replayed !== null) { await db.query('COMMIT'); return { ok: true, balance: replayed } }
        const { rows } = await db.query(
          `UPDATE wallets SET balance_credits = balance_credits + $2, updated_at = now()
           WHERE user_id = $1 RETURNING balance_credits`, [userId, amount])
        if (!rows.length) throw new Error(`ledger.credit: no wallet for ${userId} — call ensureUser first`)
        const balance = Number(rows[0].balance_credits)
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
        if (isUniqueViolation(e)) {
          const winner = await replayOf(userId, 'credit', idempotencyKey)
          if (winner !== null) return { ok: true, balance: winner }
        }
        throw e
      }
    })
  }

  /**
   * Consume credit rows FIFO by expiry (soonest first, NULL = never expires = last).
   * Returns the leftover amount that could not be covered by remaining credit
   * rows (0 in the normal case). A non-zero leftover means remaining_credits
   * tracking has drifted from the wallet balance — the balance stays
   * authoritative, but callers should surface this for observability.
   */
  async function consumeFifo(userId: string, amount: number): Promise<number> {
    let left = amount
    const { rows } = await db.query(
      `SELECT id, remaining_credits FROM ledger_entries
       WHERE user_id = $1 AND kind = 'credit' AND remaining_credits > 0
       ORDER BY expires_at ASC NULLS LAST, id ASC
       FOR UPDATE`, [userId])
    for (const row of rows) {
      if (left <= 0) break
      const take = Math.min(left, Number(row.remaining_credits))
      await db.query(
        `UPDATE ledger_entries SET remaining_credits = remaining_credits - $2 WHERE id = $1`,
        [row.id, take])
      left -= take
    }
    // left > 0 can only happen if remaining tracking drifted from balance
    // (e.g. a settle overrun) — balance stays authoritative, so we don't
    // throw, but callers log it (see debit/settle).
    return left
  }

  async function debit(
    userId: string, amount: number, reason: string, idempotencyKey: string,
    opts: { priceBookVersion?: string | null } = {},
  ): Promise<LedgerResult> {
    assertAmount(amount)
    return runExclusive(async () => {
      await db.query('BEGIN')
      try {
        const replayed = await replayOf(userId, 'debit', idempotencyKey)
        if (replayed !== null) { await db.query('COMMIT'); return { ok: true, balance: replayed } }
        const { rows } = await db.query(
          `SELECT balance_credits, reserved_credits FROM wallets WHERE user_id = $1 FOR UPDATE`,
          [userId])
        if (!rows.length) throw new Error(`ledger.debit: no wallet for ${userId} — call ensureUser first`)
        const available = Number(rows[0].balance_credits) - Number(rows[0].reserved_credits)
        if (amount > available) { await db.query('ROLLBACK'); return { ok: false, reason: 'insufficient' } }
        const balance = Number(rows[0].balance_credits) - amount
        await db.query(
          `UPDATE wallets SET balance_credits = $2, updated_at = now() WHERE user_id = $1`,
          [userId, balance])
        const leftover = await consumeFifo(userId, amount)
        if (leftover !== 0)
          console.warn('[ledger] remaining_credits drift for', userId, 'short by', leftover, 'credits')
        await db.query(
          `INSERT INTO ledger_entries
             (user_id, kind, amount, reason, idempotency_key, balance_after, price_book_version)
           VALUES ($1, 'debit', $2, $3, $4, $5, $6)`,
          [userId, amount, reason, idempotencyKey, balance, opts.priceBookVersion ?? null])
        await db.query('COMMIT')
        return { ok: true, balance }
      } catch (e) {
        await db.query('ROLLBACK')
        if (isUniqueViolation(e)) {
          const winner = await replayOf(userId, 'debit', idempotencyKey)
          if (winner !== null) return { ok: true, balance: winner }
        }
        throw e
      }
    })
  }

  async function hold(
    userId: string, estimate: number, idempotencyKey: string,
  ): Promise<{ ok: true, holdId: number } | { ok: false, reason: 'insufficient' }> {
    assertAmount(estimate)
    return runExclusive(async () => {
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
        const available = Number(rows[0].balance_credits) - Number(rows[0].reserved_credits)
        if (estimate > available) {
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
    })
  }

  /** Load a hold row and lock it. Returns null if missing. */
  async function lockHold(holdId: number) {
    const { rows } = await db.query(
      `SELECT id, user_id, amount, state FROM holds WHERE id = $1 FOR UPDATE`, [holdId])
    return rows[0] ?? null
  }

  /**
   * Settle a hold for the actual cost. Takes no userId — the hold row is the
   * source of truth for ownership; callers must do their own ownership
   * check (e.g. against the authenticated session) once an HTTP surface
   * exists on top of this.
   *
   * Never rejects for insufficient funds (the provider job already ran;
   * overruns overdraw and reconciliation flags them) — the `{ ok: false,
   * reason: 'insufficient' }` arm of LedgerResult does not apply here.
   *
   * `settled` distinguishes a real charge from a released hold on replay:
   *  - `settled: true` — a debit was posted just now, OR replay found the
   *    original settle debit (the hold WAS charged, possibly on an earlier call).
   *  - `settled: false` — the hold had already been released; no debit ever
   *    happened and none happens now. Callers seeing `settled: false` after
   *    a completed provider job MUST escalate — the job ran but was never
   *    charged.
   */
  async function settle(
    holdId: number, actual: number, reason: string,
  ): Promise<{ ok: true, balance: number, settled: boolean }> {
    assertAmount(actual)
    return runExclusive(async () => {
      await db.query('BEGIN')
      try {
        const h = await lockHold(holdId)
        if (!h) throw new Error(`ledger.settle: hold ${holdId} not found`)
        if (h.state !== 'open') {
          // Replay: return the balance-after of the original settle debit,
          // or — if the hold was released instead of settled — report that
          // no charge ever happened.
          const replayed = await replayOf(h.user_id, 'debit', `settle:${holdId}`)
          await db.query('COMMIT')
          return replayed !== null
            ? { ok: true, balance: replayed, settled: true }
            : { ok: true, balance: await getBalance(h.user_id), settled: false } // was released, no debit
        }
        // Drop the reservation, then debit the actual amount unconditionally:
        // the provider job already ran — overruns overdraw and reconciliation flags them.
        await db.query(
          `UPDATE wallets SET reserved_credits = reserved_credits - $2,
                              balance_credits = balance_credits - $3, updated_at = now()
           WHERE user_id = $1`, [h.user_id, h.amount, actual])
        const balance = await getBalance(h.user_id)
        const leftover = await consumeFifo(h.user_id, actual)
        if (leftover !== 0)
          console.warn('[ledger] remaining_credits drift for', h.user_id, 'short by', leftover, 'credits')
        await db.query(
          `INSERT INTO ledger_entries (user_id, kind, amount, reason, idempotency_key, balance_after)
           VALUES ($1, 'debit', $2, $3, $4, $5)`,
          [h.user_id, actual, reason, `settle:${holdId}`, balance])
        await db.query(`UPDATE holds SET state = 'settled' WHERE id = $1`, [holdId])
        await db.query('COMMIT')
        return { ok: true, balance, settled: true }
      } catch (e) {
        await db.query('ROLLBACK')
        throw e
      }
    })
  }

  async function release(holdId: number): Promise<void> {
    return runExclusive(async () => {
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
    })
  }

  async function expireCredits(now?: string): Promise<{ expiredCredits: number }> {
    return runExclusive(async () => {
      await db.query('BEGIN')
      try {
        const nowStr = now ?? new Date().toISOString()
        // Find affected users without locking.
        const { rows: userRows } = await db.query(
          `SELECT DISTINCT user_id FROM ledger_entries
           WHERE kind = 'credit' AND remaining_credits > 0
             AND expires_at IS NOT NULL AND expires_at <= $1
           ORDER BY user_id`, [nowStr])
        let total = 0
        for (const userRow of userRows) {
          const userId = userRow.user_id
          // Lock the wallet first (matching debit/settle lock order).
          await db.query(
            `SELECT balance_credits FROM wallets WHERE user_id = $1 FOR UPDATE`, [userId])
          // Now lock and read this user's expiring credits.
          const { rows: creditRows } = await db.query(
            `SELECT id, remaining_credits FROM ledger_entries
             WHERE kind = 'credit' AND remaining_credits > 0
               AND expires_at IS NOT NULL AND expires_at <= $2
               AND user_id = $1
             ORDER BY id
             FOR UPDATE`, [userId, nowStr])
          for (const row of creditRows) {
            const remaining = Number(row.remaining_credits)
            // Post a normal expiry debit for the leftover.
            const w = await db.query(
              `UPDATE wallets SET balance_credits = balance_credits - $2, updated_at = now()
               WHERE user_id = $1 RETURNING balance_credits`, [userId, remaining])
            const balanceAfter = Number(w.rows[0].balance_credits)
            await db.query(
              `INSERT INTO ledger_entries (user_id, kind, amount, reason, idempotency_key, balance_after)
               VALUES ($1, 'debit', $2, 'expiry', $3, $4)`,
              [userId, remaining, `expire:${row.id}`, balanceAfter])
            await db.query(
              `UPDATE ledger_entries SET remaining_credits = 0 WHERE id = $1`, [row.id])
            total += remaining
          }
        }
        await db.query('COMMIT')
        return { expiredCredits: total }
      } catch (e) {
        await db.query('ROLLBACK')
        throw e
      }
    })
  }

  /**
   * Serialize a NON-ledger write against this instance's transaction mutex.
   * On the shared hosted session, any raw write issued outside the mutex can
   * land INSIDE another caller's open BEGIN..COMMIT (node-postgres queues
   * per-connection) — vanishing on that transaction's rollback or aborting
   * it on a constraint error. NEVER call ledger methods inside fn (they take
   * the same mutex — self-deadlock, like getBalance inside settle).
   */
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    return runExclusive(fn)
  }

  return { ensureUser, getBalance, getAvailable, credit, debit, hold, settle, release, expireCredits, withLock }
}
