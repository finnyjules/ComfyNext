/**
 * Nightly spend digest (Stage 7 Task 5) — reuses the `holdSweep` cron
 * pattern: schedule-only, never blocks boot, local mode schedules nothing.
 *
 * This is a DIGEST, not a true reconciliation. `provider_usage` and the
 * ledger are written at the same metering chokepoint (replicate.ts/
 * falRun.ts), so they match by construction — the join below can only catch
 * a CODE REGRESSION that writes one without the other. The genuinely useful
 * output is the daily totals: `chargedCredits` (SUM of today's ledger
 * debits, excluding reason='expiry') is the COMPLETE spend picture across
 * every surface, including training/canvas/bypass routes that never touch
 * provider_usage. Expiry debits (ledger.ts's expireCredits) are lapsed
 * credits, not provider spend — systemControls.ts's ceiling sum makes the
 * SAME exclusion; keep them identical.
 * `providerUsd`/`byProvider` (SUM of today's provider_usage.usd, per
 * provider) is DIRECT-PROVIDER-ROUTE detail only — narrower by design, not a
 * bug — it exists to show where direct-route USD actually goes. A TRUE
 * reconciliation against a provider's invoice is a manual monthly task, out
 * of scope here.
 *
 * The join key: `provider_usage.job_id = ledger_entries.idempotency_key`.
 * Both are `settle:<holdId>` — `ledger.ts`'s `settle()` hardcodes
 * `idempotency_key = settle:${holdId}` and `providerUsage.ts`'s two call
 * sites (replicate.ts/falRun.ts) record `job_id = 'settle:' + ticket.holdId`
 * to match it.
 *
 * Uses its OWN pg session (connectLedgerDb) — never the ledger's shared
 * session, so no withLock coupling — mirroring graphRuns.ts/providerUsage.ts.
 */
import { connectLedgerDb, type LedgerDbHandle } from './ledgerDb'
import { isHosted } from './deployMode'
import { captureError } from './observe'

type DbLike = { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

let dbOverride: DbLike | null = null
let shared: LedgerDbHandle | null = null

export function __setReconcileDbForTests(db: DbLike | null): void { dbOverride = db }

function db(): DbLike {
  if (dbOverride) return dbOverride
  if (!shared) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('reconcile: DATABASE_URL not set — hosted mode requires it')
    shared = connectLedgerDb(url)
  }
  return shared
}

export interface ReconcileDayDeps {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>
  now?: () => Date
}

export interface ReconcileResult {
  unmatchedJobIds: string[]
  providerUsd: number
  chargedCredits: number
  byProvider: Record<string, number>
}

/**
 * Pure core — no I/O of its own, everything comes through `deps`. Three
 * reads: today's summed ledger debit credits (the complete total), today's
 * provider_usage rows (summed overall + per-provider), and — only when there
 * ARE provider_usage rows to check — which of their job_ids have a matching
 * ledger debit idempotency_key. Anything left over is a leak candidate.
 */
export async function reconcileDay(deps: ReconcileDayDeps): Promise<ReconcileResult> {
  const { query, now = () => new Date() } = deps
  const today = now()

  const ledgerRes = await query(
    `SELECT COALESCE(SUM(amount), 0) AS c FROM ledger_entries
     WHERE kind = 'debit' AND reason <> 'expiry' AND created_at >= date_trunc('day', $1::timestamptz)`,
    [today])
  const chargedCredits = Number(ledgerRes.rows[0]?.c ?? 0)

  const usageRes = await query(
    `SELECT provider, job_id, usd FROM provider_usage
     WHERE created_at >= date_trunc('day', $1::timestamptz)`,
    [today])

  let providerUsd = 0
  const byProvider: Record<string, number> = {}
  const jobIds: string[] = []
  for (const row of usageRes.rows) {
    const usd = Number(row.usd ?? 0)
    providerUsd += usd
    const provider = String(row.provider)
    byProvider[provider] = (byProvider[provider] ?? 0) + usd
    jobIds.push(String(row.job_id))
  }

  const unmatchedJobIds: string[] = []
  if (jobIds.length > 0) {
    const matchRes = await query(
      `SELECT idempotency_key FROM ledger_entries
       WHERE kind = 'debit' AND idempotency_key = ANY($1::text[])`,
      [jobIds])
    const matched = new Set(matchRes.rows.map(r => String(r.idempotency_key)))
    for (const id of jobIds) if (!matched.has(id)) unmatchedJobIds.push(id)
  }

  return { unmatchedJobIds, providerUsd, chargedCredits, byProvider }
}

/**
 * Production wiring: real shared session + logging. Never throws out of the
 * cron — a digest failure is logged, not fatal. `console.warn` for the
 * routine digest (visible without an error-level alert threshold),
 * `console.error` only for the unmatched-spend leak signal (Sentry-captured
 * per Task 6).
 */
export async function runReconcile(): Promise<void> {
  try {
    const result = await reconcileDay({ query: (sql, params) => db().query(sql, params) })
    console.warn('[reconcile] daily digest', {
      chargedCredits: result.chargedCredits,
      providerUsd: result.providerUsd,
      byProvider: result.byProvider,
    })
    if (result.unmatchedJobIds.length > 0) {
      console.error('[reconcile] UNMATCHED provider spend — code regression', {
        unmatchedJobIds: result.unmatchedJobIds,
      })
      captureError(new Error('reconcile: unmatched provider spend — code regression'), { site: 'runReconcile', unmatchedJobIds: result.unmatchedJobIds })
    }
  } catch (e) {
    console.error('[reconcile] daily digest failed', { error: e })
  }
}

export interface ReconcileCronDeps {
  isHosted(): boolean
  run(): Promise<void>
  setTimeout(fn: () => void, ms: number): unknown
  setInterval(fn: () => void, ms: number): unknown
}

/** Cron cadence — once a night, first run soon after boot (never AT boot). */
export const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000
export const RECONCILE_FIRST_RUN_MS = 60_000

/**
 * Schedules the digest. Returns whether anything was scheduled (false in
 * local mode). Nothing is awaited or run synchronously — a Nitro plugin must
 * never hold boot hostage on a database round-trip.
 */
export function startReconcileCronWith(deps: ReconcileCronDeps): boolean {
  if (!deps.isHosted()) return false

  const tick = async (): Promise<void> => {
    try {
      await deps.run()
    } catch (e) {
      console.error('[reconcile] run failed', { error: e })
    }
  }

  deps.setTimeout(tick, RECONCILE_FIRST_RUN_MS)
  deps.setInterval(tick, RECONCILE_INTERVAL_MS)
  return true
}

/** Production wiring for the Nitro plugin. */
export function startReconcileCron(): boolean {
  return startReconcileCronWith({
    isHosted,
    run: runReconcile,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    setInterval: (fn, ms) => setInterval(fn, ms),
  })
}
