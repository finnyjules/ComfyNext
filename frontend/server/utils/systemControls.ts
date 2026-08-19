/**
 * Operator safety valves (Stage 7 Task 4) — a global kill-switch, a per-user
 * disable set, and a daily spend ceiling, all read at the metering preflight
 * before every paid action. This is the BACKSTOP for a metering bug spiking
 * spend: prepaid credits already bound per-USER spend, but a bug could
 * over-dispatch, so a global valve refuses everything until an operator
 * clears it.
 *
 * Money code — it FAILS CLOSED. An unreadable control state (Neon down, a
 * malformed row) REFUSES rather than proceeds: the opposite direction from
 * moderation (which fails open). Uses its OWN pg session (connectLedgerDb) —
 * never the ledger's shared session, so no withLock coupling — mirroring
 * graphRuns.ts / resourceOwners.ts.
 *
 * The ceiling sums today's `ledger_entries` DEBITS (credits), NOT
 * provider_usage.usd: canvas-graph provider spend runs inside the Python
 * engine and never flows through the Nitro provider chokepoints, so
 * provider_usage undercounts the biggest spend surface. The ledger captures
 * EVERY paid action across both surfaces, so it is the complete + exact
 * signal for a runaway-bug budget backstop. Env is a daily CREDIT ceiling —
 * SAILOR_DAILY_CREDIT_CEILING, integer; unset/0 means no ceiling.
 *
 * The sum excludes reason='expiry' debits (ledger.ts's expireCredits — a
 * lapsed-credit batch posts a normal 'debit' row, NOT provider spend). Left
 * in, a big expiry batch could trip a spurious global pause with zero real
 * spend. reconcile.ts's chargedCredits sum makes the SAME exclusion — keep
 * them identical.
 *
 * Local mode (no Clerk key) is a pure no-op — no query issued at all, so the
 * pre-accounts single-tenant behavior is byte-identical.
 */
import { connectLedgerDb, type LedgerDbHandle } from './ledgerDb'
import { deployMode } from './deployMode'
import { MeterRefusalError } from './requestMeter'

type DbLike = { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

let dbOverride: DbLike | null = null
let shared: LedgerDbHandle | null = null

// The daily-credits sum is read on the hot metering path — memoize it ~30s so
// a burst of preflights issues ONE sum query, not one per request. A module
// level memo mirrors the { value, at } shape the plan asks for.
const CEILING_TTL_MS = 30_000
let ceilingMemo: { value: number; at: number } | null = null

export function __setSystemControlsDbForTests(db: DbLike | null): void {
  dbOverride = db
  ceilingMemo = null
}

function db(): DbLike {
  if (dbOverride) return dbOverride
  if (!shared) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('systemControls: DATABASE_URL not set — hosted mode requires it')
    shared = connectLedgerDb(url)
  }
  return shared
}

function ceiling(): number {
  return Number(process.env.SAILOR_DAILY_CREDIT_CEILING || 0)
}

async function dailyDebitCredits(d: DbLike): Promise<number> {
  const now = Date.now()
  if (ceilingMemo && now - ceilingMemo.at < CEILING_TTL_MS) return ceilingMemo.value
  const { rows } = await d.query(
    `SELECT COALESCE(SUM(amount), 0) AS c FROM ledger_entries
     WHERE kind = 'debit' AND reason <> 'expiry' AND created_at >= date_trunc('day', now())`)
  const value = Number(rows[0]?.c ?? 0)
  ceilingMemo = { value, at: now }
  return value
}

/**
 * The preflight guard. Local mode returns immediately. Hosted mode reads the
 * three controls (global pause, per-user disable, daily ceiling) and throws a
 * 503 MeterRefusalError on any tripped valve. Every read is wrapped: an
 * unreadable control state throws 503 too (fail closed). Called BEFORE the
 * ledger hold in preflight, so a refusal takes no hold.
 */
export async function assertSpendAllowed(userId: string): Promise<void> {
  if (deployMode() === 'local') return

  let paused = false
  let disabled = false
  let overCeiling = false
  try {
    const d = db()
    const controls = await d.query(`SELECT global_paused FROM system_controls WHERE id = 1`)
    paused = controls.rows[0]?.global_paused === true

    const dis = await d.query(`SELECT 1 AS ok FROM disabled_users WHERE user_id = $1`, [userId])
    disabled = dis.rows.length > 0

    const cap = ceiling()
    if (cap > 0) overCeiling = (await dailyDebitCredits(d)) >= cap
  } catch (e) {
    // Fail CLOSED — an unreadable control state refuses rather than letting
    // spend through unguarded.
    console.error('[systemControls] control read failed — failing closed', e)
    throw new MeterRefusalError('Sailor is temporarily paused', 503)
  }

  if (paused || disabled || overCeiling)
    throw new MeterRefusalError('Sailor is temporarily paused', 503)
}

/** Admin read — the current pause flag + the list of disabled user ids. */
export async function getControls(): Promise<{ globalPaused: boolean; disabledUsers: string[] }> {
  const d = db()
  const controls = await d.query(`SELECT global_paused FROM system_controls WHERE id = 1`)
  const dis = await d.query(`SELECT user_id FROM disabled_users ORDER BY created_at`)
  return {
    globalPaused: controls.rows[0]?.global_paused === true,
    disabledUsers: dis.rows.map(r => String(r.user_id)),
  }
}

/** Today's summed ledger debit credits — the admin GET's spend readout. */
export async function getTodayCredits(): Promise<number> {
  return dailyDebitCredits(db())
}

export async function setGlobalPaused(paused: boolean): Promise<void> {
  await db().query(
    `UPDATE system_controls SET global_paused = $1, updated_at = now() WHERE id = 1`, [paused])
}

export async function setUserDisabled(userId: string, disabled: boolean): Promise<void> {
  if (disabled) {
    await db().query(
      `INSERT INTO disabled_users (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId])
  } else {
    await db().query(`DELETE FROM disabled_users WHERE user_id = $1`, [userId])
  }
}
