/**
 * Stage 5 Task 4: the metered graph submission path. In hosted mode the
 * comfyui-proxy middleware routes POST /prompt here instead of raw-proxying
 * (local mode falls through to the raw proxy unchanged). Invariants:
 * (1) hold BEFORE forward — an underfunded run never reaches the engine;
 * (2) ComfyUI's response body passes through VERBATIM (clients parse
 *     prompt_id / node_errors from the real shape);
 * (3) settlement is watcher-driven: settle the hold + record output filenames
 *     on success, release the hold on error/timeout. Refusals cost nothing.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { priceGraph, UnpricedGraphError, OUTPUT_CLASS_TYPES } from './priceBook'
import { MeterRefusalError } from './requestMeter'
import { createGraphRun, resolveGraphRun, outputKey, ownedOutputKeys } from './graphRuns'
import { settleOnCompletion } from './settleWatcher'
import { stripForeignComfyOrgCreds } from './spikeAuth'
import { resolveWorkerTarget } from './workerRoute'
import { getLiveLedger } from './ledgerLive'
import { annotatedFilepath, collectUploadFlaggedInputs } from './engineGate'
import { canonicalUploadKey, uploadOwner } from './inputUploads'

export function isPromptPath(path: string): boolean {
  return path === '/prompt' || path.startsWith('/prompt?')
}

// ---------------------------------------------------------------------------
// Stage 6 Task 7 — per-user output subfolders + graph file-reference ownership.
// ---------------------------------------------------------------------------

/**
 * A stable, non-reversible per-user path segment: the first 12 hex chars of
 * sha256(userId). Deterministic (same user → same subfolder across restarts)
 * and carries no PII into the output directory name. 12 hex = 48 bits, ample
 * to keep tenants apart on a shared engine disk.
 */
export function shortUserHash(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12)
}

/**
 * Rewrite a client-supplied `filename_prefix` so every SaveImage-family node
 * writes under the caller's OWN `u_<hash>/` subfolder — outputs land in
 * `output/u_<hash>/...` and can never be written into (or over) another
 * tenant's tree. The engine's get_save_image_path splits the prefix on `/`
 * into subfolder+filename and containment-checks it (folder_paths.py:453-456);
 * we harden the same boundary up front.
 *
 * The caller's segment is PREPENDED exactly once: any leading `u_<segment>/`
 * runs the client supplied (their own hash repeated, or a forged
 * `u_otherhash/`) are stripped first, then `..`/`.`/empty segments are dropped,
 * so a forged `u_otherhash/evil` becomes `u_<caller>/evil` — replaced, never
 * nested. Returns a CLONE; the input graph is never mutated (no cross-request
 * bleed through a shared body object).
 */
export function injectOutputSubfolder(prompt: Record<string, any>, userId: string): Record<string, any> {
  const hash = shortUserHash(userId)
  const clone = structuredClone(prompt)
  for (const node of Object.values(clone)) {
    if (!node || typeof node !== 'object') continue
    if (!OUTPUT_CLASS_TYPES.has((node as any).class_type)) continue
    const inputs = (node as any).inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) (node as any).inputs = {}
    const target = (node as any).inputs as Record<string, unknown>
    const existing = typeof target.filename_prefix === 'string' ? target.filename_prefix : ''
    target.filename_prefix = `u_${hash}/${sanitizeExistingPrefix(existing)}`
  }
  return clone
}

/**
 * Strip a client prefix down to a contained, foreign-namespace-free suffix:
 * fold backslashes, drop any leading `u_<segment>/` runs (so the caller's own
 * hash is the ONLY per-user segment), then drop `..`/`.`/empty path segments.
 * Falls back to `ComfyUI` when nothing usable remains.
 */
function sanitizeExistingPrefix(existing: string): string {
  let base = existing.replace(/\\/g, '/').replace(/^(u_[^/]+\/)+/, '')
  base = base.split('/').filter(s => s && s !== '.' && s !== '..').join('/')
  return base || 'ComfyUI'
}

/** The remote-routed pair object_info never flags — added by hand. See engineGate.collectUploadFlaggedInputs. */
const LOAD_IMAGE_OUTPUT_PAIR = 'LoadImageOutput.image'

