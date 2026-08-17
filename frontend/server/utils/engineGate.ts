/**
 * Hosted tenant gates for shared-engine endpoints (Stage 5 Task 5). Pure
 * filters + thin h3 handlers. Local mode never reaches any of this —
 * comfyui-proxy and the history/view routes call these ONLY under
 * deployMode() === 'hosted'.
 */
import type { H3Event } from 'h3'
import { createError, setResponseStatus } from 'h3'
import { ownedPromptIds, ownsPrompt, outputKey, pendingRuns } from './graphRuns'
import { resolveWorkerTarget } from './workerRoute'
import { settleGraphSuccess } from './meterGraphRun'

/**
 * Review C2 — an exact mirror of ComfyUI's folder_paths.annotated_filepath().
 * The engine resolves a trailing `[output]` / `[input]` / `[temp]` annotation
 * to a base directory BEFORE it looks at the `type` query param, so `type`
 * alone is not the type. Kept byte-for-byte faithful to the Python (plain
 * endsWith + fixed-width strip, which also eats the separating space) rather
 * than a tidier regex — if the two ever disagree, the gate and the engine
 * disagree about which file is being served.
 */
export function annotatedFilepath(name: string): { name: string, type: 'output' | 'input' | 'temp' | null } {
  if (name.endsWith('[output]')) return { name: name.slice(0, -9), type: 'output' }
  if (name.endsWith('[input]')) return { name: name.slice(0, -8), type: 'input' }
  if (name.endsWith('[temp]')) return { name: name.slice(0, -7), type: 'temp' }
  return { name, type: null }
}

export type ViewGate =
  | { kind: 'ungated' }
  | { kind: 'reject', status: number, message: string }
  | { kind: 'check', key: string }

/**
 * The hosted /view decision, resolved the way the engine resolves it:
 * annotation first, `type` only as the fallback, basename last (server.py
 * does `os.path.basename(filename)` after joining the subfolder).
 */
export function viewGateDecision(q: { filename: string, type?: string, subfolder?: string }): ViewGate {
  // The engine's second resolution mode: `blake3:<hash>` goes through the
  // asset store, never through (type, subfolder, filename) — there is no key
  // to check ownership against, so hosted refuses it rather than guessing.
  if (q.filename.startsWith('blake3:')) {
    return { kind: 'reject', status: 400, message: 'Hashed asset reads are not available in hosted mode' }
  }
  const { name, type: annotated } = annotatedFilepath(q.filename)
  const effective = annotated ?? (q.type || 'output')
  // type=temp / type=input stay ungated this stage (documented gap) — but
  // only when that is what the engine will ACTUALLY read.
  if (effective !== 'output') return { kind: 'ungated' }
  const basename = name.split(/[\\/]/).pop() || ''
  return { kind: 'check', key: outputKey({ filename: basename, subfolder: q.subfolder || '', type: 'output' }) }
}

/**
 * Review M5: allowlist, don't spread. The old `{ ...queue, ... }` forwarded
 * every OTHER top-level key ComfyUI puts on /queue — and every key a future
 * ComfyUI adds — to every tenant unfiltered. Only the two filtered arrays
 * leave this function.
 */
export function filterQueuePayload(queue: any, owned: Set<string>): any {
  const keep = (entries: any[]) => (Array.isArray(entries) ? entries : []).filter(e => owned.has(String(e?.[1])))
  return { queue_running: keep(queue?.queue_running), queue_pending: keep(queue?.queue_pending) }
}

/**
 * Review M4: prompt ids are keys here, and a key of `__proto__` assigned onto
 * a `{}` literal walks the prototype setter instead of adding a property —
 * mutating Object.prototype for the whole process. Null-prototype output plus
 * an explicit skip of the three magic names.
 */
const HOSTILE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function filterHistoryPayload(hist: Record<string, any>, owned: Set<string>): Record<string, any> {
  const out: Record<string, any> = Object.create(null)
  for (const [id, entry] of Object.entries(hist ?? {})) {
    if (HOSTILE_KEYS.has(id)) continue
    if (owned.has(id)) out[id] = entry
  }
  return out
}

