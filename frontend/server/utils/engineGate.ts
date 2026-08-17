/**
 * Hosted tenant gates for shared-engine endpoints (Stage 5 Task 5). Pure
 * filters + thin h3 handlers. Local mode never reaches any of this —
 * comfyui-proxy and the history/view routes call these ONLY under
 * deployMode() === 'hosted'.
 */
import type { H3Event } from 'h3'
import { createError, getRequestHeader, readRawBody, setResponseStatus } from 'h3'
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

// ---------------------------------------------------------------------------
// F2 — /object_info leaks every tenant's uploaded filenames.
// ---------------------------------------------------------------------------

/**
 * The option keys ComfyUI marks a file-picker widget with. Verified against a
 * live catalog (864 nodes): these four are the complete set, and the 11 inputs
 * carrying them are EXACTLY the 11 that embed real input-directory filenames —
 * traced by probing the catalog for known uploads, not by reading names.
 * Model/checkpoint/LoRA combos carry none of them and are shared assets
 * anyway, so they survive untouched.
 */
const UPLOAD_FLAG_KEYS = ['image_upload', 'video_upload', 'audio_upload', 'file_upload']

function declaresUploadWidget(opts: unknown): boolean {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) return false
  return UPLOAD_FLAG_KEYS.some(k => Boolean((opts as Record<string, unknown>)[k]))
}

/**
 * Empty the filename list on one input spec, in place, leaving every other
 * byte of it alone.
 *
 * ComfyUI serves upload widgets in TWO shapes and a hosted scrubber that
 * knows only the documented one still leaks three node families:
 *
 *   legacy  ["<file>", "<file>", …], { image_upload: true }]   LoadImage, …
 *   v2      ["COMBO", { options: ["<file>", …], audio_upload: true }]
 *
 * A third shape carries the flag but no inline list and needs no scrubbing:
 * Painter is ["STRING", {...}], and LoadImageOutput points the client at
 * `remote: { route: "/internal/files/output" }` — already a hosted 403.
 *
 * The `image_upload` flag itself is PRESERVED: the frontend keys its upload
 * button off it, and the point is to hide other tenants' filenames, not to
 * take the widget away.
 */
function scrubUploadSpec(spec: unknown[]): void {
  if (Array.isArray(spec[0])) spec[0] = []
  const opts = spec[1]
  if (opts && typeof opts === 'object' && Array.isArray((opts as Record<string, unknown>).options)) {
    ;(opts as Record<string, unknown>).options = []
  }
}

/**
 * Strip the shared input-directory listing out of an /object_info response.
 *
 * Everything else must survive byte-identical — direct execution's
 * graphToPrompt validates against these schemas client-side, so a scrubber
 * that drops or reorders node definitions breaks every hosted render.
 * Mutates a structured clone; key insertion order is preserved by JS for the
 * non-numeric keys ComfyUI uses.
 */
export function scrubObjectInfo(catalog: unknown): unknown {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return catalog
  const out = structuredClone(catalog) as Record<string, any>
  for (const node of Object.values(out)) {
    const input = node?.input
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue
    for (const section of Object.values(input)) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) continue
      for (const spec of Object.values(section as Record<string, unknown>)) {
        if (Array.isArray(spec) && declaresUploadWidget(spec[1])) scrubUploadSpec(spec)
      }
    }
  }
  return out
}

/** Resolve the pool worker and rewrite `/comfyui`-prefixed paths, as the raw proxy does. */
function engineTarget(path: string): { target: string, backendPath: string } {
  const { port, cleanUrl } = resolveWorkerTarget(path)
  const target = `http://127.0.0.1:${port}`
  const backendPath = cleanUrl.startsWith('/comfyui')
    ? cleanUrl.replace(/^\/comfyui/, '') || '/'
    : cleanUrl
  return { target, backendPath }
}

export async function handleHostedObjectInfo(event: H3Event): Promise<unknown> {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
  // `?comfyWorker=N` must keep targeting the pool worker: node availability
  // differs per worker, so answering from the main instance would hand the
  // canvas a schema the executing engine does not have.
  const { target, backendPath } = engineTarget(event.path)
  const res = await fetch(`${target}${backendPath}`, { headers: { origin: target } })
  if (!res.ok) throw createError({ statusCode: 502, message: 'Engine object_info unavailable' })
  return scrubObjectInfo(await res.json())
}

// ---------------------------------------------------------------------------
// F4 — cross-tenant overwrite via /upload.
// ---------------------------------------------------------------------------

/**
 * Does this multipart body declare an `overwrite` field?
 *
 * VERIFIED in ComfyUI's server.py image_upload(): without a truthy `overwrite`
 * ("true" or "1") the handler loops `while os.path.exists(filepath)` and
 * auto-suffixes `name (1).png`, `name (2).png`, … so an upload can never
 * clobber a file it did not write. WITH it, the write is unconditional — and
 * the input directory is shared across tenants until per-tenant dirs land in
 * Stage 6, so a guessed filename is another tenant's asset replaced.
 *
 * So the mitigation is to refuse the field, not to rewrite it: dropping a part
 * from a multipart body means re-encoding it (boundary bookkeeping, 100 MB
 * image buffers) to reach a default the engine already applies for free.
 *
 * Matched against the Content-Disposition header line rather than a bare
 * substring scan, so image BYTES that happen to contain `name="overwrite"`
 * don't 403 an innocent upload. A false positive here is a refused upload, not
 * an accepted clobber — the match errs toward closed either way.
 */
const OVERWRITE_PART = /content-disposition:[^\r\n]*;\s*name=(?:"overwrite"|overwrite(?![\w-]))/i

export function bodyDeclaresOverwrite(body: Buffer | string | undefined): boolean {
  if (!body || !body.length) return false
  const text = typeof body === 'string' ? body : body.toString('latin1')
  return OVERWRITE_PART.test(text)
}

export async function handleHostedUpload(event: H3Event): Promise<unknown> {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })

  // Read ONCE, as a Buffer. This is proxy middleware, so the request stream is
  // still unconsumed here — but it is single-shot, and proxyRequest is no
  // longer downstream of us to re-read it. The same bytes are forwarded below.
  const body = await readRawBody(event, false)
  if (bodyDeclaresOverwrite(body)) {
    throw createError({ statusCode: 403, message: 'Uploads may not set overwrite in hosted mode' })
  }

  const { target, backendPath } = engineTarget(event.path)
  const contentType = getRequestHeader(event, 'content-type')
  const headers: Record<string, string> = { origin: target }
  // The multipart boundary lives in this header — forwarding the body without
  // it makes the engine reject every part.
  if (contentType) headers['content-type'] = contentType

  const res = await fetch(`${target}${backendPath}`, { method: 'POST', headers, body: body as any })
  setResponseStatus(event, res.status)
  const raw = await res.text()
  try {
    return JSON.parse(raw)
  }
  catch {
    return raw
  }
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