export interface GraphFileRefCtx {
  /** `ClassType.inputName` pairs whose widget carries a shared-directory filename. */
  uploadFlagged: Set<string>
  /** Does the caller own this input file (annotation stripped)? */
  ownsInput(name: string): Promise<boolean>
  /** Does the caller own this output file (value may still carry `[output]`)? */
  ownsOutput(annotated: string): Promise<boolean>
}

/**
 * Refuse (403) a graph that references any file the caller does not own.
 *
 * For every upload-flagged input (the object_info-derived set PLUS the
 * hardcoded LoadImageOutput.image), the value is a filename the engine will
 * READ from a shared directory. LoadImageOutput.image always reads from the
 * output tree; every other flagged input routes by its ` [output]`/` [input]`/
 * ` [temp]` annotation (annotatedFilepath) — `[output]` → the output-ownership
 * check, everything else → input-ownership. Fail closed: a present flagged
 * value that is not a plain filename string (a wired link, an object, a number)
 * is refused — we cannot vet what we cannot read. Absent/empty values reference
 * no file and are skipped, so zero-file and partial graphs are untouched.
 *
 * Pure over `ctx`: it takes NO ledger/DB action, so the caller can run it
 * BEFORE any credit hold and a refusal costs nothing.
 */
export async function validateGraphFileRefs(prompt: Record<string, any>, ctx: GraphFileRefCtx): Promise<void> {
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return
  for (const node of Object.values(prompt)) {
    const ct = (node as any)?.class_type
    if (typeof ct !== 'string') continue
    const inputs = (node as any)?.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    for (const [inputName, value] of Object.entries(inputs as Record<string, unknown>)) {
      const isLoadOutput = ct === 'LoadImageOutput' && inputName === 'image'
      if (!isLoadOutput && !ctx.uploadFlagged.has(`${ct}.${inputName}`)) continue
      // Absent/null references no file — leaves zero-file/partial graphs alone.
      if (value === undefined || value === null) continue
      // Fail closed: a flagged widget input must carry a plain filename string.
      if (typeof value !== 'string') {
        throw new MeterRefusalError(`graph references a file through ${ct}.${inputName} in an unexpected shape`, 403)
      }
      if (value === '') continue

      if (isLoadOutput) {
        // LoadImageOutput reads from the OUTPUT tree by definition, whatever
        // (or whether) the value is annotated.
        if (!(await ctx.ownsOutput(value))) {
          throw new MeterRefusalError(`graph references an output file you do not own (${ct}.${inputName})`, 403)
        }
        continue
      }

      const { name, type } = annotatedFilepath(value)
      if (type === 'output') {
        if (!(await ctx.ownsOutput(value))) {
          throw new MeterRefusalError(`graph references an output file you do not own (${ct}.${inputName})`, 403)
        }
      }
      else if (!(await ctx.ownsInput(name))) {
        throw new MeterRefusalError(`graph references an input file you do not own (${ct}.${inputName})`, 403)
      }
    }
  }
}

// The upload-flag map is derived from the live engine's object_info catalog —
// the SAME source the /object_info scrubber reads — and cached per process so a
// graph submission doesn't refetch a large catalog on every run.
const FLAG_MAP_TTL_MS = 60000
let flagMapCache: { at: number, set: Set<string> } | null = null

export function __resetUploadFlagMapForTests(): void { flagMapCache = null }

export async function loadUploadFlaggedInputs(fetchCatalog: () => Promise<unknown>): Promise<Set<string>> {
  const now = Date.now()
  if (flagMapCache && now - flagMapCache.at < FLAG_MAP_TTL_MS) return flagMapCache.set
  const set = collectUploadFlaggedInputs(await fetchCatalog())
  // LoadImageOutput.image is remote-routed, not upload-flagged (nodes.py:1951-
  // 1959), so the catalog walk never yields it — add the pair by hand.
  set.add(LOAD_IMAGE_OUTPUT_PAIR)
  flagMapCache = { at: now, set }
  return set
}

