// Removes frontend-only nodes (studios with no ComfyUI /object_info entry —
// see FRONTEND_ONLY_NODE_TYPES in lib/agent/capabilities.ts) from a workflow
// before it crosses into the bridge iframe for execution.
//
// The bridge iframe's own graphToPrompt serializes EVERY node in the loaded
// workflow. A frontend-only node has no backend class_type, so ComfyUI's
// validation aborts the WHOLE run with "Node 'X' has no class_type" the
// instant one is present — even though nothing else in the graph depends on
// it. Filtered runs (Run Group/Selection/per-node) are unaffected because
// buildFilteredWorkflow only ever keeps an explicit target + upstream-deps
// set; it's specifically the global Run's full-workflow load that leaks
// these nodes through.
//
// Pure function — does not mutate its input; returns a new object with a new
// `nodes` array and a new `links` array. Callers should be operating on an
// already-cloned run-only copy of the workflow (never the object a save path
// might still reference).

export interface StripFrontendOnlyResult<T> {
  workflow: T
  /** node.type values that were removed (for logging), in workflow order. */
  removedTypes: string[]
}

/**
 * Strip nodes whose `type` is in `frontendOnlyTypes` from `workflow.nodes`,
 * and drop any `workflow.links` tuple whose origin or target node was
 * removed. Link tuples are `[linkId, originId, originSlot, targetId,
 * targetSlot, type]` (LiteGraph's on-the-wire shape).
 *
 * This runs BEFORE `healDanglingLinks` in the run pipeline. healDanglingLinks
 * only nulls a surviving node's dangling `inputs[].link` (and prunes its own
 * `outputs[].links`) — it never touches the top-level `links[]` table itself,
 * so a stale tuple pointing at a now-removed node would otherwise linger
 * there. Filtering `links` here keeps the table consistent with `nodes` the
 * same way `buildFilteredWorkflow` does for its keep-set stripping.
 */
export function stripFrontendOnlyNodes<T extends { nodes?: any[]; links?: any[] }>(
  workflow: T,
  frontendOnlyTypes: Set<string>,
): StripFrontendOnlyResult<T> {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const removed = nodes.filter(n => frontendOnlyTypes.has(String(n?.type)))
  if (!removed.length) return { workflow, removedTypes: [] }

  const removedIds = new Set(removed.map(n => Number(n.id)))
  const keptNodes = nodes.filter(n => !removedIds.has(Number(n.id)))

  const links = Array.isArray(workflow.links) ? workflow.links : []
  const keptLinks = links.filter((link: any) => {
    if (!Array.isArray(link) || link.length < 4) return true
    const originId = Number(link[1])
    const targetId = Number(link[3])
    return !removedIds.has(originId) && !removedIds.has(targetId)
  })

  return {
    workflow: { ...workflow, nodes: keptNodes, links: keptLinks },
    removedTypes: removed.map(n => String(n.type)),
  }
}
