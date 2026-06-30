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
import { isTypeCompatible } from '~/lib/portIntent'
import type { CatalogEntry } from '~/lib/portIntentCatalog'

export interface PortLite { name: string; type: string; optional?: boolean }
export interface NodeLite {
  id: string
  nodeType: string
  title: string
  /** 0 = normal, 2 = muted, 4 = bypassed. */
  mode?: number
  /** widget name → current value (keys are the settable widget names). */
  widgets: Record<string, unknown>
  /** widget name → allowed values, for choice/combo widgets (sampler, scheduler,
   *  model, aspect ratio…). Lets the agent pick a valid option and lets setWidget
   *  reject an invented one that would break the run. */
  widgetOptions?: Record<string, string[]>
  inputs: PortLite[]
  outputs: PortLite[]
  /** True for the node the user currently has selected — what "this"/"it" refers to. */
  selected?: boolean
}
export interface EdgeLite { source: string; sourcePort?: string; target: string; targetPort?: string }
/** `catalog` = addable node types (trimmed by buildCatalog to what's relevant to
 *  the selection + the request), so the agent can pick a real nodeType and wire
 *  its real ports. Absent in read/edit-only contexts. */
export interface CanvasSnapshot { nodes: NodeLite[]; edges: EdgeLite[]; catalog?: CatalogEntry[] }

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
  { op: 'setWidget', hint: 'Set a node\'s parameter (widget) by name. target = node id; args: { name, value }. name MUST be one of that node\'s widget keys (see its "widgets"). For a CHOICE widget (the node lists its allowed values under "choices"), value MUST be EXACTLY one of those options — never invent one (a wrong sampler/model/scheduler name breaks the run). Numeric widgets take a number, not a string. e.g. steps → {name:"steps", value:30}. This is what "set the seed to 42", "30 steps", "use the euler sampler" mean.' },
  { op: 'setMode', hint: 'Mute or bypass a node (or re-enable it). target = node id; args: { mode: "normal" | "mute" | "bypass" }. Muted = does not run; bypass = passes input through.' },
  { op: 'addNode', hint: 'Add a NEW node from the palette. args: { nodeType (a "type" from the palette — NOT a display name), id (a placeholder you assign, e.g. "$new1", so you can connect it), widgetOverrides? (set the node\'s widgets, e.g. {prompt:"…"}) }. The palette is ranked by relevance and leads with the app\'s high-level GENERATORS (generate/edit/upscale/remove-background/restore an image, generate video/music/speech/3D, …) and STUDIOS (Gradient, Shader, Texture, Smart Layout, Frame/Compositor, Type). STRONGLY prefer a single such capability over wiring up low-level ComfyUI nodes. To act on an existing image, addNode the capability then connect the image to it. DIRECT GENERATION: if the user\'s whole message is just a DESCRIPTION of an image/scene with no command verb (e.g. "a neon cyberpunk alley, cinematic", "sunset over the ocean", "a golden retriever in a field"), treat it as "generate this": addNode GenerateImageNode with widgetOverrides {prompt: the full description}. Put any STYLE words ("watercolor", "vaporwave", "studio ghibli") into that prompt. Leave the model widget at its default unless the user names a specific model.' },
  { op: 'connect', hint: 'Wire two nodes. args: { from, to, fromPort?, toPort? }. from/to are node ids — existing ids OR a placeholder you gave a just-added node (e.g. "$new1"). Omit the ports to auto-pick the first type-compatible pair. When the request is "do X to this/it", "this" is the node with selected:true — emit addNode for the effect then connect { from: <selected id>, to: "$new1" }.' },
  { op: 'deleteNode', hint: 'Delete a node from the graph. target = node id. Edges touching it are removed too.' },
  { op: 'tuneNode', hint: 'Adjust the INTERNALS of an existing STUDIO node in place — its own knobs, NOT the graph. Supported now: a Frame (a node whose nodeType is "Compositor") — its background colour/gradient, the fill/colour/stroke of its layers, text content + style, and adding/removing/moving layers. target = that node id; args: { request: a plain-language instruction for the frame, e.g. "make the background blue", "add a centred white headline SALE", "make the title bigger" }. STRONGLY prefer this over adding a Gradient/Shader/Texture node when the user wants to change what is INSIDE an existing frame (a solid background colour is a frame background, not a new node).' },
  { op: 'restore', hint: 'internal — undo support.' },
]