/**
 * The live wiring of validateGraphFileRefs for a hosted submission: build the
 * ownership ctx against input_uploads / graph_runs for `userId`, pull the
 * upload-flag map from `target`'s object_info, and validate. Short-circuits
 * BEFORE touching the catalog or the DB when the graph carries no candidate
 * file reference at all (no string-valued input, no LoadImageOutput) — a graph
 * that references no file can leak nothing.
 */
export async function runGraphFileValidation(prompt: Record<string, any>, userId: string, target: string): Promise<void> {
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return
  const hasCandidate = Object.values(prompt).some((n: any) =>
    n?.class_type === 'LoadImageOutput'
    || (n?.inputs && typeof n.inputs === 'object' && !Array.isArray(n.inputs)
      && Object.values(n.inputs).some(v => typeof v === 'string' && v !== '')))
  if (!hasCandidate) return

  const uploadFlagged = await loadUploadFlaggedInputs(async () => {
    const r = await fetch(`${target}/object_info`, { headers: { origin: target } })
    if (!r.ok) throw new MeterRefusalError('could not resolve engine catalog to validate file references', 502)
    return r.json()
  })

  const splitRef = (raw: string): { subfolder: string, filename: string } => {
    const cleaned = raw.replace(/\\/g, '/')
    const slash = cleaned.lastIndexOf('/')
    return slash >= 0
      ? { subfolder: cleaned.slice(0, slash), filename: cleaned.slice(slash + 1) }
      : { subfolder: '', filename: cleaned }
  }

  let ownedOutputs: Set<string> | null = null
  await validateGraphFileRefs(prompt, {
    uploadFlagged,
    ownsInput: async (name) => {
      const { subfolder, filename } = splitRef(name)
      if (!filename) return false
      return (await uploadOwner(canonicalUploadKey('input', subfolder, filename))) === userId
    },
    ownsOutput: async (annotated) => {
      if (!ownedOutputs) ownedOutputs = await ownedOutputKeys(userId)
      const { name } = annotatedFilepath(annotated)
      const { subfolder, filename } = splitRef(name)
      if (!filename) return false
      return ownedOutputs.has(outputKey({ filename, subfolder, type: 'output' }))
    },
  })
}

/**
 * Review fix (Stage 5 Task 4, Finding 1): ledger.hold THROWS a plain Error
 * for a user with no wallet row ("no wallet for <id> — call ensureUser
 * first") — reachable on the primary hosted action for a new signup before
 * lazy sync lands. Left unwrapped, that throw escapes as an opaque 500
 * instead of the 402 credits-refusal every other insufficient-funds path
 * returns. Mirrors requestMeter.ts's preflightForUser catch exactly —
 * `available: 0` is asserted rather than read back, because getAvailable
 * would throw for the same missing-wallet reason.
 */
export async function holdWithRefusal(
  ledger: { hold(userId: string, credits: number, idempotencyKey: string): Promise<{ ok: true; holdId: number } | { ok: false; reason: 'insufficient' }> },
  userId: string,
  credits: number,
): Promise<{ ok: true; holdId: number } | { ok: false; reason: 'insufficient' }> {
  try {
    return await ledger.hold(userId, credits, `graph:${randomUUID()}`)
  } catch (e) {
    console.error('[graphMeter] HOLD FAILED — refusing as insufficient credits', { userId, credits, error: e })
    throw new MeterRefusalError('insufficient credits', 402, { required: credits, available: 0 })
  }
}

export interface GraphRunDeps {
  priceGraph: typeof priceGraph
  /**
   * Refuse (throw MeterRefusalError 403) a graph that references a file the
   * caller does not own. Runs BETWEEN the shape check and pricing so a refusal
   * never takes a hold — see meterGraphSubmit.
   */
  validateFileRefs(prompt: any): Promise<void>
  hold(userId: string, credits: number): Promise<{ ok: true; holdId: number } | { ok: false; reason: 'insufficient' }>
  getAvailable(userId: string): Promise<number>
  forward(body: any): Promise<{ status: number; body: any }>
  registerRun(r: { promptId: string; userId: string; credits: number; holdId: number | null }): Promise<void>
  startSettle(r: { promptId: string; holdId: number | null; credits: number }): void
  releaseHold(holdId: number): Promise<void>
}