export async function handleHostedQueueGet(event: H3Event): Promise<any> {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
  const { port } = resolveWorkerTarget(event.path)
  const res = await fetch(`http://127.0.0.1:${port}/queue`)
  if (!res.ok) throw createError({ statusCode: 502, message: 'Engine queue unavailable' })
  return filterQueuePayload(await res.json(), await ownedPromptIds(userId))
}

export async function handleHostedInterrupt(event: H3Event): Promise<any> {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
  const { port } = resolveWorkerTarget(event.path)
  const target = `http://127.0.0.1:${port}`
  const qres = await fetch(`${target}/queue`)
  const queue = qres.ok ? await qres.json() : {}
  const running = Array.isArray(queue?.queue_running) ? queue.queue_running : []
  const runningId = running.length ? String(running[0]?.[1]) : null
  if (!runningId || !(await ownsPrompt(userId, runningId))) {
    throw createError({ statusCode: 403, message: 'No interruptible run of yours is active' })
  }
  // Review M2: between the read above and this POST the running job can turn
  // over to a victim's run, and a bare /interrupt cancels whatever is running
  // NOW. ComfyUI's interrupt accepts a prompt_id and no-ops unless that id is
  // the executing one, which closes the window.
  const res = await fetch(`${target}/interrupt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: target },
    body: JSON.stringify({ prompt_id: runningId }),
  })
  setResponseStatus(event, res.status)
  // Review M3: `null` makes h3 send an empty body, so a client doing
  // res.json() on a 200 gets a parse error instead of a success.
  return { ok: true }
}

const MAIN_ENGINE = 'http://127.0.0.1:8188'
const HARVEST_CAP = 20

/**
 * Review I5: /view calls harvestPendingOutputs on EVERY ownership miss. One
 * page of 40 not-yet-settled thumbnails fired 40 harvests, each polling up to
 * HARVEST_CAP history endpoints — ~800 engine requests from a single page
 * load, all racing to do the identical work. One harvest per user per window
 * is enough: the second caller's answer would be the first's anyway.
 */
const HARVEST_TTL_MS = 3000
const lastHarvest = new Map<string, number>()

export function __resetHarvestMemoForTests(): void { lastHarvest.clear() }

/** Pure: has this user been harvested inside the window ending at `now`? */
export function harvestIsFresh(last: number | undefined, now: number): boolean {
  return last !== undefined && now - last < HARVEST_TTL_MS
}

/**
 * /view race-window fallback: the client saw the WS 'executed' event a beat
 * before the settle watcher (settleOnCompletion, polling every 2s) recorded
 * this run's outputs into graph_runs. Rather than reimplement settlement,
 * this re-polls the same main-engine history endpoint the watcher uses and
 * calls the SAME settleGraphSuccess exported from meterGraphRun.ts — one
 * settlement implementation, two callers.
 */
export async function harvestPendingOutputs(userId: string): Promise<void> {
  const now = Date.now()
  if (harvestIsFresh(lastHarvest.get(userId), now)) return
  lastHarvest.set(userId, now)

  // Ordering and the cap both live in SQL now (review I3) — an unordered
  // LIMIT picked an arbitrary 20, so a user with a backlog of stale pendings
  // could have their just-finished run fall outside the harvest window.
  const pending = await pendingRuns(userId, HARVEST_CAP)
  for (const { promptId, holdId, credits, target } of pending) {
    // Review I4: poll the engine this run was DISPATCHED to. Pre-migration
    // rows carry no target and are main-engine runs by construction.
    const engine = target ?? MAIN_ENGINE
    try {
      const res = await fetch(`${engine}/history/${encodeURIComponent(promptId)}`)
      if (!res.ok) continue
      const hist = await res.json() as Record<string, any>
      const status = hist[promptId]?.status
      if (status?.status_str === 'success' && status.completed) {
        await settleGraphSuccess(engine, promptId, holdId, credits)
      }
    } catch (e) {
      console.error('[engineGate] harvest failed for pending run', { promptId, error: e })
    }
  }
}
