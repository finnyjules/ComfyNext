/**
 * Stage 5 review C1 — canonical engine-path normalization.
 *
 * ComfyUI's server.py registers every route TWICE: once at `path` and once at
 * `"/api" + path`. Sailor's proxy adds a third form by stripping a leading
 * `/comfyui` (the API base SettingsModal talks to). So one engine endpoint has
 * up to four spellings reaching this Nitro server:
 *
 *   /queue   /api/queue   /comfyui/queue   /comfyui/api/queue
 *
 * Every hosted tenant gate must decide on ONE of them or the other three are
 * free bypasses. `normalizeEnginePath` collapses the aliases to the canonical
 * engine path.
 *
 * The `/api` strip is deliberately conditional: `/api/*` is ALSO Sailor's own
 * Nitro namespace (`/api/wallet`, `/api/billing/*`, …). Stripping it blindly
 * would make `/api/view` and `/api/viewport` collide. So `/api` is only
 * removed when the remainder matches a known engine route — anything else is
 * returned untouched and continues to Nitro exactly as before.
 *
 * Pure and side-effect free: no env reads, no h3. Local mode calls it too, but
 * every local decision ignores the result (see comfyui-proxy.ts).
 */

/** Engine routes the `/api` mirror actually serves. Order irrelevant. */
export const ENGINE_ROUTE_PREFIXES = [
  '/prompt',
  '/queue',
  '/interrupt',
  '/history',
  '/view',
  '/upload',
  '/object_info',
  '/system_stats',
  '/internal',
  '/ws',
  '/extensions',
  '/global_subgraphs',
]

function splitQuery(path: string): [string, string] {
  const i = path.indexOf('?')
  return i === -1 ? [path, ''] : [path.slice(0, i), path.slice(i)]
}

/**
 * Round-2 review F6 — fold dot segments before anything else looks at the
 * path.
 *
 * Every gate below is a PREFIX match, so `/extensions/../history` would sail
 * past the `/history` refusal on its way to a proxy that hands aiohttp a path
 * aiohttp then folds back to `/history`. Nitro does normalize upstream today,
 * but that is an undocumented invariant of someone else's router, not a
 * property of this function — and it is one dependency bump away from
 * changing. Canonicalizing here makes the guarantee local.
 *
 * The WHATWG parser folds `.`, `..` and their percent-encoded spellings
 * (`%2e`, `%2E`). It does NOT fold an encoded separator (`..%2f`) — correctly,
 * since that is a literal one-segment name to aiohttp too.
 *
 * The ORIGINAL query string is reattached verbatim: `URL.search` re-encodes
 * (`a b.png` becomes `a%20b.png`) and callers forward the raw path, not this
 * one, so the two must not drift.
 */
function canonicalizePath(pathNoQuery: string): string {
  try {
    return new URL(pathNoQuery, 'http://x').pathname
  }
  catch {
    return pathNoQuery
  }
}

/** Boundary-aware prefix match on a query-stripped path. */
export function isEngineRoute(pathNoQuery: string): boolean {
  return ENGINE_ROUTE_PREFIXES.some(p => pathNoQuery === p || pathNoQuery.startsWith(p + '/'))
}

/**
 * Collapse `/comfyui` and `/api` engine-mirror aliases to the canonical engine
 * path. Query strings are preserved verbatim. Non-engine paths (including all
 * of Nitro's own `/api/*` routes) come back unchanged.
 */
export function normalizeEnginePath(path: string): string {
  const [raw, query] = splitQuery(path)
  // F6: fold `.`/`..`/`%2e` FIRST — every check below is a prefix match and
  // would otherwise be walked around by a dot segment.
  let p = canonicalizePath(raw)

  // One leading /comfyui — matches the proxy's own backendPath rewrite.
  if (p === '/comfyui' || p.startsWith('/comfyui/')) {
    p = p.slice('/comfyui'.length) || '/'
  }

  // One leading /api, ONLY when what remains is an engine mirror route.
  if (p.startsWith('/api/') || p === '/api') {
    const rest = p.slice('/api'.length) || '/'
    if (isEngineRoute(rest)) p = rest
  }

  return p + query
}

export type EngineDecision =
  | { kind: 'meterPrompt' }
  | { kind: 'queueGet' }
  | { kind: 'interrupt' }
  | { kind: 'objectInfo' }
  | { kind: 'upload' }
  | { kind: 'proxy' }
  | { kind: 'forbid', message: string }