export async function meterGraphSubmit(userId: string | null, body: any, deps: GraphRunDeps): Promise<{ status: number; body: any }> {
  if (!userId) throw new MeterRefusalError('Sign in to run graphs', 401)
  if (!body || typeof body.prompt !== 'object' || body.prompt === null) {
    throw new MeterRefusalError('Missing prompt graph', 400)
  }

  // Ownership of every file the graph references is checked BEFORE pricing or
  // any hold — a graph that reaches for another tenant's input/output is
  // refused (403) at zero cost, and the engine is never touched.
  await deps.validateFileRefs(body.prompt)

  let price
  try {
    price = deps.priceGraph(body.prompt)
  } catch (e) {
    if (e instanceof UnpricedGraphError) throw new MeterRefusalError(e.message, 500)
    throw e
  }

  let holdId: number | null = null
  if (price.credits > 0) {
    const res = await deps.hold(userId, price.credits)
    if (!res.ok) {
      const available = await deps.getAvailable(userId)
      throw new MeterRefusalError('Not enough credits', 402, { required: price.credits, available })
    }
    holdId = res.holdId
  }

  // Finding 2: a thrown forward() (e.g. ECONNREFUSED to a wedged pool worker)
  // must not leave the hold open until the 2h sweep — release it, then
  // propagate the original error so the caller still sees the real failure.
  let fwd: { status: number; body: any }
  try {
    fwd = await deps.forward(body)
  } catch (e) {
    if (holdId !== null) {
      // Minor 4: a release failure here must not mask the original forward
      // error — log it and keep propagating what actually broke.
      await deps.releaseHold(holdId).catch(re => console.error('[graphMeter] release after forward failure failed', { userId, holdId, error: re }))
    }
    throw e
  }

  const promptId: string | undefined = fwd.body?.prompt_id
  if (fwd.status !== 200 || !promptId) {
    if (holdId !== null) {
      // Minor 4: if ledger.release throws here it would replace ComfyUI's
      // real 4xx {error, node_errors} body with an opaque 500 — log instead.
      await deps.releaseHold(holdId).catch(e => console.error('[graphMeter] release on refused/errored forward failed', { userId, holdId, error: e }))
    }
    return fwd // verbatim — clients parse node_errors from this exact shape
  }

  // Finding 3: the money path must not depend on the ownership-row insert.
  // ComfyUI already queued this run — if createGraphRun throws (Neon
  // transient), settlement still has to run or the hold sits open until the
  // 2h sweep while the client also gets a spurious 500 for a run that WILL
  // execute (inviting a double-spend resubmit). Log and keep going.
  try {
    await deps.registerRun({ promptId, userId, credits: price.credits, holdId })
  } catch (e) {
    console.error('[graphMeter] registerRun failed — run will settle but ownership row is missing', { promptId, userId, holdId, error: e })
  }
  deps.startSettle({ promptId, holdId, credits: price.credits })
  return fwd
}

/**
 * settleOnCompletion's default (120 polls @ 1s = 2min) is too short for
 * video-model graph runs, which can run well past 2 minutes. 30 minutes at a
 * 2s cadence covers any real run while staying well under the ledger's 2h
 * hold-sweep TTL, so a slow-but-completing run is never voided out from
 * under itself before it has a chance to settle.
 */
const SETTLE_INTERVAL_MS = 2000
const SETTLE_MAX_POLLS = 900

