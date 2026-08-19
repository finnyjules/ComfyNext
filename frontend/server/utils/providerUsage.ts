/**
 * Records confirmed provider spend into the provider_usage Neon table — the
 * data source for the daily spend ceiling (Task 4) and nightly reconciliation
 * (Task 5). Own pg session (connectLedgerDb), never the ledger's, same shape
 * as graphRuns.ts's db(): throws when DATABASE_URL is missing rather than
 * quietly no-opping. Local mode never reaches that throw in practice — the
 * two call sites (replicate.ts/falRun.ts) only invoke this inside the
 * ticket-settle branch, and preflightMeter returns a null ticket in local
 * mode — but the whole body is still wrapped in try/catch so a misconfigured
 * hosted deploy (or a future ungated caller) logs instead of turning an
 * unawaited `void recordProviderUsage(...)` into an unhandled rejection.
 * Insert failures are swallowed+logged — recording spend must never fail a
 * settled job. Local mode / no DATABASE_URL is a no-op for the JOB: provider
 * spend there still goes to the local spend-events.jsonl as before; this
 * table is hosted-only.
 */
import { connectLedgerDb, type LedgerDbHandle } from './ledgerDb'

type DbLike = { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

let dbOverride: DbLike | null = null
let shared: LedgerDbHandle | null = null

export function __setProviderUsageDbForTests(db: DbLike | null): void { dbOverride = db }

function db(): DbLike {
  if (dbOverride) return dbOverride
  if (!shared) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('providerUsage: DATABASE_URL not set — hosted mode requires it')
    shared = connectLedgerDb(url)
  }
  return shared
}

export async function recordProviderUsage(row: { userId: string | null; provider: string; model: string; usd: number | null; jobId: string }): Promise<void> {
  try {
    await db().query(
      `INSERT INTO provider_usage (user_id, provider, model, usd, job_id) VALUES ($1, $2, $3, $4, $5)`,
      [row.userId, row.provider, row.model, row.usd, row.jobId])
  } catch (e) {
    console.error('[providerUsage] insert failed', { jobId: row.jobId, model: row.model, error: e })
  }
}
