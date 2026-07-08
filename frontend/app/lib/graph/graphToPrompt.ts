// Converts a serialized LiteGraph workflow (as produced by
// `convertToLiteGraph()` in `~/composables/useVueNodes`) plus an
// `/object_info` schema into ComfyUI's API prompt format:
// `{ [nodeIdString]: { class_type, inputs } }`.
//
// This only handles linear graphs: every node runs at mode 0 (no mute/bypass)
// and there are no subgraphs to flatten. Link resolution lives in one helper
// (`resolveLink`) so later tasks that add mode handling / subgraph
// flattening can build on top without touching the widget-zip or
// connection-override logic here.

import type { LiteGraphNode, LiteGraphWorkflow } from '~/composables/useVueNodes'
import { widgetSlots, UnknownNodeTypeError } from '~/lib/graph/widgetOrder'

export type { LiteGraphWorkflow }

export interface ApiNode {
  class_type: string
  inputs: Record<string, any>
}

export type ApiPrompt = Record<string, ApiNode>

const UI_ONLY_TYPES = new Set(['Note', 'MarkdownNote'])

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

function resolveLink(linkIndex: Map<number, [number, number]>, linkId: number): [string, number] | undefined {
  const resolved = linkIndex.get(linkId)
  if (!resolved) return undefined
  const [originId, originSlot] = resolved
  return [String(originId), originSlot]
}

function nodeHasOutputsUsed(node: LiteGraphNode): boolean {
  return (node.outputs || []).some((o) => Array.isArray(o.links) && o.links.length > 0)
}

/**
 * Builds ComfyUI's API prompt from a serialized LiteGraph workflow. Treats
 * every node as mode 0 (mute/bypass and subgraph flattening are later tasks).
 */
export function graphToPrompt(workflow: LiteGraphWorkflow, objectInfo: Record<string, any>): ApiPrompt {
  const linkIndex = buildLinkIndex(workflow.links)
  const prompt: ApiPrompt = {}

  for (const node of workflow.nodes || []) {
    const classType = node.type
    if (UI_ONLY_TYPES.has(classType)) continue

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
    for (const input of node.inputs || []) {
      if (input.link == null) continue
      const resolved = resolveLink(linkIndex, input.link)
      if (!resolved) continue
      inputs[input.name] = resolved
    }

    prompt[String(node.id)] = { class_type: classType, inputs }
  }

  const sortedKeys = Object.keys(prompt).sort((a, b) => Number(a) - Number(b))
  const sorted: ApiPrompt = {}
  for (const key of sortedKeys) sorted[key] = prompt[key]
  return sorted
}
