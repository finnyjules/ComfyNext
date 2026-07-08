// Pure pre-pass that inlines subgraph-instance nodes into their definition's
// interior nodes, so `graphToPrompt` never has to know subgraphs exist.
//
// Ground truth for the shapes below was taken from REAL exported workflow
// JSON (blueprints/*.json in the repo root, e.g. blueprints/Sharpen.json and
// blueprints/Text to Image (Z-Image-Turbo).json), not from upstream ComfyUI
// docs or guesses. Two things differ from what a naive reading of
// `subgraphToLiteGraph()` (useVueNodes.ts:226-275) would suggest:
//
//  1. `sg.links` (a subgraph DEFINITION's link list, found under
//     `workflow.definitions.subgraphs[]`) is an array of LINK OBJECTS —
//     `{ id, origin_id, origin_slot, target_id, target_slot, type }` — NOT
//     the 6-tuple array format (`[id, originId, originSlot, targetId,
//     targetSlot, type]`) that top-level `workflow.links` uses. This file
//     reads both shapes defensively (see `normalizeLink`), matching the same
//     defensive pattern `convertFromLiteGraph` already uses at
//     useVueNodes.ts:484 (`Array.isArray(link) ? link : Object.values(link)`).
//  2. Boundary I/O is expressed as ordinary links whose origin/target id is
//     the synthetic boundary node id (`sg.inputNode.id`, `sg.outputNode.id`,
//     defaulting to -10 / -20). There is no separate "boundary map" — a
//     link with `origin_id === inputNode.id` at `origin_slot === i` means
//     "this consumer receives the outer instance's input slot i"; a link
//     with `target_id === outputNode.id` at `target_slot === j` means "this
//     producer is exposed as the outer instance's output slot j".
//
// Id remapping: interior node ids are only unique WITHIN one subgraph
// definition (real exports reuse small ids like 1, 2, 3... independently
// per definition — verified across blueprints/*.json, e.g. two sibling
// subgraphs in "Depth to Image (Z-Image-Turbo).json" both declare node ids
// 8, 10, 14). Two instances of the *same* definition (or two different
// definitions that happen to reuse an id) would collide if ids were copied
// as-is, so every interior id is remapped to
//   Number(String(instanceId) + String(innerId).padStart(4, '0'))
// e.g. instance 2, interior node 23 -> 20023. This stays numeric (so
// existing numeric-sort/Number(id) assumptions elsewhere, e.g.
// `graphToPrompt`'s final key sort, keep working) and is collision-free
// across sibling instances as long as no interior id exceeds 4 digits —
// true for every workflow sampled (max observed interior id: 229, in
// blueprints/Video Inpaint(Wan2.1 VACE).json). If an interior id ever needs
// a 5th digit this throws `SubgraphOverflowError` rather than silently
// colliding; widen the padding then.
//
// Widget-backed boundary inputs: a subgraph instance can expose an interior
// widget directly on itself via `properties.proxyWidgets` (an array of
// `[targetNodeId, widgetName]` pairs, zipped positionally against the
// instance's own `widgets_values` — same zip convention as
// `widgetSlots()`/`widgetOrder.ts`). Verified from blueprints/Sharpen.json
// (`proxyWidgets: [["24", "value"]]`) and
// "Text to Image (Z-Image-Turbo).json" (`proxyWidgets: [["-1","text"], ...,
// ["3","seed"], ...]`). Two distinct targets appear:
//   - target === '-1': the proxied widget corresponds to one of this
//     instance's own boundary INPUT ports (matched by name against the
//     instance's `inputs[]`/`sg.inputs[]`). When that instance input port
//     has no incoming link, the widget value is routed to interior
//     consumers of that boundary input as a literal, exactly as if a
//     PrimitiveXxx node fed it.
//   - target is a real interior node id (e.g. "3"): the widget is proxied
//     straight onto that interior node's own widget, bypassing the
//     boundary-input mechanism entirely (e.g. exposing a KSampler's `seed`
//     on the instance without it ever being a subgraph input/output). This
//     file does NOT implement this second form — replaying it would mean
//     rewriting an interior node's positional `widgets_values` in place,
//     which risks desyncing `widgetSlots()`'s schema-driven zip if the
//     interior node's own widgets were reordered by a partial connection.
//     Left as a documented limitation (see report) rather than guessed at;
//     only the '-1' (boundary-input) form is handled.
//
// Depth/cycle guard: subgraph definitions can nest (a definition's interior
// nodes can themselves be subgraph instances — verified in
// "Depth to Image (Z-Image-Turbo).json", where one subgraph's interior node
// list contains a node whose `type` is another subgraph's id). Recursion
// depth is capped at 16; exceeding it throws `SubgraphDepthError` rather
// than hanging on a definition cycle (A contains B contains A).

