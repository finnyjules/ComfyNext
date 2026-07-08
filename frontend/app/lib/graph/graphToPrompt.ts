// Converts a serialized LiteGraph workflow (as produced by
// `convertToLiteGraph()` in `~/composables/useVueNodes`) plus an
// `/object_info` schema into ComfyUI's API prompt format:
// `{ [nodeIdString]: { class_type, inputs } }`.
//
// Handles linear graphs plus mode 2 (mute) / mode 4 (bypass) — see
// `resolveSource` below. Subgraph-instance nodes (`workflow.definitions.
// subgraphs`) are inlined by `flattenSubgraphs` as a pure pre-pass before
// any of the rest of this file runs — see `~/lib/graph/flattenSubgraphs`.
// Link resolution lives in one seam (`buildLinkIndex` + `resolveLink` +
// `resolveSource`) so that pre-pass (and any future one) can build on top
// without touching the widget-zip or connection-override logic here.

import type { LiteGraphNode, LiteGraphWorkflow } from '~/composables/useVueNodes'
import { widgetSlots, UnknownNodeTypeError } from '~/lib/graph/widgetOrder'
import { flattenSubgraphs, LITERAL_HOLDER_TYPE } from '~/lib/graph/flattenSubgraphs'

export type { LiteGraphWorkflow }

export interface ApiNode {
  class_type: string
  inputs: Record<string, any>
}

export type ApiPrompt = Record<string, ApiNode>

const UI_ONLY_TYPES = new Set(['Note', 'MarkdownNote'])

const MODE_MUTE = 2
const MODE_BYPASS = 4

/**
 * Link index: link id -> [originNodeId, originSlot]. Centralizing this here
 * means mode/subgraph handling added later only needs to change how this
 * index is built (or how it's consulted), not the per-node conversion logic.
 */
function buildLinkIndex(links: any[]): Map<number, [number, number]> {
  const index = new Map<number, [number, number]>()
  for (const link of links || []) {
    const [linkId, originId, originSlot] = link
    index.set(linkId, [originId, originSlot])
  }
  return index
}

function resolveLink(linkIndex: Map<number, [number, number]>, linkId: number): [number, number] | undefined {
  return linkIndex.get(linkId)
}

function nodeHasOutputsUsed(node: LiteGraphNode): boolean {
  return (node.outputs || []).some((o) => Array.isArray(o.links) && o.links.length > 0)
}

/** A resolved connection either points at a real upstream node/slot, or —
 * for a flattened subgraph's widget-backed boundary input — is a literal
 * value with no node reference at all. */
type ResolvedSource = { ref: [string, number] } | { literal: any } | null

/**
 * Resolves the true source of a link's origin `(nodeId, slot)`, walking
 * through any chain of muted/bypassed nodes (mirrors ComfyUI frontend
 * behavior):
 *  - mode 0 (normal): the origin node/slot is the answer.
 *  - mode 2 (mute): the origin node contributes nothing — the consuming
 *    input should be omitted entirely. Returns null.
 *  - mode 4 (bypass): the origin node is excluded from the prompt; the
 *    output re-routes to the bypassed node's FIRST declared input whose
 *    type matches the output's declared type. That input's own incoming
 *    link (if any) is then resolved recursively (transitively walking
 *    chains of bypassed/muted nodes). No matching input, or no link on
 *    the matching input, is treated as mute for this consumer.
 *  - `LITERAL_HOLDER_TYPE` (synthetic, from `flattenSubgraphs`): resolves to
 *    the holder's own literal value instead of a node reference, and the
 *    holder itself never gets a `prompt[id]` entry (see the main loop's
 *    `UI_ONLY_TYPES`-style skip).
 *
 * `visited` guards against cycles: each (nodeId, slot) pair is recorded
 * before recursing, and revisiting one short-circuits to null rather than
 * looping forever.
 */
