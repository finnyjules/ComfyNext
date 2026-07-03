/**
 * Studio render cascade — re-bake a studio node and propagate the result down the
 * chain (studio → output image node → next studio → …), entirely client-side, then
 * hand off any real backend tail to the existing filtered-run plumbing.
 *
 * Studios are frontend-only renderers: each node registers a `bakeOutput()` that
 * produces a full-res image blob from its saved config + freshly-resolved input. The
 * runner walks downstream, bakes each studio in order, uploads, and updates the
 * intermediate artifact node so the next studio reads the new image as its input.
 *
 * `planStudioCascade` / `planStudioUpstream` are PURE (no registry, no DOM) so the
 * traversal is unit-testable; the runner injects its side-effects via `CascadeDeps`.
 */

export type StudioBaker = () => Promise<Blob | null>

const _bakers = new Map<string, StudioBaker>()
export function registerStudioBaker(id: string, fn: StudioBaker): void { _bakers.set(id, fn) }
export function unregisterStudioBaker(id: string): void { _bakers.delete(id) }
export function getStudioBaker(id: string): StudioBaker | undefined { return _bakers.get(id) }
export function hasStudioBaker(id: string): boolean { return _bakers.has(id) }

/** Bakes one frame with a set of param overrides applied (e.g. one row of a
 * collection sweep/generate run) — distinct from `StudioBaker`, which bakes the
 * studio's currently-live config. Implementations apply overrides, render once,
 * capture the blob, then restore the prior values (snapshot/restore in try/finally). */
export type StudioParamBaker = (overrides: Record<string, string | number>) => Promise<Blob | null>

const _paramBakers = new Map<string, StudioParamBaker>()
export function registerStudioParamBaker(id: string, fn: StudioParamBaker): void { _paramBakers.set(id, fn) }
export function unregisterStudioParamBaker(id: string): void { _paramBakers.delete(id) }
export function getStudioParamBaker(id: string): StudioParamBaker | undefined { return _paramBakers.get(id) }

export interface WalkNode { id: string; type?: string; data?: { nodeType?: string } | null }
export interface WalkEdge { source: string | number; target: string | number; sourceHandle?: string | null; targetHandle?: string | null }

export const STUDIO_VF_TYPES = new Set(['space-type', 'gradient-studio', 'shader-studio', 'texture-studio', 'shot-director'])
export const STUDIO_NODE_TYPES = new Set(['SpaceType', 'GradientStudio', 'ShaderStudio', 'TextureStudio', 'ShotDirector'])

/** A client-bakeable node in the cascade — a studio OR the Frame (Compositor), which
 *  also bakes its composite client-side. Identified by vue-flow type or data.nodeType
 *  (NOT by a registered baker, so off-screen/unmounted nodes are still seen in the plan). */
export function isStudioNode(n: WalkNode | undefined | null): boolean {
  if (!n) return false
  if (n.type && (STUDIO_VF_TYPES.has(n.type) || n.type === 'artifact-frame')) return true
  return STUDIO_NODE_TYPES.has(n.data?.nodeType ?? '')
}

/** An artifact node holds a studio's output (image/video) and passes it to the next
 *  consumer — a transparent link in the chain, never a backend tail on its own. */
export function isArtifactNode(n: WalkNode | undefined | null): boolean {
  return !!n && typeof n.type === 'string' && n.type.startsWith('artifact-')
}

function downstreamIndex(edges: WalkEdge[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const e of edges) {
    const s = String(e.source), t = String(e.target)
    const arr = out.get(s); if (arr) arr.push(t); else out.set(s, [t])
  }
  return out
}

export interface ChainPlan {
  /** Studios to re-bake, upstream-first, starting with the pressed node. */
  studioOrder: string[]
  /** True when a real (non-studio, non-artifact) node sits downstream → run the backend after. */
  hasBackendTail: boolean
}

/**
 * Plan a downstream cascade from `startId`: every studio reachable by following edges
 * forward (through the artifact nodes that link them), in breadth-first discovery
 * order — which is chain order for the linear pipelines studios form in practice.
 */