import type { LiteGraphNode, LiteGraphWorkflow } from '~/composables/useVueNodes'
import { isSubgraphType } from '~/composables/useVueNodes'

export class SubgraphDepthError extends Error {
  constructor(public subgraphId: string) {
    super(`Subgraph nesting exceeded max depth (16) at definition "${subgraphId}" — likely a definition cycle`)
  }
}

export class SubgraphOverflowError extends Error {
  constructor(public innerId: number) {
    super(`Interior node id ${innerId} has more than 4 digits — the id-remap scheme (instanceId + innerId.padStart(4,'0')) is no longer collision-safe; widen the padding`)
  }
}

const MAX_DEPTH = 16

/** Normalized link tuple form used internally regardless of source shape. */
type LinkTuple = [id: number, originId: number, originSlot: number, targetId: number, targetSlot: number, type: string]

/** Reads a link that's either the outer 6-tuple array form or (inside a
 * subgraph definition) the `{id, origin_id, origin_slot, target_id,
 * target_slot, type}` object form — see file header point 1. */
function normalizeLink(link: any): LinkTuple {
  if (Array.isArray(link)) {
    return [link[0], link[1], link[2], link[3], link[4], link[5]]
  }
  return [link.id, link.origin_id, link.origin_slot, link.target_id, link.target_slot, link.type]
}

function remapId(instanceId: number, innerId: number): number {
  const innerStr = String(innerId)
  if (innerStr.length > 4) throw new SubgraphOverflowError(innerId)
  return Number(`${instanceId}${innerStr.padStart(4, '0')}`)
}

interface FlattenContext {
  defsById: Map<string, any>
  nextLinkId: { current: number }
}

/** A resolved connection target used while stitching boundary links: either a
 * remapped interior (nodeId, slot), or "no connection" (null). */
type ResolvedEndpoint = { nodeId: number; slot: number } | null

/**
 * Flattens every subgraph-instance node (node.type matching `isSubgraphType`)
 * in `workflow` into its definition's interior nodes, recursively. Pure:
 * returns a new workflow, never mutates the input. No-ops (returns the same
 * workflow reference) when there are no subgraph definitions to expand.
 */
export function flattenSubgraphs(workflow: LiteGraphWorkflow): LiteGraphWorkflow {
  const definitions = (workflow as any).definitions?.subgraphs as any[] | undefined
  if (!definitions?.length) return workflow

  const defsById = new Map<string, any>()
  for (const sg of definitions) {
    if (sg?.id) defsById.set(sg.id, sg)
  }

  const ctx: FlattenContext = {
    defsById,
    nextLinkId: { current: nextLinkIdSeed(workflow) },
  }

  const outNodes: LiteGraphNode[] = []
  const outLinks: LinkTuple[] = (workflow.links || []).map(normalizeLink)

  for (const node of workflow.nodes || []) {
    if (isSubgraphType(node.type)) {
      inlineInstance(node, ctx, outNodes, outLinks, 0)
    } else {
      outNodes.push(cloneNode(node))
    }
  }

  // Reconcile every node's own `inputs[].link` / `outputs[].links` fields
  // against the final `outLinks` array. graphToPrompt (and resolveSource's
  // bypass walk) read connectivity exclusively off the NODE's port fields,
  // not by scanning `links` for matching endpoints — so any link rewritten
  // or newly synthesized above (boundary passthroughs, literal holders,
  // nested-instance inlining) must be reflected back onto both endpoint
  // nodes' port arrays. Doing this as one final reconcile pass (rather than
  // patching ports inline while rewiring) means every rewrite path — outer
  // passthrough, literal injection, ordinary interior links, recursion —
  // is reflected correctly regardless of the order links were touched in.
  reconcileNodePorts(outNodes, outLinks)

  const result: any = {
    ...workflow,
    nodes: outNodes,
    links: outLinks.map((l) => [...l]),
    last_node_id: Math.max(workflow.last_node_id ?? 0, ...outNodes.map((n) => n.id), 0),
    last_link_id: ctx.nextLinkId.current - 1,
  }
  // The flattened prompt has no subgraph instances left, so downstream
  // consumers no longer need the definitions — but preserve them anyway
  // (cheap, and harmless) in case a caller round-trips this workflow.
  return result as LiteGraphWorkflow
}

