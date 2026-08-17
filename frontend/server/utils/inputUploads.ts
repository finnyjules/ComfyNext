/**
 * Who uploaded which engine input file (Stage 5 round 3, R1/R2).
 *
 * The engine's input directory is shared across tenants until per-tenant dirs
 * land in Stage 6, and ComfyUI's /upload honours an `overwrite` field that
 * makes the write unconditional. Round 2 refused the field outright; that broke
 * eight app flows which legitimately overwrite their OWN freshly-minted files.
 * This table is what makes "your own file" answerable: one row per stored
 * upload, first writer wins, checked before an overwrite is forwarded.
 *
 * Uses its OWN pg session (connectLedgerDb) like graphRuns.ts — never the
 * ledger's shared session, so no withLock coupling.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { connectLedgerDb, type LedgerDbHandle } from './ledgerDb'

type DbLike = { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

let dbOverride: DbLike | null = null
let shared: LedgerDbHandle | null = null

export function __setInputUploadsDbForTests(db: DbLike | null): void { dbOverride = db }

function db(): DbLike {
  if (dbOverride) return dbOverride
  if (!shared) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('inputUploads: DATABASE_URL not set — hosted mode requires it')
    shared = connectLedgerDb(url)
  }
  return shared
}

/**
 * First writer keeps the name. A second recordUpload for the same key is the
 * owner re-saving their own file (allowed, and already theirs) or a legitimate
 * engine-side collision — neither should transfer ownership.
 */
export async function recordUpload(userId: string, fileKey: string): Promise<void> {
  await db().query(
    `INSERT INTO input_uploads (file_key, user_id) VALUES ($1, $2)
     ON CONFLICT (file_key) DO NOTHING`,
    [fileKey, userId])
}

export async function uploadOwner(fileKey: string): Promise<string | null> {
  const { rows } = await db().query(
    `SELECT user_id FROM input_uploads WHERE file_key = $1`, [fileKey])
  return rows.length ? String(rows[0].user_id) : null
}

/**
 * The engine directory a `type` resolves to, mirroring server.py's
 * get_dir_by_type(): unknown and absent both mean `input`. folder_paths puts
 * all three beside the ComfyUI root, which is the repo root — one level above
 * the Nuxt cwd, the same resolution moodboardImages.ts uses.
 */
export function engineDirForType(type: string): string {
  const name = type === 'output' || type === 'temp' ? type : 'input'
  return path.resolve(process.cwd(), '..', name)
}

/**
 * Refuse anything that could make the path we CHECK differ from the path the
 * engine WRITES.
 *
 * `..` and absolute paths are the traversal cases. Backslash is here because
 * aiohttp un-escapes `\` inside a quoted Content-Disposition parameter and
 * undici does not: `filename="fil\e.png"` is `fil\e.png` to us and `file.png`
 * to the engine, so an ownership check on the first name would wave through a
 * write to the second. No Sailor flow produces either character.
 */
export function unsafeUploadTarget(subfolder: string, filename: string): boolean {
  for (const s of [subfolder, filename]) {
    if (s.includes('\\')) return true
    if (s.split('/').some(seg => seg === '..')) return true
    if (s.startsWith('/')) return true
    if (/^[a-zA-Z]:/.test(s)) return true
  }
  if (!filename) return true
  return false
}

/**
 * Does the engine already hold this file? An unclaimed name that exists on disk
 * belongs to somebody — every upload that predates this table has no row.
 * Containment is re-checked after resolution so a path that slips past
 * unsafeUploadTarget still cannot address anything outside the type's dir.
 */
export function uploadExistsOnDisk(type: string, subfolder: string, filename: string): boolean {
  const dir = engineDirForType(type)
  const full = path.resolve(dir, subfolder, filename)
  if (full !== dir && !full.startsWith(dir + path.sep)) return true
  return existsSync(full)
}