/** Many nodes declare a long fan of inputs as "required" that are additive in
 *  practice — e.g. the Compositor's layer2…layer16 and every layerN_mask. Only the
 *  FIRST in a numbered series is genuinely needed, and masks are always optional.
 *  Treating these as optional keeps the model + the health readout from drowning in
 *  "no layerN connected" noise. */
function effectivelyOptional(p: PortLite): boolean {
  if (p.optional) return true
  if (p.type === 'MASK') return true // a mask is an optional treatment on almost every node
  if (/_mask$/i.test(p.name)) return true // masks are an optional treatment, never required
  const m = /^([a-z]+)(\d+)$/i.exec(p.name) // a numbered series like layer2 / image10
  return !!m && Number(m[2]) > 1 // only <prefix>1 is the required member of the series
}

/** Read the (selected) graph as an agent snapshot: one object per node, each with
 *  its settable widgets + which inputs are connected, plus a graph summary. */
export function describeCanvas(s: CanvasSnapshot): SurfaceSnapshot {
  const byId = new Map(s.nodes.map(n => [n.id, n]))
  const objects: SurfaceSnapshot['objects'] = s.nodes.map((n) => {
    const conn = connectedInputs(s, n.id)
    const cur: Record<string, unknown> = {
      nodeType: n.nodeType,
      inputs: n.inputs.map(p => ({ name: p.name, type: p.type, connected: conn.has(p.name), ...(effectivelyOptional(p) ? { optional: true } : {}) })),
      outputs: n.outputs.map(p => p.name),
    }
    if (Object.keys(n.widgets).length) cur.widgets = n.widgets
    // Surface allowed values for choice widgets so the model picks a real option
    // (truncated for the prompt; setWidget validates against the full list).
    if (n.widgetOptions) {
      const choices: Record<string, string[]> = {}
      for (const [k, opts] of Object.entries(n.widgetOptions)) {
        if (Array.isArray(opts) && opts.length) choices[k] = opts.length > 30 ? [...opts.slice(0, 30), `…(+${opts.length - 30})`] : opts
      }
      if (Object.keys(choices).length) cur.choices = choices
    }
    if (n.mode && MODE_LABEL[n.mode] && n.mode !== 0) cur.state = MODE_LABEL[n.mode]
    if (n.selected) cur.selected = true
    return { id: n.id, label: nodeName(n), type: 'node', current: cur }
  })
  const edgeList = s.edges.map((e) => {
    const a = byId.get(e.source), b = byId.get(e.target)
    return `${a ? nodeName(a) : e.source}${e.sourcePort ? `.${e.sourcePort}` : ''} → ${b ? nodeName(b) : e.target}${e.targetPort ? `.${e.targetPort}` : ''}`
  })
  objects.push({ id: 'graph', label: 'Graph', type: 'graph', current: { nodeCount: s.nodes.length, edgeCount: s.edges.length, connections: edgeList } })

  // Palette: the addable node types (for addNode/connect). Compact form — the
  // model needs each type's id, ports, and key widget names.
  if (s.catalog?.length) {
    objects.push({
      id: 'palette', label: 'Addable node types', type: 'palette',
      current: s.catalog.map(c => ({
        type: c.type,
        in: c.inputs.map(p => `${p.name}:${p.type}`),
        out: c.outputs.map(p => `${p.name}:${p.type}`),
        widgets: c.widgets.map(w => w.name),
      })),
    })
  }
  return { surface: 'canvas', objects, commands: CANVAS_COMMANDS }
}

/** Find a type-compatible (output, input) pair between two nodes, honouring any
 *  named ports the caller pinned. Returns null when nothing connects. */