function cloneNode(node: LiteGraphNode): LiteGraphNode {
  return {
    ...node,
    inputs: (node.inputs || []).map((i) => ({ ...i })),
    outputs: (node.outputs || []).map((o) => ({ ...o })),
  }
}

/**
 * Rewrites every node's `inputs[].link` to the (possibly new) link id
 * feeding that exact (nodeId, targetSlot), and every node's
 * `outputs[].links` to the list of link ids originating at that exact
 * (nodeId, originSlot). Ports with no matching link are cleared (`link:
 * null` / `links: []`), matching how an unconnected port looks natively.
 */
function reconcileNodePorts(nodes: LiteGraphNode[], links: LinkTuple[]): void {
  const byId = new Map<number, LiteGraphNode>()
  for (const n of nodes) byId.set(n.id, n)

  for (const node of nodes) {
    for (const input of node.inputs || []) (input as any).link = null
    for (const output of node.outputs || []) (output as any).links = []
  }

  for (const [linkId, originId, originSlot, targetId, targetSlot] of links) {
    const originNode = byId.get(originId)
    const targetNode = byId.get(targetId)
    if (originNode) {
      const out = (originNode.outputs || [])[originSlot]
      if (out) {
        if (!Array.isArray((out as any).links)) (out as any).links = []
        ;(out as any).links.push(linkId)
      }
    }
    if (targetNode) {
      const inp = (targetNode.inputs || [])[targetSlot]
      if (inp) (inp as any).link = linkId
    }
  }
}

function nextLinkIdSeed(workflow: LiteGraphWorkflow): number {
  let max = workflow.last_link_id ?? 0
  for (const link of workflow.links || []) {
    const [id] = normalizeLink(link)
    if (typeof id === 'number' && id > max) max = id
  }
  return max + 1
}

/**
 * Replaces an outer link's target (or origin) that pointed at a subgraph
 * instance with the instance's now-flattened interior wiring. Mutates
 * `outNodes`/`outLinks` in place (they're local accumulators owned by the
 * single top-level `flattenSubgraphs` call, not the caller's workflow).
 */
