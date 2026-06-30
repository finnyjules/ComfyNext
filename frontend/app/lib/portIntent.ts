// Pure helpers for the port-intent popover. No Vue/Nuxt imports — unit-testable.

import { typesCompatible } from '~/utils/portTypes'

export interface PortAnchor {
  nodeId: string
  nodeType: string
  portName: string
  portType: string
  portIndex: number
  direction: 'input' | 'output'
}

export interface NodeTypeLite {
  name: string
  displayName: string
  description: string
  category: string
  inputs: { name: string; type: string }[]
  outputs: { name: string; type: string }[]
}

// Shared semantics with the canvas (utils/portTypes): exact match, '*'
// wildcard, and comma-union intersection — so the popover offers the Timeline
// (clip inputs declare "IMAGE,VIDEO") for a VIDEO output anchor, etc.
export function isTypeCompatible(a: string, b: string): boolean {
  return typesCompatible(a, b)
}

/** The port on `node` that could legally connect to the anchor, if any.
 *  Output anchor → node's inputs (downstream); input anchor → node's outputs (upstream). */
export function matchingPort(
  node: NodeTypeLite,
  anchor: Pick<PortAnchor, 'portType' | 'direction'>,
): { name: string; type: string } | null {
  const ports = anchor.direction === 'output' ? node.inputs : node.outputs
  return ports.find(p => isTypeCompatible(p.type, anchor.portType)) ?? null
}

/** Node types that can connect to the anchor port. Wildcard anchors match all. */
export function anchorCandidates(
  nodeTypes: NodeTypeLite[],
  anchor: Pick<PortAnchor, 'portType' | 'direction'>,
): NodeTypeLite[] {
  return nodeTypes.filter(n => matchingPort(n, anchor))
}

/** Inputs that render as ports — mirrors createNodeData's filter in VueNodeCanvas.vue.
 *  Enum specs (array type) are widgets; scalar types are widgets unless forceInput. */
export function linkInputPorts(info: any): { name: string; type: string; optional?: boolean }[] {
  // Tag by which dict each input came from (REQUIRED vs OPTIONAL) so the agent's
  // add-node + verify know which inputs actually need wiring — a generator's
  // optional `image` (img2img) must NOT read as a required input.
  const entries = [
    ...Object.entries((info?.input?.required ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: false })),
    ...Object.entries((info?.input?.optional ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: true })),
  ]
  return entries
    .filter(({ s }) => {
      const arr = Array.isArray(s) ? s : [s]
      const t = arr[0]
      const cfg = arr[1] || {}
      if (Array.isArray(t)) return false
      if (cfg.forceInput) return true
      return !['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'].includes(String(t))
    })
    .map(({ n, s, optional }) => {
      const arr = Array.isArray(s) ? s : [s]
      return { name: n, type: String(arr[0]), ...(optional ? { optional: true } : {}) }
    })
}

export function outputPorts(info: any): { name: string; type: string }[] {
  return ((info?.output ?? []) as string[]).map((t, i) => ({
    name: String(info?.output_name?.[i] ?? t),
    type: String(t),
  }))
}