function resolveSource(
  nodesById: Map<number, LiteGraphNode>,
  linkIndex: Map<number, [number, number]>,
  nodeId: number,
  slot: number,
  visited: Set<string> = new Set(),
): ResolvedSource {
  const key = `${nodeId}:${slot}`
  if (visited.has(key)) return null
  visited.add(key)

  const node = nodesById.get(nodeId)
  if (!node) return null

  const mode = node.mode ?? 0
  if (mode === MODE_MUTE) return null

  if (node.type === LITERAL_HOLDER_TYPE) {
    return { literal: (node.widgets_values || [])[0] }
  }

  if (mode === MODE_BYPASS) {
    const output = (node.outputs || [])[slot]
    if (!output) return null
    const matchingInput = (node.inputs || []).find((input) => input.type === output.type)
    if (!matchingInput || matchingInput.link == null) return null
    const resolved = resolveLink(linkIndex, matchingInput.link)
    if (!resolved) return null
    const [originId, originSlot] = resolved
    return resolveSource(nodesById, linkIndex, originId, originSlot, visited)
  }

  return { ref: [String(nodeId), slot] }
}

/**
 * Builds ComfyUI's API prompt from a serialized LiteGraph workflow. Mute
 * (mode 2) and bypass (mode 4) nodes are excluded; bypassed nodes' consumed
 * outputs are re-routed to their matching input via `resolveSource`.
 * Subgraph-instance nodes are inlined first via `flattenSubgraphs` whenever
 * the workflow carries `definitions.subgraphs` — everything below this
 * point never has to know a subgraph existed.
 */
export function graphToPrompt(workflow: LiteGraphWorkflow, objectInfo: Record<string, any>): ApiPrompt {
  const flatWorkflow = (workflow as any).definitions?.subgraphs?.length
    ? flattenSubgraphs(workflow)
    : workflow

  const linkIndex = buildLinkIndex(flatWorkflow.links)
  const nodesById = new Map<number, LiteGraphNode>()
  for (const node of flatWorkflow.nodes || []) {
    nodesById.set(node.id, node)
  }
  const prompt: ApiPrompt = {}

  for (const node of flatWorkflow.nodes || []) {
    const classType = node.type
    if (UI_ONLY_TYPES.has(classType) || classType === LITERAL_HOLDER_TYPE) continue

    const mode = node.mode ?? 0
    if (mode === MODE_MUTE || mode === MODE_BYPASS) continue

    if (!objectInfo[classType]) {
      if (!nodeHasOutputsUsed(node)) continue
      throw new UnknownNodeTypeError(classType)
    }

    const inputs: Record<string, any> = {}

    // 1) Positional widget values, zipped against the schema-derived slot
    // order. `__control` slots consume a widgets_values position but never
    // emit an input.
    const slots = widgetSlots(classType, objectInfo)
    const widgetsValues = node.widgets_values || []
    slots.forEach((slot, i) => {
      if (slot.control) return
      if (i >= widgetsValues.length) return
      inputs[slot.name] = widgetsValues[i]
    })

    // 2) Connections override any positional widget value of the same name
    // (this is how a converted widget wins over its old positional slot).
    // The origin is resolved through `resolveSource`, which walks through
    // any chain of muted/bypassed upstream nodes; a null result means the
    // input should be omitted (fed by a mute, or a bypass with no matching
    // input / a cycle).
    for (const input of node.inputs || []) {
      if (input.link == null) continue
      const resolved = resolveLink(linkIndex, input.link)
      if (!resolved) continue
      const [originId, originSlot] = resolved
      const source = resolveSource(nodesById, linkIndex, originId, originSlot)
      if (!source) {
        delete inputs[input.name]
        continue
      }
      inputs[input.name] = 'literal' in source ? source.literal : source.ref
    }

    prompt[String(node.id)] = { class_type: classType, inputs }
  }

  const sortedKeys = Object.keys(prompt).sort((a, b) => Number(a) - Number(b))
  const sorted: ApiPrompt = {}
  for (const key of sortedKeys) sorted[key] = prompt[key]
  return sorted
}