export async function handleMeteredPrompt(event: H3Event): Promise<any> {
  const userId = event.context.userId ?? null
  const body = await readBody(event)
  const { port } = resolveWorkerTarget(event.path)
  const target = `http://127.0.0.1:${port}`
  const ledger = getLiveLedger()

  const result = await meterGraphSubmit(userId, body, {
    priceGraph,
    // Stage 6 Task 7: refuse a graph that references a file the caller doesn't
    // own, before any hold. userId is non-null here (meterGraphSubmit's 401
    // fires first), but guard anyway so a null can never widen ownership.
    validateFileRefs: prompt => userId ? runGraphFileValidation(prompt, userId, target) : Promise.resolve(),
    hold: (u, credits) => holdWithRefusal(ledger, u, credits),
    getAvailable: u => ledger.getAvailable(u),
    forward: async (b) => {
      // Review I2: ComfyUI honours a client-supplied `prompt_id`. Left in
      // place, an attacker who learns a victim's id can submit their own
      // graph under it — ComfyUI runs it, and this request's settle watcher
      // then UPDATEs graph_runs WHERE prompt_id = <victim's>, replacing the
      // victim's recorded outputs with the attacker's. The engine assigns
      // ids; clients don't get to.
      const { prompt_id: _clientChosenPromptId, ...rest } = (b ?? {}) as Record<string, unknown>
      const safe: Record<string, unknown> = { ...rest, extra_data: stripForeignComfyOrgCreds((b as any)?.extra_data, null) }
      // Stage 6 Task 7: every SaveImage-family node writes under the caller's
      // own u_<hash>/ subfolder — outputs land in output/u_<hash>/... and can
      // never clobber another tenant's tree. Operates on a clone (the original
      // body is left untouched).
      if (userId && safe.prompt && typeof safe.prompt === 'object' && !Array.isArray(safe.prompt)) {
        safe.prompt = injectOutputSubfolder(safe.prompt as Record<string, any>, userId)
      }
      const res = await fetch(`${target}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: target },
        body: JSON.stringify(safe),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    },
    // Review I4: record WHICH engine ran this prompt. Without it the /view
    // race-window harvest always polled :8188, so a run dispatched to a pool
    // worker (?comfyWorker=N) could never be settled from the harvest path.
    registerRun: r => createGraphRun({ ...r, target }),
    startSettle: ({ promptId, holdId, credits }) => {
      void settleOnCompletion({
        promptId,
        intervalMs: SETTLE_INTERVAL_MS,
        maxPolls: SETTLE_MAX_POLLS,
        pollHistory: async (id) => {
          const r = await fetch(`${target}/history/${encodeURIComponent(id)}`)
          if (!r.ok) return null
          const hist = await r.json() as Record<string, any>
          return hist[id] ?? null
        },
        onSuccess: (id) => { void settleGraphSuccess(target, id, holdId, credits) },
        onError: (id) => {
          void (async () => {
            if (holdId !== null) await ledger.release(holdId).catch(e => console.error('[graphMeter] release failed', { id, holdId, e }))
            await resolveGraphRun(id, 'voided').catch(() => {})
          })()
        },
      })
    },
    releaseHold: id => ledger.release(id),
  })

  setResponseStatus(event, result.status)
  return result.body
}

// Exported (Stage 5 Task 5): engineGate.ts's harvestPendingOutputs calls this
// SAME function for the /view race-window fallback, so there is exactly one
// settlement implementation rather than a second copy drifting from this one.
export async function settleGraphSuccess(target: string, promptId: string, holdId: number | null, credits: number): Promise<void> {
  const outputs: string[] = []
  try {
    const r = await fetch(`${target}/history/${encodeURIComponent(promptId)}`)
    if (r.ok) {
      const hist = await r.json() as Record<string, any>
      const nodeOutputs = hist[promptId]?.outputs ?? {}
      for (const node of Object.values(nodeOutputs) as any[]) {
        for (const arr of [node?.images, node?.gifs, node?.videos, node?.audio]) {
          if (!Array.isArray(arr)) continue
          for (const f of arr) if (f?.filename) outputs.push(outputKey(f))
        }
      }
    }
  } catch (e) { console.error('[graphMeter] output harvest failed', { promptId, e }) }

  if (holdId !== null) {
    try {
      const s = await getLiveLedger().settle(holdId, credits, `graph:${promptId}`)
      if (!s.settled) console.error('[graphMeter] SETTLE ON RELEASED HOLD — run shipped uncharged', { promptId, holdId, credits })
    } catch (e) {
      console.error('[graphMeter] SETTLE FAILED after successful run', { promptId, holdId, credits, e })
    }
  }
  await resolveGraphRun(promptId, 'settled', outputs).catch(e => console.error('[graphMeter] resolve failed', { promptId, e }))
}
