import type { LiteGraphWorkflow, LiteGraphNode } from '~/composables/useVueNodes'

/**
 * Build a snapshot of `workflow` that runs only the work needed to produce
 * outputs from `targetNodeIds`. Forgiving semantics: any nodes the targets
 * depend on (transitively) stay active too — so users can right-click a
 * single output node and get a working subgraph automatically.
 *
 * Strategy: strip nodes outside the keep set entirely (along with any links
 * touching them). Earlier versions set `node.mode = 2` (mute) instead, which
 * worked at queue time but persisted into the bridge's LiteGraph state — so
 * a per-node Run on the middle sink of a fan-out would leave the other two
 * sinks visibly muted on the live canvas afterwards. Stripping avoids that:
 * the bridge sees only the active subgraph, never the mute flag.
 *
 * The keep set is built by walking upstream from targets only, so anything
 * we strip is guaranteed not to be referenced by anything we kept. Links
 * touching stripped nodes are removed too.
 */

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
 * Returns a deep-cloned workflow with nodes outside the keep set removed
 * entirely, along with any links that touch them. Pre-existing mode=4
 * (bypass) on kept nodes is preserved so a user's explicit bypass still
 * applies inside the run.
 */
export function buildFilteredWorkflow(
  workflow: LiteGraphWorkflow,
  targetNodeIds: (string | number)[],
): LiteGraphWorkflow {
  const targetIds = targetNodeIds.map(Number).filter(Number.isFinite)
  const keep = collectKeepSet(workflow, targetIds)

  const cloned: LiteGraphWorkflow = JSON.parse(JSON.stringify(workflow))
  cloned.nodes = ((cloned.nodes as LiteGraphNode[]) || []).filter(
    (n) => keep.has(n.id),
  )
  // Drop links that reference a stripped node on either end. Tuple shape:
  // [linkId, originId, originSlot, targetId, targetSlot, type]
  if (Array.isArray(cloned.links)) {
    cloned.links = cloned.links.filter((link: any) => {
      if (!Array.isArray(link) || link.length < 4) return false
      const originId = Number(link[1])
      const targetId = Number(link[3])
      return keep.has(originId) && keep.has(targetId)
    })
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
 * Realign every node's `widgets_values` array to the current schema's widget
 * count. Without this, a node persisted from a workflow saved against an
 * older schema (one widget added or removed since) ships a wrong-length
 * array — values land in the wrong widget slots and Comfy rejects the
 * prompt with errors like "Value not in list: resolution: 'False'" (the
 * boolean from camera_fixed showing up where the resolution combo expects
 * an option string).
 *
 * For each node, we walk the current schema's widget order and rebuild the
 * array. Existing positional values that still line up are preserved;
 * missing slots get the schema's default; extras are dropped.
 *
 * Length-matching arrays still get a combo-validity sweep: a slot that holds
 * a value outside its combo's option list (e.g. a Compositor `layerN_blend`
 * carrying the integer 0 after a mid-array schema drift) is reset to the
 * combo default. Otherwise Comfy prunes just that node with
 * "value_not_in_list" — the rest of the prompt succeeds, so the run reports
 * success while the pruned node silently produces no output.
 */
export function realignWidgetValues(
  workflow: LiteGraphWorkflow,
  objectInfo: Record<string, any>,
): LiteGraphWorkflow {
  if (!workflow?.nodes?.length) return workflow
  let mutated = false
  const cloned: LiteGraphWorkflow = JSON.parse(JSON.stringify(workflow))

  for (const node of cloned.nodes as LiteGraphNode[]) {
    const info = objectInfo[node.type as string]
    if (!info) continue
    // Build expected widget order from the schema: required first, then
    // optional. Skip port-type inputs and forceInput widgets — those don't
    // occupy a slot in widgets_values.
    const expected: { name: string; defaultValue: any; options?: any[]; control?: boolean }[] = []
    const collect = (group: Record<string, any> | undefined) => {
      if (!group) return
      for (const [name, spec] of Object.entries(group)) {
        const specArr = Array.isArray(spec) ? spec : [spec]
        const type = specArr[0]
        const cfg = specArr[1] || {}
        // COMBO widget. Two on-the-wire shapes: legacy ComfyUI puts the option
        // list directly as spec[0] (an array); v3 IO nodes (e.g. Compositor's
        // layerN_blend) emit the string "COMBO" with options in cfg.options.
        // Missing either shape drops the widget from the expected order and
        // shifts every value after it — the bug that scrambled the Compositor.
        if (Array.isArray(type) || type === 'COMBO') {
          const options = Array.isArray(type)
            ? type
            : (Array.isArray(cfg.options) ? cfg.options : null)
          expected.push({ name, defaultValue: cfg.default ?? options?.[0] ?? null, options: options ?? undefined })
          continue
        }
        if (cfg.forceInput) continue
        if (['INT', 'FLOAT', 'STRING', 'BOOLEAN'].includes(String(type))) {
          expected.push({ name, defaultValue: cfg.default ?? null })
          // Seed-type INT inputs carry a sibling control_after_generate slot
          // in LiteGraph's widgets_values — preserve it so our positional
          // mapping matches Comfy's bundled frontend.
          if (type === 'INT' && cfg.control_after_generate) {
            expected.push({ name: `${name}_control`, defaultValue: 'randomize', control: true })
          }
        }
      }
    }
    collect(info?.input?.required)
    collect(info?.input?.optional)

    const current = Array.isArray(node.widgets_values) ? node.widgets_values : []

    // Rebuild only when the length drifted; otherwise keep positions as-is.
    let realigned = current
    let changed = false
    if (current.length !== expected.length) {
      realigned = expected.map((e, i) =>
        i < current.length ? current[i] : e.defaultValue,
      )
      changed = true
    }

    // Combo-validity sweep (runs even for length-matched arrays). A combo slot
    // holding a value outside its option list is a strong signal the positional
    // array is misaligned — e.g. a Float/Int landing in a blend combo after a
    // mid-array schema drift. Left alone, Comfy prunes just that node with
    // "value_not_in_list", so the run reports success while the node silently
    // produces nothing.
    const comboInvalid = expected.some(
      (e, i) => e?.options && !e.options.includes(realigned[i]),
    )
    if (comboInvalid) {
      if (node.type === 'Compositor') {
        // The Compositor's 114-slot array can't be un-scrambled in place, so
        // rebuild it from schema defaults. injectCompositorOverlays re-applies
        // z from the saved stack order and bakes local layers, and width=0
        // falls back to layer 1's native size — so a clean default array
        // composites correctly. Custom per-layer transforms on an already-
        // corrupt frame are unrecoverable and reset to identity.
        realigned = expected.map((e) => e.defaultValue)
      } else {
        // Other node types: coerce only the offending combo slots so the rest
        // of the (presumed-aligned) array is preserved.
        realigned = realigned.map((v: any, i: number) => {
          const e = expected[i]
          return e?.options && !e.options.includes(v) ? e.defaultValue : v
        })
      }
      changed = true
    }

    if (changed) {
      node.widgets_values = realigned
      mutated = true
    }
  }

  return mutated ? cloned : workflow
}

/**
 * Strip incoming links for artifact nodes the user has "locked." A locked
 * artifact carries a frozen copy of its current preview in its file widget,
 * so it loads from disk instead of executing the upstream chain. Removing
 * its incoming links here means `collectKeepSet` stops walking upstream at
 * the locked node — the upstream generators (and any paid API calls they
 * make) get stripped from the run.
 *
 * `liveNodes` is the Vue Flow `nodes.value` array. We read the lock flag
 * from `node.data.properties.locked` there so the workflow JSON (which
 * comes from convertToLiteGraph) doesn't need its own copy of the flag —
 * `properties` round-trips through LiteGraph naturally.
 */
export function applyArtifactLocks(
  workflow: LiteGraphWorkflow,
  liveNodes: any[],
): LiteGraphWorkflow {
  const lockedIds = new Set<number>()
  for (const n of liveNodes || []) {
    if (n?.data?.properties?.locked) {
      const id = Number(n.id)
      if (Number.isFinite(id)) lockedIds.add(id)
    }
  }
  if (!lockedIds.size) return workflow
  const cloned: LiteGraphWorkflow = JSON.parse(JSON.stringify(workflow))
  if (Array.isArray(cloned.links)) {
    cloned.links = cloned.links.filter((link: any) => {
      if (!Array.isArray(link) || link.length < 4) return true
      const targetId = Number(link[3])
      return !lockedIds.has(targetId)
    })
  }
  return cloned
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
export function setNamedWidget(
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
      // Combo widgets: legacy array-of-options OR v3 "COMBO" string. Both
      // occupy a widgets_values slot; missing the string shape skips them and
      // throws off every index after the combo.
      if (Array.isArray(type) || type === 'COMBO') {
        widgetNames.push(name)
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