function inlineInstance(
  instance: LiteGraphNode,
  ctx: FlattenContext,
  outNodes: LiteGraphNode[],
  outLinks: LinkTuple[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) throw new SubgraphDepthError(instance.type)

  const def = ctx.defsById.get(instance.type)
  if (!def) {
    // Unknown definition (shouldn't happen for a well-formed workflow) —
    // leave the instance as-is so the existing unknown-class_type path in
    // graphToPrompt reports it clearly instead of silently dropping it.
    outNodes.push(instance)
    return
  }

  const instanceId = instance.id
  const innerNodes: any[] = def.nodes || []
  const innerLinks: LinkTuple[] = (def.links || []).map(normalizeLink)
  const inputBoundaryId = def.inputNode?.id ?? -10
  const outputBoundaryId = def.outputNode?.id ?? -20
  const defInputs: any[] = def.inputs || []
  const defOutputs: any[] = def.outputs || []

  // 1) Determine, for each boundary INPUT slot i, what the outer world
  // resolves it to: either the real outer (nodeId, slot) feeding the
  // instance's input slot i, or — when unconnected — a literal widget value
  // routed via `properties.proxyWidgets` (target '-1'), or nothing.
  //
  // Deliberately searched live in `outLinks` by (target_id, target_slot)
  // rather than read off `instance.inputs[i].link`: for a NESTED subgraph
  // instance, `instance` here is a remapped clone of an interior node
  // (`remappedInnerNodes` below, passed back into this same function one
  // recursion level up) whose `.inputs[].link` field still holds the
  // ORIGINAL (pre-remap) interior link id — only `outLinks` (the shared,
  // continuously-rewritten accumulator) reflects the current true wiring.
  const boundaryInputSource: (ResolvedEndpoint | { literal: any })[] = defInputs.map((_, i) => {
    const feedingLink = outLinks.find((l) => l[3] === instanceId && l[4] === i)
    if (feedingLink) return { nodeId: feedingLink[1], slot: feedingLink[2] }
    // No incoming connection — check proxyWidgets for a '-1'-targeted entry
    // matching this boundary input's name, and pull its literal value out of
    // the instance's own widgets_values by position.
    const proxyWidgets: [string, string][] = instance.properties?.proxyWidgets || []
    const boundaryName = defInputs[i]?.name
    const widgetsValues = instance.widgets_values || []
    const proxyIdx = proxyWidgets.findIndex(([target, name]) => target === '-1' && name === boundaryName)
    if (proxyIdx !== -1 && proxyIdx < widgetsValues.length) {
      return { literal: widgetsValues[proxyIdx] }
    }
    return null
  })

  // Remove the outer links that fed the instance's own inputs — they now
  // terminate at a node (the instance) that is being deleted. Their true
  // origins were already captured in `boundaryInputSource` above.
  for (let idx = outLinks.length - 1; idx >= 0; idx--) {
    if (outLinks[idx]![3] === instanceId) outLinks.splice(idx, 1)
  }

  // 2) Remap every interior node id and push the remapped node.
  const idMap = new Map<number, number>() // interior id -> remapped id (boundary ids excluded)
  for (const innerNode of innerNodes) {
    const remapped = remapId(instanceId, innerNode.id)
    idMap.set(innerNode.id, remapped)
  }

  const remappedInnerNodes: LiteGraphNode[] = innerNodes.map((innerNode) => ({
    ...innerNode,
    id: idMap.get(innerNode.id)!,
    // Interior nodes are pushed with fresh, non-overlapping positions isn't
    // required for prompt correctness — position is cosmetic-only in the
    // API prompt path, so we pass it through unchanged.
  }))

  // 3) Rewrite interior links, translating boundary references:
  //    - origin_id === inputBoundaryId  -> resolved outer source for that
  //      boundary input slot (or a literal, or dropped if none).
  //    - target_id === outputBoundaryId -> recorded as this instance's
  //      output[slot] producer, used to rewrite OUTER links that consumed
  //      instance.outputs[slot].
  //    - otherwise                       -> both ends remapped via idMap.
  const outputProducer: ResolvedEndpoint[] = defOutputs.map(() => null)

  for (const [linkId, originId, originSlot, targetId, targetSlot, type] of innerLinks) {
    const isFromBoundaryInput = originId === inputBoundaryId
    const isToBoundaryOutput = targetId === outputBoundaryId

    if (isToBoundaryOutput) {
      // Record the (remapped) producer for this definition output slot.
      // origin_id here is always an interior node id (boundary-in ->
      // boundary-out passthrough isn't modeled in any sampled export, but
      // if it occurred, `originId === inputBoundaryId` would also be true
      // and we fall into the boundary-input source resolution instead).
      if (originId === inputBoundaryId) {
        // Direct passthrough: definition output is fed straight by a
        // definition input. Resolve via boundaryInputSource below once
        // outer rewiring begins; store a sentinel marker.
        outputProducer[targetSlot] = { nodeId: inputBoundaryId, slot: originSlot }
      } else {
        outputProducer[targetSlot] = { nodeId: idMap.get(originId) ?? originId, slot: originSlot }
      }
      continue
    }

    if (isFromBoundaryInput) {
      const source = boundaryInputSource[originSlot]
      const remappedTarget = idMap.get(targetId) ?? targetId
      if (!source) {
        // Boundary input has neither an outer connection nor a literal —
        // drop the link (consumer input ends up unset, same as an
        // unconnected optional input elsewhere in graphToPrompt).
        continue
      }
      if ('literal' in source) {
        // Route the literal by injecting a tiny synthetic literal-holder
        // node: graphToPrompt only reads connectivity off `inputs[].link`,
        // so the simplest faithful representation of "this boundary input
        // is fed by a widget value, not a wire" is a fake single-output
        // node whose sole widgets_values entry IS that value, wired in like
        // any other producer. We deliberately do NOT try to rewrite the
        // interior consumer's own `widgets_values` positionally — we don't
        // have that node's widget schema/order here, only its name.
        const holderId = literalHolderNodeId(instanceId, originSlot)
        ensureLiteralHolderNode(outNodes, holderId, type, source.literal)
        const newLinkId = ctx.nextLinkId.current++
        outLinks.push([newLinkId, holderId, 0, remappedTarget, targetSlot, type])
        continue
      }
      // Real outer connection: wire the interior consumer directly to the
      // already-resolved true outer (nodeId, slot).
      const newLinkId = ctx.nextLinkId.current++
      outLinks.push([newLinkId, source.nodeId, source.slot, remappedTarget, targetSlot, type])
      continue
    }

    // Ordinary interior-to-interior link: remap both ends, assign a fresh
    // link id scoped to this flatten pass to avoid colliding with ids from
    // sibling instances or the outer graph.
    const newLinkId = ctx.nextLinkId.current++
    outLinks.push([
      newLinkId,
      idMap.get(originId) ?? originId,
      originSlot,
      idMap.get(targetId) ?? targetId,
      targetSlot,
      type,
    ])
  }

  // 4) Rewrite OUTER links whose origin was this instance's output slot j
  // to instead originate from the resolved interior producer (or drop them
  // if the definition output has no producer at all). Resolves the rare
  // direct input->output passthrough case (no interior node in between) by
  // falling back to `boundaryInputSource`.
  function resolveOutputProducer(slot: number): ResolvedEndpoint | { literal: any } | null {
    const producer = outputProducer[slot]
    if (!producer) return null
    if (producer.nodeId !== inputBoundaryId) return producer
    return boundaryInputSource[producer.slot] ?? null
  }

  for (let outerIdx = 0; outerIdx < outLinks.length; outerIdx++) {
    const outer = outLinks[outerIdx]!
    if (outer[1] !== instanceId) continue
    const resolved = resolveOutputProducer(outer[2])
    if (!resolved) {
      // No interior producer for this output — drop the link (mirrors an
      // unconnected output elsewhere).
      outLinks.splice(outerIdx, 1)
      outerIdx--
      continue
    }
    if ('literal' in resolved) {
      const holderId = literalHolderNodeId(instanceId, outer[2])
      ensureLiteralHolderNode(outNodes, holderId, outer[5], resolved.literal)
      outLinks[outerIdx] = [outer[0], holderId, 0, outer[3], outer[4], outer[5]]
      continue
    }
    outLinks[outerIdx] = [outer[0], resolved.nodeId, resolved.slot, outer[3], outer[4], outer[5]]
  }

  // 5) Recurse into any interior node that is itself a subgraph instance,
  // then push everything (recursion happens on the REMAPPED nodes so
  // nested instances get inlined using their already-unique ids).
  for (const remappedNode of remappedInnerNodes) {
    if (isSubgraphType(remappedNode.type)) {
      inlineInstance(remappedNode, ctx, outNodes, outLinks, depth + 1)
    } else {
      outNodes.push(remappedNode)
    }
  }
}

// Deterministic id for the tiny synthetic node that holds a proxied literal
// boundary-input value (from `properties.proxyWidgets` target '-1'). Reuses
// the same collision-safe remap scheme, offset into the 9000-99999 range of
// the 4-digit suffix so it can never collide with a real interior id
// (interior ids are verified <= 4 digits per the overflow guard above).
function literalHolderNodeId(instanceId: number, boundarySlot: number): number {
  return remapId(instanceId, 9000 + boundarySlot)
}

// Exported so graphToPrompt.ts can recognize + resolve-away this synthetic
// type as a single source of truth for the string (avoids drift between the
// two files' definitions of what a "literal holder" node looks like).
export const LITERAL_HOLDER_TYPE = '__flatten_literal__'

function ensureLiteralHolderNode(outNodes: LiteGraphNode[], id: number, type: string, value: any): void {
  if (outNodes.some((n) => n.id === id)) return
  outNodes.push({
    id,
    type: LITERAL_HOLDER_TYPE,
    pos: [0, 0],
    size: [0, 0],
    mode: 0,
    inputs: [],
    outputs: [{ name: type, type, links: [] }],
    widgets_values: [value],
  } as any)
}
