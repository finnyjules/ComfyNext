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
  let p = raw

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
  | { kind: 'proxy' }
  | { kind: 'forbid', message: string }

/**
 * Engine paths a hosted tenant may reach RAW, with no per-user filtering:
 * static/global reads plus the upload sink. Everything else is either gated
 * above or refused — deny by default, so a new ComfyUI route can never
 * appear as an ungated cross-tenant surface just by existing.
 *
 * `/ws` is deliberately here: WebSocket gating is Task 7's job and this is a
 * plain HTTP middleware; refusing it would break the canvas without closing
 * anything (the upgrade is dispatched in nuxt.config, not here).
 */
const HOSTED_RAW_ALLOW = [
  '/object_info',
  '/system_stats',
  '/upload',
  '/extensions',
  '/global_subgraphs',
  '/sailor',
  '/gate',
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
    return { kind: 'forbid', message: 'Engine queue state is per-user in hosted mode' }
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

  if (HOSTED_RAW_ALLOW.some(a => match(p, a))) return { kind: 'proxy' }
  return { kind: 'forbid', message: 'This engine endpoint is not available in hosted mode' }
}
