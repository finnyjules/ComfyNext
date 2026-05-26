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

/**
 * Variant fan-out: when N `Image` sinks share one upstream IMAGE output,
 * mutate the workflow JSON so the upstream produces a batch of N and each
 * sink slices a different index. The Vue Flow display stays unchanged —
 * users see N wires from one source, the backend gets a batch + N indices.
 *
 * The mutation is in-place on the passed workflow (callers typically deep-
 * clone first via buildFilteredWorkflow / JSON.parse(JSON.stringify(...))).
 *
 * `objectInfo` is the schema map from `/api/object_info`, used to find the
 * positional index of `batch_size` / `batch_index` widgets per node type.
 */
export function applyVariantFanOut(
  workflow: LiteGraphWorkflow,
  objectInfo: Record<string, any>,
): LiteGraphWorkflow {
  // Pre-index nodes by id for O(1) lookup.
  const nodeById = new Map<number, LiteGraphNode>()
  for (const n of workflow.nodes || []) nodeById.set(n.id, n)

  // Group links by (originId, originSlot) — that's a single output handle.
  const linksByOrigin = new Map<string, any[]>()
  for (const link of workflow.links || []) {
    if (!Array.isArray(link) || link.length < 6) continue
    const key = `${link[1]}-${link[2]}`
    const list = linksByOrigin.get(key)
    if (list) list.push(link)
    else linksByOrigin.set(key, [link])
  }

  for (const [, links] of linksByOrigin) {
    if (links.length < 2) continue
    const dataType = String(links[0][5] || '').toUpperCase()
    if (dataType !== 'IMAGE') continue  // only IMAGE fan-out for v1

    // Origin must be a non-Image node (an actual generator/op).
    const originId = Number(links[0][1])
    const origin = nodeById.get(originId)
    if (!origin || origin.type === 'Image') continue

    // Sort sinks by target id for deterministic index assignment. Without
    // this, the same wires could swap indices between runs.
    const imageSinks = links
      .map((l) => ({ link: l, target: nodeById.get(Number(l[3])) }))
      .filter((t) => t.target?.type === 'Image')
      .sort((a, b) => Number(a.target!.id) - Number(b.target!.id))
    if (imageSinks.length < 2) continue

    const N = imageSinks.length

    // Bump the upstream batch_size if it has one. Many generators expose this
    // (SDXL/Flux samplers, EmptyLatentImage, Replicate Generate, …); the rest
    // get a single shared image — fan-out degrades gracefully rather than
    // erroring. Re-run fan-out (re-execute N times with different seeds) is
    // the universal fallback and lives in a follow-up.
    setNamedWidget(origin, 'batch_size', N, objectInfo)

    // Distribute indices: sink 0 → batch[0], sink 1 → batch[1], …
    for (let i = 0; i < imageSinks.length; i++) {
      setNamedWidget(imageSinks[i].target!, 'batch_index', i, objectInfo)
    }
  }

  return workflow
}

/**
 * Set a positional widget value on a LiteGraph node by widget name. Uses
 * objectInfo to find the index of the named widget in the node type's
 * declared input order. No-op if the node type doesn't have that widget.
 */
function setNamedWidget(
  node: LiteGraphNode,
  widgetName: string,
  value: any,
  objectInfo: Record<string, any>,
): void {
  const info = objectInfo[node.type]
  if (!info) return
  // Widget order: required first, then optional. Skip non-widget types
  // (anything that becomes a port: IMAGE, MASK, LATENT, etc.).
  const widgetNames: string[] = []
  const collect = (group: Record<string, any> | undefined) => {
    if (!group) return
    for (const [name, spec] of Object.entries(group)) {
      const specArr = Array.isArray(spec) ? spec : [spec]
      const type = specArr[0]
      const cfg = specArr[1] || {}
      if (Array.isArray(type)) {
        widgetNames.push(name)  // combo types are widgets
        continue
      }
      if (cfg.forceInput) continue  // forced-port widgets aren't in widgets_values
      if (['INT', 'FLOAT', 'STRING', 'BOOLEAN'].includes(String(type))) {
        widgetNames.push(name)
      }
    }
  }
  collect(info?.input?.required)
  collect(info?.input?.optional)

  const idx = widgetNames.indexOf(widgetName)
  if (idx < 0) return  // node type doesn't have this widget — silent no-op

  // Ensure widgets_values is an array of the right length.
  if (!Array.isArray(node.widgets_values)) node.widgets_values = []
  while (node.widgets_values.length <= idx) node.widgets_values.push(null)
  node.widgets_values[idx] = value
}