export function planStudioCascade(startId: string, nodes: WalkNode[], edges: WalkEdge[]): ChainPlan {
  const byId = new Map(nodes.map(n => [String(n.id), n]))
  const down = downstreamIndex(edges)
  const seen = new Set<string>([startId])
  const studioOrder: string[] = []
  if (isStudioNode(byId.get(startId))) studioOrder.push(startId)
  const q = [startId]
  while (q.length) {
    const id = q.shift()!
    for (const t of down.get(id) ?? []) {
      if (seen.has(t)) continue
      seen.add(t); q.push(t)
      if (isStudioNode(byId.get(t))) studioOrder.push(t)
    }
  }
  let hasBackendTail = false
  for (const id of seen) {
    if (id === startId) continue
    const n = byId.get(id)
    if (n && !isStudioNode(n) && !isArtifactNode(n)) { hasBackendTail = true; break }
  }
  return { studioOrder, hasBackendTail }
}

/** Upstream studios feeding `startId` (so "rebuild from start → here" re-bakes them
 *  first), upstream-first, ending with `startId`. */
export function planStudioUpstream(startId: string, nodes: WalkNode[], edges: WalkEdge[]): string[] {
  const byId = new Map(nodes.map(n => [String(n.id), n]))
  const up = new Map<string, string[]>()
  for (const e of edges) {
    const s = String(e.source), t = String(e.target)
    const arr = up.get(t); if (arr) arr.push(s); else up.set(t, [s])
  }
  const seen = new Set<string>([startId])
  const studios: string[] = []
  const q = [startId]
  while (q.length) {
    const id = q.shift()!
    for (const s of up.get(id) ?? []) {
      if (seen.has(s)) continue
      seen.add(s); q.push(s)
      if (isStudioNode(byId.get(s))) studios.push(s)
    }
  }
  studios.reverse()                          // upstream-most first
  if (isStudioNode(byId.get(startId))) studios.push(startId)
  return studios
}

export interface CascadeDeps {
  getNodes: () => WalkNode[]
  getEdges: () => WalkEdge[]
  /** Upload one blob, return its stored filename (or null on failure). */
  upload: (blob: Blob, prefix: string) => Promise<string | null>
  /** Create-or-update the studio's downstream artifact node with the new file. */
  publish: (studioId: string, filename: string) => void | Promise<void>
  /** Fire the existing downstream filtered backend run from `startId`. */
  runBackendDownstream: (startId: string) => void
  /** Toggle a node's busy/spinner state. */
  setBusy?: (nodeId: string, busy: boolean) => void
}

export type CascadeScope = 'self' | 'upstream' | 'downstream'

/** Run the cascade. Bakes are sequential so each studio reads the prior one's fresh
 *  output; studios without a registered baker (e.g. unmounted) are skipped + logged. */
export async function runStudioCascade(startId: string, scope: CascadeScope, deps: CascadeDeps): Promise<void> {
  const nodes = deps.getNodes(), edges = deps.getEdges()
  const plan = planStudioCascade(startId, nodes, edges)
  const order =
    scope === 'self' ? [startId]
    : scope === 'upstream' ? planStudioUpstream(startId, nodes, edges)
    : plan.studioOrder

  for (const id of order) {
    const baker = getStudioBaker(id)
    if (!baker) { console.warn('[studio-cascade] no baker registered for', id, '— skipped (unmounted?)'); continue }
    deps.setBusy?.(id, true)
    try {
      const blob = await baker()
      if (blob) {
        const filename = await deps.upload(blob, 'studio_img')
        if (filename) await deps.publish(id, filename)
      }
    } catch (e) {
      console.error('[studio-cascade] bake failed for', id, e)
    } finally {
      deps.setBusy?.(id, false)
    }
  }

  if (scope === 'downstream' && plan.hasBackendTail) deps.runBackendDownstream(startId)
}
