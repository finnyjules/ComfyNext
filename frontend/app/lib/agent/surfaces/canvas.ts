/**
 * Node-canvas agent surface — Phase 3 Slice 1 (mutate EXISTING nodes).
 *
 * The canvas is Vue Flow native (VueNodeCanvas.vue / useVueNodes.ts). This
 * surface is the mutation engine the existing Explain tool lacks: it describes
 * the (selected) graph and maps natural-language edits to named, validated
 * commands over the nodes already on the canvas — set a widget, mute/bypass,
 * delete. Adding + wiring new nodes is a later slice
 * (docs/agent-canvas-surface-scope.md).
 *
 * Pure: every function takes a CanvasSnapshot and returns data or a fresh
 * snapshot, so it's unit-testable with no Vue/DOM. The composable owns the live
 * graph and MATERIALISES accepted commands via the canvas's own mutators.
 */
import type { Command, CommandResult, CommandSpec, SurfaceSnapshot } from '~/lib/agent/commandSurface'
import type { LayoutIssue } from '~/lib/agent/verify'

export interface PortLite { name: string; type: string; optional?: boolean }
export interface NodeLite {
  id: string
  nodeType: string
  title: string
  /** 0 = normal, 2 = muted, 4 = bypassed. */
  mode?: number
  /** widget name → current value (keys are the settable widget names). */
  widgets: Record<string, unknown>
  inputs: PortLite[]
  outputs: PortLite[]
}
export interface EdgeLite { source: string; sourcePort?: string; target: string; targetPort?: string }
export interface CanvasSnapshot { nodes: NodeLite[]; edges: EdgeLite[] }

const MODE_BY_NAME: Record<string, number> = { normal: 0, mute: 2, muted: 2, bypass: 4, bypassed: 4 }
const MODE_LABEL: Record<number, string> = { 0: 'normal', 2: 'muted', 4: 'bypassed' }

function clone<T>(v: T): T { return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T) }

function nodeName(n: NodeLite): string {
  return n.title && n.title !== n.nodeType ? `${n.title} (${n.nodeType})` : n.nodeType
}
function findNode(s: CanvasSnapshot, id?: string): NodeLite | undefined {
  return s.nodes.find(n => n.id === id)
}
function connectedInputs(s: CanvasSnapshot, nodeId: string): Set<string> {
  const set = new Set<string>()
  for (const e of s.edges) if (e.target === nodeId && e.targetPort) set.add(e.targetPort)
  return set
}

const CANVAS_COMMANDS: CommandSpec[] = [
  { op: 'setWidget', hint: 'Set a node\'s parameter (widget) by name. target = node id; args: { name, value }. name MUST be one of that node\'s widget keys (see its "widgets"). e.g. set sampler steps → {name:"steps", value:30}. This is what "set the seed to 42", "30 steps", "use the euler sampler" mean.' },
  { op: 'setMode', hint: 'Mute or bypass a node (or re-enable it). target = node id; args: { mode: "normal" | "mute" | "bypass" }. Muted = does not run; bypass = passes input through.' },
  { op: 'deleteNode', hint: 'Delete a node from the graph. target = node id. Edges touching it are removed too.' },
  { op: 'restore', hint: 'internal — undo support.' },
]

/** Read the (selected) graph as an agent snapshot: one object per node, each with
 *  its settable widgets + which inputs are connected, plus a graph summary. */
export function describeCanvas(s: CanvasSnapshot): SurfaceSnapshot {
  const byId = new Map(s.nodes.map(n => [n.id, n]))
  const objects: SurfaceSnapshot['objects'] = s.nodes.map((n) => {
    const conn = connectedInputs(s, n.id)
    const cur: Record<string, unknown> = {
      nodeType: n.nodeType,
      inputs: n.inputs.map(p => ({ name: p.name, type: p.type, connected: conn.has(p.name), ...(p.optional ? { optional: true } : {}) })),
      outputs: n.outputs.map(p => p.name),
    }
    if (Object.keys(n.widgets).length) cur.widgets = n.widgets
    if (n.mode && MODE_LABEL[n.mode] && n.mode !== 0) cur.state = MODE_LABEL[n.mode]
    return { id: n.id, label: nodeName(n), type: 'node', current: cur }
  })
  const edgeList = s.edges.map((e) => {
    const a = byId.get(e.source), b = byId.get(e.target)
    return `${a ? nodeName(a) : e.source}${e.sourcePort ? `.${e.sourcePort}` : ''} → ${b ? nodeName(b) : e.target}${e.targetPort ? `.${e.targetPort}` : ''}`
  })
  objects.push({ id: 'graph', label: 'Graph', type: 'graph', current: { nodeCount: s.nodes.length, edgeCount: s.edges.length, connections: edgeList } })
  return { surface: 'canvas', objects, commands: CANVAS_COMMANDS }
}

