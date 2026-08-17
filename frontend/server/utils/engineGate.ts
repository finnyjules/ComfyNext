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
import { parseUploadForm } from './multipart'
import { canonicalUploadKey, recordUpload, unsafeUploadTarget, uploadExistsOnDisk, uploadOwner } from './inputUploads'

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
  // R3: emptying the list is not enough. ComfyUI seeds `default` with the
  // FIRST entry of that same directory listing, so AudioWaveform.audio_file
  // shipped the alphabetically-first filename in the shared input dir to every
  // tenant with the options stripped. Blanked rather than deleted: the widget
  // reads it, and a missing key and an empty one render the same.
  if (opts && typeof opts === 'object' && typeof (opts as Record<string, unknown>).default === 'string') {
    ;(opts as Record<string, unknown>).default = ''
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
 * The hosted upload body cap (R4). The gate has to hold the whole body to
 * inspect it and forward the identical bytes, so the size has to be bounded
 * somewhere — `proxyRequest` used to stream it and never did.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/**
 * VERIFIED in ComfyUI's server.py image_upload(): without a truthy `overwrite`
 * the handler loops `while os.path.exists(filepath)` and auto-suffixes
 * `name (1).png`, `name (2).png`, … so the upload can never clobber a file it
 * did not write. WITH it the write is unconditional — and the input directory
 * is shared across tenants until per-tenant dirs land in Stage 6.
 *
 * The engine's test is `overwrite == "true" or overwrite == "1"` on the exact
 * string. Ours trims and lowercases first, so every value the engine honours is
 * inside the set we gate, plus a few it would ignore. Erring wide here costs at
 * most a refusal of an upload the engine would have auto-suffixed anyway.
 */
export function isOverwriteValue(v: string): boolean {
  const s = v.trim().toLowerCase()
  return s === 'true' || s === '1'
}

/**
 * Field names as the ENGINE will read them.
 *
 * aiohttp un-escapes backslashes inside a quoted Content-Disposition parameter
 * and undici does not, so `name="over\write"` is the field `over\write` to our
 * parser and `overwrite` to the engine — a body that parses cleanly on both
 * sides and still means different things. Un-escaping (plus trim/lowercase,
 * since aiohttp accepts `NAME=`) collapses that gap. Everything ELSE aiohttp
 * tolerates and undici refuses never gets this far: the parse fails and the
 * body is rejected with a 400 rather than forwarded.
 */
export function normalizeFieldName(raw: string): string {
  return raw.replace(/\\(.)/g, '$1').trim().toLowerCase()
}

/**
 * The whole overwrite rule: it is yours, or it is nobody's.
 *
 * A name with no ownership row that already exists on disk is NOT free — every
 * upload that predates the table is unclaimed, and treating unclaimed as free
 * would hand back exactly the cross-tenant clobber this gate exists to stop.
 *
 * `existsOnDisk === null` (S2) means the engine root couldn't be resolved —
 * the disk answer is UNKNOWN, not "nothing's there". Ownership still decides
 * outright when there's an owner; only the "nobody claims it" branch needs
 * the disk answer, and an unknown answer there fails CLOSED exactly like a
 * known `true` would.
 */
export function decideOverwrite(userId: string, owner: string | null, existsOnDisk: boolean | null): boolean {
  if (owner !== null) return owner === userId
  if (existsOnDisk === null) return false
  return !existsOnDisk
}

/**
 * F4 (round 3) — /upload is ownership-scoped rather than overwrite-free.
 *
 * The body is PARSED for inspection and FORWARDED unchanged: the parser decides
 * whether the request may proceed, the original bytes fly untouched under the
 * original content-type, so nothing here can corrupt an upload by re-encoding
 * it. Ownership is then recorded from the ENGINE's response, because the name
 * the engine stored may be an auto-suffixed `shot (1).png` rather than the one
 * that was asked for.
 */
export async function handleHostedUpload(event: H3Event): Promise<unknown> {
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })

  // Refuse an over-cap upload from its declared length, BEFORE buffering it.
  // A lying Content-Length is caught again on the buffer below.
  const declared = Number(getRequestHeader(event, 'content-length'))
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, message: 'Upload exceeds the 100 MB limit' })
  }

  // Read ONCE, as a Buffer. This is proxy middleware, so the request stream is
  // still unconsumed here — but it is single-shot, and proxyRequest is no
  // longer downstream of us to re-read it. The same bytes are forwarded below.
  const body = await readRawBody(event, false)
  if (body && body.length > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, message: 'Upload exceeds the 100 MB limit' })
  }

  const contentType = getRequestHeader(event, 'content-type')
  const form = await parseUploadForm(body ?? Buffer.alloc(0), contentType || 'application/octet-stream')

  // A backslash in a part NAME is the last place the two parsers can disagree
  // about what a body says: undici keeps `sub\folder` as written, aiohttp
  // un-escapes it to `subfolder` and reads the field we never looked at. That
  // would let a request pass the gate on one path and be written to another. No
  // client sends one, so the whole class is refused rather than emulated.
  if (form.names().some(n => n.includes('\\'))) {
    throw createError({ statusCode: 400, message: 'Upload field names are not addressable' })
  }

  // Scan every text part rather than looking one key up: duplicates, casing and
  // ordering are all decided by the engine's parser, not ours, so ANY part that
  // reads as a truthy `overwrite` puts the request on the gated path.
  const overwrite = form.textEntries()
    .some(([name, value]) => normalizeFieldName(name) === 'overwrite' && isOverwriteValue(value))
  const subfolder = form.text('subfolder')
  const type = form.text('type') || 'input'

  if (overwrite) {
    const file = await form.file('image')
    const filename = file?.filename || ''
    if (!filename) {
      throw createError({ statusCode: 400, message: 'An overwriting upload must carry a named file' })
    }
    if (unsafeUploadTarget(subfolder, filename)) {
      throw createError({ statusCode: 400, message: 'Upload path is not addressable' })
    }
    // S1: the same canonicalization the record below uses — a raw `type` or
    // `subfolder` alias (`bogus`, `.`) must resolve to the identical key an
    // earlier canonical-form upload was recorded under, or the lookup below
    // silently misses an owner that actually exists.
    const key = canonicalUploadKey(type, subfolder, filename)
    const owner = await uploadOwner(key)
    const onDisk = uploadExistsOnDisk(type, subfolder, filename)
    // S2: no owner AND the disk answer is unknown (engine root unresolved) —
    // this is a server misconfiguration, not an ownership conflict. Named
    // separately so the response doesn't lie about why the write was refused.
    if (owner === null && onDisk === null) {
      throw createError({
        statusCode: 403,
        message: 'Upload refused: the server could not resolve its engine input directory '
          + '(configuration issue) — this is not an ownership conflict',
      })
    }
    if (!decideOverwrite(userId, owner, onDisk)) {
      throw createError({
        statusCode: 403,
        message: `${filename} already belongs to another account — upload it under a different name`,
      })
    }
  }

  const { target, backendPath } = engineTarget(event.path)
  const headers: Record<string, string> = { origin: target }
  // The multipart boundary lives in this header — forwarding the body without
  // it makes the engine reject every part.
  if (contentType) headers['content-type'] = contentType

  const res = await fetch(`${target}${backendPath}`, { method: 'POST', headers, body: body as any })
  setResponseStatus(event, res.status)
  const raw = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return raw
  }

  if (res.status >= 200 && res.status < 300) {
    const stored = parsed as { name?: unknown, subfolder?: unknown, type?: unknown }
    if (typeof stored?.name === 'string' && stored.name) {
      // Record what was ACTUALLY stored — the engine auto-suffixes on collision,
      // and recording the requested name would claim a file we do not hold.
      // A failure here is logged, not thrown: the write already happened, and a
      // missing row fails CLOSED (an unclaimed name that exists on disk is
      // refused to everyone) rather than opening the file to the next caller.
      const key = canonicalUploadKey(
        typeof stored.type === 'string' && stored.type ? stored.type : 'input',
        typeof stored.subfolder === 'string' ? stored.subfolder : '',
        stored.name,
      )
      try {
        await recordUpload(userId, key)
      }
      catch (e) {
        console.error('[engineGate] failed to record upload ownership', { key, error: e })
      }
    }
  }
  return parsed
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
