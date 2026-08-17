/**
 * Durable prompt_id → owner registry for metered canvas runs (Stage 5).
 * Replaces the in-memory meterStore so ownership and settlement state
 * survive a server restart. Uses its OWN pg session (connectLedgerDb) —
 * never the ledger's shared session, so no withLock coupling.
 */
import { connectLedgerDb, type LedgerDbHandle } from './ledgerDb'

type DbLike = { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

let dbOverride: DbLike | null = null
let shared: LedgerDbHandle | null = null

export function __setGraphRunsDbForTests(db: DbLike | null): void { dbOverride = db }

function db(): DbLike {
  if (dbOverride) return dbOverride
  if (!shared) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('graphRuns: DATABASE_URL not set — hosted mode requires it')
    shared = connectLedgerDb(url)
  }
  return shared
}

export function outputKey(o: { filename: string; subfolder?: string; type?: string }): string {
  return `${o.type || 'output'}:${o.subfolder || ''}:${o.filename}`
}

export async function createGraphRun(r: { promptId: string; userId: string; credits: number; holdId: number | null }): Promise<void> {
  await db().query(
    `INSERT INTO graph_runs (prompt_id, user_id, credits, hold_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (prompt_id) DO NOTHING`,
    [r.promptId, r.userId, r.credits, r.holdId])
}

export async function resolveGraphRun(promptId: string, state: 'settled' | 'voided', outputs: string[] = []): Promise<void> {
  await db().query(
    `UPDATE graph_runs SET state = $1, outputs = $2::jsonb WHERE prompt_id = $3`,
    [state, JSON.stringify(outputs), promptId])
}

export async function ownsPrompt(userId: string, promptId: string): Promise<boolean> {
  const { rows } = await db().query(
    `SELECT 1 AS ok FROM graph_runs WHERE user_id = $1 AND prompt_id = $2`, [userId, promptId])
  return rows.length > 0
}

export async function ownedPromptIds(userId: string): Promise<Set<string>> {
  const { rows } = await db().query(
    `SELECT prompt_id FROM graph_runs WHERE user_id = $1`, [userId])
  return new Set(rows.map(r => String(r.prompt_id)))
}

export async function ownedOutputKeys(userId: string): Promise<Set<string>> {
  const { rows } = await db().query(
    `SELECT outputs FROM graph_runs WHERE user_id = $1`, [userId])
  const out = new Set<string>()
  for (const r of rows) for (const k of (r.outputs ?? [])) out.add(String(k))
  return out
}

export async function pendingRuns(userId: string): Promise<{ promptId: string; holdId: number | null; credits: number }[]> {
  const { rows } = await db().query(
    `SELECT prompt_id, hold_id, credits FROM graph_runs WHERE user_id = $1 AND state = 'pending'`, [userId])
  return rows.map(r => ({ promptId: String(r.prompt_id), holdId: r.hold_id == null ? null : Number(r.hold_id), credits: Number(r.credits) }))
}