/** Apply one command to the snapshot (a dry-run for the proposal preview +
 *  validation). Pure — the input is never mutated. The composable replays
 *  accepted commands here to preview, then materialises them on the live graph. */
export function applyCanvasCommand(input: CanvasSnapshot, cmd: Command): CommandResult<CanvasSnapshot> {
  const state = clone(input)
  const snapshot = (): Command => ({ op: 'restore', args: { nodes: clone(input.nodes), edges: clone(input.edges) } })
  switch (cmd.op) {
    case 'setWidget': {
      const node = findNode(state, cmd.target)
      if (!node) return { ok: false, reason: 'invalid', detail: `no node '${String(cmd.target)}'` }
      const name = cmd.args?.name
      if (typeof name !== 'string' || !(name in node.widgets)) return { ok: false, reason: 'invalid', detail: `'${String(name)}' is not a widget on ${nodeName(node)} (has: ${Object.keys(node.widgets).join(', ') || 'none'})` }
      if (!('value' in (cmd.args ?? {}))) return { ok: false, reason: 'invalid', detail: 'missing args.value' }
      node.widgets[name] = cmd.args!.value
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'setMode': {
      const node = findNode(state, cmd.target)
      if (!node) return { ok: false, reason: 'invalid', detail: `no node '${String(cmd.target)}'` }
      const raw = String(cmd.args?.mode ?? '').toLowerCase()
      if (!(raw in MODE_BY_NAME)) return { ok: false, reason: 'invalid', detail: 'args.mode must be "normal" | "mute" | "bypass"' }
      node.mode = MODE_BY_NAME[raw]
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'deleteNode': {
      if (!findNode(state, cmd.target)) return { ok: false, reason: 'invalid', detail: `no node '${String(cmd.target)}'` }
      return {
        ok: true,
        template: { nodes: state.nodes.filter(n => n.id !== cmd.target), edges: state.edges.filter(e => e.source !== cmd.target && e.target !== cmd.target) },
        inverse: snapshot(),
      }
    }
    case 'restore': {
      const next: CanvasSnapshot = { ...state }
      if (cmd.args && 'nodes' in cmd.args) next.nodes = clone(cmd.args.nodes as NodeLite[])
      if (cmd.args && 'edges' in cmd.args) next.edges = clone(cmd.args.edges as EdgeLite[])
      return { ok: true, template: next, inverse: snapshot() }
    }
    default:
      return { ok: false, reason: 'out-of-vocabulary', detail: `unknown op '${cmd.op}'` }
  }
}

/** Graph-health postconditions: required inputs left unconnected, isolated
 *  nodes. Pure; warnings only. (Skips muted/bypassed nodes — they don't run.) */
export function verifyCanvas(s: CanvasSnapshot): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const linked = new Set<string>()
  for (const e of s.edges) { linked.add(e.source); linked.add(e.target) }
  for (const n of s.nodes) {
    if (n.mode === 2 || n.mode === 4) continue
    const conn = connectedInputs(s, n.id)
    for (const p of n.inputs) {
      if (!p.optional && !conn.has(p.name)) issues.push({ level: 'warn', target: n.id, message: `${nodeName(n)} has no “${p.name}” connected (required input)` })
    }
    if (s.nodes.length > 1 && !linked.has(n.id)) issues.push({ level: 'warn', target: n.id, message: `${nodeName(n)} is not connected to anything` })
  }
  return issues
}

/** Human-readable summary of a command for the proposal UI. */
export function summarizeCanvasChange(state: CanvasSnapshot, cmd: Command): { label: string; before: string; after: string } | null {
  const node = findNode(state, cmd.target)
  const name = node ? nodeName(node) : (cmd.target ?? '')
  const a = cmd.args ?? {}
  switch (cmd.op) {
    case 'setWidget': return { label: `${name} · ${String(a.name ?? '')}`, before: node ? String(node.widgets[String(a.name)] ?? '') : '', after: String(a.value ?? '') }
    case 'setMode': return { label: name, before: node && node.mode ? (MODE_LABEL[node.mode] ?? 'normal') : 'normal', after: String(a.mode ?? '') }
    case 'deleteNode': return { label: 'Delete', before: name, after: 'removed' }
    default: return { label: cmd.op, before: '', after: a ? JSON.stringify(a) : '' }
  }
}
