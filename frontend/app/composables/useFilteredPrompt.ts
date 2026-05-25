import type { LiteGraphWorkflow, LiteGraphNode } from '~/composables/useVueNodes'

/**
 * Build a snapshot of `workflow` that runs only the work needed to produce
 * outputs from `targetNodeIds`. Forgiving semantics: any nodes the targets
 * depend on (transitively) stay active too — so users can right-click a
 * single output node and get a working subgraph automatically.
 *
 * Strategy: don't prune the JSON. Instead, set mode=2 (mute) on every node
 * that ISN'T in `keep`. LiteGraph already honors mode-2 at queue time, so
 * the bridge submits the full structure but ComfyUI's executor skips the
 * muted nodes. This avoids re-implementing dead-link rewiring.
 */

const NODE_MODE_MUTE = 2

/** Build the set of nodes to keep (targets + all transitive upstream deps). */
export function collectKeepSet(
  workflow: LiteGraphWorkflow,
  targetNodeIds: number[],
): Set<number> {
  // Index links by their consumer (target_id) so we can walk upstream cheaply.
  // Link tuple shape: [linkId, originId, originSlot, targetId, targetSlot, type]
  const upstreamByNode = new Map<number, number[]>()
  for (const link of workflow.links || []) {
    if (!Array.isArray(link) || link.length < 4) continue
    const originId = Number(link[1])
    const targetId = Number(link[3])
    if (!Number.isFinite(originId) || !Number.isFinite(targetId)) continue
    const list = upstreamByNode.get(targetId)
    if (list) list.push(originId)
    else upstreamByNode.set(targetId, [originId])
  }

  const keep = new Set<number>()
  const queue: number[] = []
  for (const id of targetNodeIds) {
    if (!keep.has(id)) {
      keep.add(id)
      queue.push(id)
    }
  }
  while (queue.length) {
    const id = queue.shift()!
    const ups = upstreamByNode.get(id)
    if (!ups) continue
    for (const u of ups) {
      if (keep.has(u)) continue
      keep.add(u)
      queue.push(u)
    }
  }
  return keep
}

/**
 * Returns a deep-cloned workflow where any node not in `targetNodeIds` (and
 * not an upstream dep of one) is muted (mode=2). Pre-existing mode=4 (bypass)
 * is preserved within the keep set so a user's explicit bypass still applies.
 */
export function buildFilteredWorkflow(
  workflow: LiteGraphWorkflow,
  targetNodeIds: (string | number)[],
): LiteGraphWorkflow {
  const targetIds = targetNodeIds.map(Number).filter(Number.isFinite)
  const keep = collectKeepSet(workflow, targetIds)

  const cloned: LiteGraphWorkflow = JSON.parse(JSON.stringify(workflow))
  for (const node of cloned.nodes as LiteGraphNode[]) {
    if (!keep.has(node.id)) {
      // Don't overwrite mode=4 (bypass) into mute — bypass needs to remain
      // bypass so its pass-through semantics still apply; but for a node
      // explicitly OUTSIDE the keep set, mute is what we want regardless.
      node.mode = NODE_MODE_MUTE
    }
  }
  return cloned
}

/**
 * Convenience for "Run Selection" semantics — treats every selected node as
 * a target. Identical to `buildFilteredWorkflow` but here as a named entry
 * point so call sites read clearly.
 */
export function buildSelectionWorkflow(
  workflow: LiteGraphWorkflow,
  selectedNodeIds: (string | number)[],
): LiteGraphWorkflow {
  return buildFilteredWorkflow(workflow, selectedNodeIds)
}