/**
 * Engine paths a hosted tenant may reach RAW, with no per-user filtering.
 *
 * ROUND-2 LESSON — an entry here is a claim about what the HANDLER does, not
 * about what the path looks like. Being static-sounding is not evidence.
 * Adding a prefix to this list REQUIRES reading the upstream handler in
 * ComfyUI's server.py and answering: what does it read, what does it write,
 * and whose data is in scope? Round 2 found two entries that failed that
 * audit despite looking inert:
 *
 *   F1 `/gate`        — POST /gate/resume rebuilds a STORED graph from a
 *                       client-supplied prompt_id and re-queues it under a
 *                       fresh uuid: unmetered arbitrary re-execution, and it
 *                       pops another tenant's paused-gate context on the way.
 *   F2 `/object_info` — the LoadImage-family combos embed a listing of the
 *                       shared input directory, i.e. every tenant's uploaded
 *                       filenames. The canvas genuinely needs this endpoint,
 *                       so it is scrubbed rather than refused.
 *
 * Both now have explicit branches below and are deliberately NOT in this list.
 *
 * `/ws` is deliberately here: WebSocket gating is Task 7's job and this is a
 * plain HTTP middleware; refusing it would break the canvas without closing
 * anything (the upgrade is dispatched in nuxt.config, not here).
 */
const HOSTED_RAW_ALLOW = [
  '/system_stats',
  '/extensions',
  '/global_subgraphs',
  '/sailor',
  '/ws',
]

function match(pathNoQuery: string, prefix: string): boolean {
  return pathNoQuery === prefix || pathNoQuery.startsWith(prefix + '/')
}

/**
 * The single hosted routing decision, taken on the NORMALIZED engine path so
 * `/queue`, `/api/queue`, `/comfyui/queue` and `/comfyui/api/queue` all land
 * on the same branch.
 *
 * Canonical `/history` and `/view` never arrive here — comfyui-proxy returns
 * them to their tenant-scoped Nitro routes before consulting this. Anything
 * that DOES arrive spelled `/history` or `/view` is therefore an alias of the
 * ungated engine mirror, and is refused rather than silently re-routed.
 */
export function hostedEngineDecision(enginePath: string, method: string): EngineDecision {
  const [p] = splitQuery(enginePath)
  const verb = (method || 'GET').toUpperCase()

  if (match(p, '/prompt')) {
    if (verb === 'POST') return { kind: 'meterPrompt' }
    // F8: this used to carry the /queue message verbatim. GET /prompt returns
    // the engine's global exec info, and DELETE /prompt is an alias for the
    // queue wipe — both are refused, but say which endpoint refused.
    return { kind: 'forbid', message: 'Only POST /prompt is available in hosted mode' }
  }
  if (match(p, '/queue')) {
    if (verb === 'GET') return { kind: 'queueGet' }
    // ComfyUI's clear/delete — one user must never be able to wipe another's
    // pending queue. No per-user queue management endpoint exists yet, so
    // this is a hard refusal rather than a partial implementation.
    return { kind: 'forbid', message: 'Queue management is per-user in hosted mode' }
  }
  if (match(p, '/interrupt')) {
    if (verb === 'POST') return { kind: 'interrupt' }
    return { kind: 'forbid', message: 'Interrupt is per-user in hosted mode' }
  }
  if (match(p, '/history')) return { kind: 'forbid', message: 'Use /history — the engine mirror is not tenant-scoped' }
  if (match(p, '/view')) return { kind: 'forbid', message: 'Use /view — the engine mirror is not tenant-scoped' }
  // ComfyUI's /internal/files/* lists the output directory: a filename
  // enumeration oracle that hands an attacker exactly the keys /view checks.
  if (match(p, '/internal')) return { kind: 'forbid', message: 'Engine internals are not exposed in hosted mode' }

  // F1: POST /gate/resume takes a client-supplied prompt_id, deep-copies the
  // STORED prompt + extra_data for it, and re-queues the graph under a fresh
  // uuid — no credit hold, no price, no graph_runs row, and it pops the
  // paused-gate context out from under whichever tenant owns that prompt_id.
  // Metering gate-resume is a future task; until a hold is taken and
  // ownership is checked, the whole prefix fails closed.
  if (match(p, '/gate')) return { kind: 'forbid', message: 'Gate resume is not available in hosted mode' }

  // F2: needed by the canvas (graphToPrompt reads the node schemas) but the
  // upload-widget combos embed the shared input directory listing, so the
  // response is scrubbed on the way out instead of proxied raw.
  if (match(p, '/object_info')) {
    if (verb === 'GET') return { kind: 'objectInfo' }
    return { kind: 'forbid', message: 'Only GET /object_info is available in hosted mode' }
  }

  // F4: the upload sink itself stays open, but ComfyUI's image_upload() honours
  // an `overwrite` form field, and the input directory is shared across
  // tenants this stage — so `overwrite=true` with a guessed name is a
  // cross-tenant clobber. Gated in engineGate, not proxied raw.
  if (match(p, '/upload')) {
    if (verb === 'POST') return { kind: 'upload' }
    return { kind: 'forbid', message: 'Only POST /upload is available in hosted mode' }
  }

  if (HOSTED_RAW_ALLOW.some(a => match(p, a))) return { kind: 'proxy' }
  return { kind: 'forbid', message: 'This engine endpoint is not available in hosted mode' }
}