function resolvePorts(from: NodeLite, to: NodeLite, fromPort?: string, toPort?: string): { out: PortLite; in: PortLite } | null {
  const outs = fromPort ? from.outputs.filter(p => p.name === fromPort) : from.outputs
  const ins = toPort ? to.inputs.filter(p => p.name === toPort) : to.inputs
  for (const o of outs) for (const i of ins) if (isTypeCompatible(o.type, i.type)) return { out: o, in: i }
  return null
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
      // Choice widgets: reject a value that isn't an allowed option (would break the run).
      const opts = node.widgetOptions?.[name]
      if (Array.isArray(opts) && opts.length && !opts.includes(cmd.args!.value as string)) {
        return { ok: false, reason: 'invalid', detail: `'${String(cmd.args!.value)}' is not a valid ${name}; choose one of: ${opts.slice(0, 20).join(', ')}${opts.length > 20 ? ', …' : ''}` }
      }
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
    case 'addNode': {
      const nodeType = cmd.args?.nodeType
      if (typeof nodeType !== 'string') return { ok: false, reason: 'invalid', detail: 'missing args.nodeType' }
      const entry = (state.catalog ?? []).find(c => c.type === nodeType)
      if (!entry) return { ok: false, reason: 'invalid', detail: `'${nodeType}' is not in the palette` }
      const id = (typeof cmd.args?.id === 'string' && cmd.args.id) ? cmd.args.id : `new_${state.nodes.length + 1}`
      if (state.nodes.some(n => n.id === id)) return { ok: false, reason: 'invalid', detail: `node id '${id}' already exists` }
      const widgets: Record<string, unknown> = {}
      for (const w of entry.widgets) widgets[w.name] = w.default
      const overrides = cmd.args?.widgetOverrides as Record<string, unknown> | undefined
      if (overrides) for (const [k, v] of Object.entries(overrides)) if (k in widgets) widgets[k] = v
      const node: NodeLite = {
        id, nodeType, title: entry.name, widgets,
        inputs: entry.inputs.map(p => ({ name: p.name, type: p.type })),
        outputs: entry.outputs.map(p => ({ name: p.name, type: p.type })),
      }
      return { ok: true, template: { ...state, nodes: [...state.nodes, node] }, inverse: snapshot() }
    }
    case 'connect': {
      const from = findNode(state, typeof cmd.args?.from === 'string' ? cmd.args.from : undefined)
      const to = findNode(state, typeof cmd.args?.to === 'string' ? cmd.args.to : undefined)
      if (!from) return { ok: false, reason: 'invalid', detail: `no source node '${String(cmd.args?.from)}'` }
      if (!to) return { ok: false, reason: 'invalid', detail: `no target node '${String(cmd.args?.to)}'` }
      if (from.id === to.id) return { ok: false, reason: 'invalid', detail: 'cannot connect a node to itself' }
      const fromPort = typeof cmd.args?.fromPort === 'string' ? cmd.args.fromPort : undefined
      const toPort = typeof cmd.args?.toPort === 'string' ? cmd.args.toPort : undefined
      if (fromPort && !from.outputs.some(p => p.name === fromPort)) return { ok: false, reason: 'invalid', detail: `'${fromPort}' is not an output of ${nodeName(from)}` }
      if (toPort && !to.inputs.some(p => p.name === toPort)) return { ok: false, reason: 'invalid', detail: `'${toPort}' is not an input of ${nodeName(to)}` }
      const pair = resolvePorts(from, to, fromPort, toPort)
      if (!pair) return { ok: false, reason: 'invalid', detail: `no type-compatible ports between ${nodeName(from)} and ${nodeName(to)}` }
      // One link per input slot — replace any existing edge into it.
      const edges = state.edges.filter(e => !(e.target === to.id && e.targetPort === pair.in.name))
      return { ok: true, template: { ...state, edges: [...edges, { source: from.id, sourcePort: pair.out.name, target: to.id, targetPort: pair.in.name }] }, inverse: snapshot() }
    }
    case 'deleteNode': {
      if (!findNode(state, cmd.target)) return { ok: false, reason: 'invalid', detail: `no node '${String(cmd.target)}'` }
      return {
        ok: true,
        template: { ...state, nodes: state.nodes.filter(n => n.id !== cmd.target), edges: state.edges.filter(e => e.source !== cmd.target && e.target !== cmd.target) },
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
      if (!effectivelyOptional(p) && !conn.has(p.name)) issues.push({ level: 'warn', target: n.id, message: `${nodeName(n)} has no “${p.name}” connected (required input)` })
    }
    // Only flag isolation for CONSUMERS (nodes with inputs). A pure source/generator
    // with no inputs is a legitimate standalone root mid-build, not an error.
    if (s.nodes.length > 1 && n.inputs.length > 0 && !linked.has(n.id)) issues.push({ level: 'warn', target: n.id, message: `${nodeName(n)} is not connected to anything` })
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
    case 'addNode': { const entry = (state.catalog ?? []).find(c => c.type === a.nodeType); return { label: 'Add node', before: '', after: entry?.name ?? String(a.nodeType ?? 'node') } }
    case 'connect': { const f = findNode(state, typeof a.from === 'string' ? a.from : undefined); const t = findNode(state, typeof a.to === 'string' ? a.to : undefined); return { label: 'Connect', before: '', after: `${f ? nodeName(f) : String(a.from)} → ${t ? nodeName(t) : String(a.to)}` } }
    case 'deleteNode': return { label: 'Delete', before: name, after: 'removed' }
    default: return { label: cmd.op, before: '', after: a ? JSON.stringify(a) : '' }
  }
}
