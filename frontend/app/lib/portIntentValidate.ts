import type { PortAnchor } from './portIntent'
import { isTypeCompatible, linkInputPorts, outputPorts } from './portIntent'
import { widgetDefsFromInfo } from './portIntentCatalog'

export interface NormalizedNode {
  localId: string
  type: string
  widgetOverrides: Record<string, unknown>
}

export interface NormalizedEdge {
  fromAnchor?: boolean
  toAnchor?: boolean
  fromId?: string
  fromPort?: string
  toId?: string
  toPort?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  nodes: NormalizedNode[]
  edges: NormalizedEdge[]
  note: string
}

/** Validate the AI suggestion against the real /object_info schema.
 *  Structural problems (bad node type, bad port, bad wiring) are errors that
 *  fail validation; bad widget values are silently dropped or clamped — widget
 *  configuration is best-effort by design. */
export function validateSuggestion(
  raw: any,
  objectInfo: Record<string, any>,
  anchor: PortAnchor,
): ValidationResult {
  const errors: string[] = []
  const nodes: NormalizedNode[] = []
  const edges: NormalizedEdge[] = []
  const note = typeof raw?.note === 'string' ? raw.note : ''

  if (!Array.isArray(raw?.nodes) || raw.nodes.length === 0) {
    return { ok: false, errors: ['"nodes" must be a non-empty array'], nodes, edges, note }
  }

  for (const sn of raw.nodes) {
    const type = String(sn?.type ?? '')
    const localId = String(sn?.id ?? '')
    const info = objectInfo[type]
    if (!info) { errors.push(`Unknown node type "${type}" — use only types from the catalog`); continue }
    if (!localId) { errors.push(`Node of type "${type}" is missing an "id"`); continue }

    const defs = widgetDefsFromInfo(info, Infinity)
    const widgetOverrides: Record<string, unknown> = {}
    for (const w of Array.isArray(sn.widgets) ? sn.widgets : []) {
      const def = defs.find(d => d.name === w?.name)
      if (!def) continue
      let value: unknown = w.value
      if (def.type === 'ENUM') {
        if (!def.options?.includes(String(value))) continue
        value = String(value)
      }
      else if (def.type === 'INT' || def.type === 'FLOAT') {
        let num = typeof value === 'number' ? value : Number.parseFloat(String(value))
        if (Number.isNaN(num)) continue
        if (typeof def.min === 'number') num = Math.max(def.min, num)
        if (typeof def.max === 'number') num = Math.min(def.max, num)
        value = def.type === 'INT' ? Math.round(num) : num
      }
      else if (def.type === 'BOOLEAN') {
        value = value === true || value === 'true'
      }
      else {
        value = String(value)
      }
      widgetOverrides[def.name] = value
    }
    nodes.push({ localId, type, widgetOverrides })
  }

  const byLocalId = new Map(nodes.map(n => [n.localId, n]))
  let anchorEdges = 0

  for (const se of Array.isArray(raw.edges) ? raw.edges : []) {
    const from = String(se?.from ?? '')
    const to = String(se?.to ?? '')
    const edge: NormalizedEdge = {}
    let fromType = ''
    let toType = ''
    let bad = false

    if (from === 'anchor') {
      if (anchor.direction !== 'output') { errors.push('"anchor" used as a source but the anchor is an input port'); bad = true }
      else { edge.fromAnchor = true; fromType = anchor.portType }
    }
    else {
      const dot = from.indexOf('.')
      const id = dot >= 0 ? from.slice(0, dot) : from
      const port = dot >= 0 ? from.slice(dot + 1) : ''
      const n = byLocalId.get(id)
      if (!n) { errors.push(`Edge source "${from}" references an unknown node id`); bad = true }
      else {
        const p = outputPorts(objectInfo[n.type]).find(o => o.name === port)
        if (!p) { errors.push(`Node "${n.type}" has no output named "${port}"`); bad = true }
        else { edge.fromId = n.localId; edge.fromPort = p.name; fromType = p.type }
      }
    }

    if (to === 'anchor') {
      if (anchor.direction !== 'input') { errors.push('"anchor" used as a target but the anchor is an output port'); bad = true }
      else { edge.toAnchor = true; toType = anchor.portType }
    }
    else {
      const dot = to.indexOf('.')
      const id = dot >= 0 ? to.slice(0, dot) : to
      const port = dot >= 0 ? to.slice(dot + 1) : ''
      const n = byLocalId.get(id)
      if (!n) { errors.push(`Edge target "${to}" references an unknown node id`); bad = true }
      else {
        const p = linkInputPorts(objectInfo[n.type]).find(i => i.name === port)
        if (!p) { errors.push(`Node "${n.type}" has no link input named "${port}"`); bad = true }
        else { edge.toId = n.localId; edge.toPort = p.name; toType = p.type }
      }
    }

    if (edge.fromAnchor || edge.toAnchor) anchorEdges++
    if (bad) continue
    if (!isTypeCompatible(fromType, toType)) {
      errors.push(`Edge ${from} → ${to} connects incompatible types ${fromType} → ${toType}`)
      continue
    }
    edges.push(edge)
  }

  if (anchorEdges !== 1) {
    errors.push(`Exactly one edge must reference "anchor" (got ${anchorEdges})`)
  }

  return { ok: errors.length === 0, errors, nodes, edges, note }
}
