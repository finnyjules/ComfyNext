/**
 * Compositor (Frame) agent surface (F1, 2nd Phase-2 home). Wraps the local-layer
 * model (useCompositorLayers) so the agent can read a frame and change it through
 * named, invertible commands — the same shape as the Smart Layout surface.
 * Pure: every function takes a CompositorState and returns data or a fresh state.
 *
 * State = the local layers + the document background. The composable bridges this
 * to `node.data.properties.comfynext_localLayers` + the background, and runs the
 * media ops (generate/edit/remove-bg) which need async backend calls.
 */
import type { LocalLayer, LocalLayerKind, Paint, TextLayer } from '~/composables/useCompositorLayers'
import type { Command, CommandResult, CommandSpec, SurfaceSnapshot } from '~/lib/agent/commandSurface'
import { contrastRatio, parseColor, type LayoutIssue } from '~/lib/agent/verify'
import { SWISS_LIMITS } from '~/lib/agent/designPrinciples'

export interface CompositorState {
  layers: LocalLayer[]
  background?: Paint
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

/** A short, human-readable rendering of a Paint (colour / gradient / pattern). */
function paintLabel(p: Paint | undefined): string {
  if (p == null || p === '') return 'none'
  if (typeof p === 'string') return p
  if (typeof p === 'object' && 'type' in p) return (p as { type: string }).type === 'radial' ? 'radial gradient' : 'gradient'
  return 'fill'
}

/** Which field carries the FILL paint for each layer kind (null = no fill). */
function fillField(kind: LocalLayerKind): string | null {
  if (kind === 'text') return 'color'
  if (kind === 'image') return 'tint'
  if (kind === 'rect' || kind === 'ellipse' || kind === 'path') return 'fill'
  return null // line has stroke only
}

/** Which field carries the STROKE paint for each kind (null = no stroke). */
function strokeField(kind: LocalLayerKind): string | null {
  if (kind === 'text') return 'strokeColor'
  if (kind === 'image') return null
  return 'stroke' // rect/ellipse/path/line
}

/** Whitelisted common (transform) props every layer accepts. */
const COMMON_PROPS = new Set(['x', 'y', 'rotation', 'opacity', 'blend', 'visible', 'locked', 'skewX', 'skewY'])

/** The agent-facing command menu. Media ops (generateImage/editImage/
 *  removeImageBackground) are listed so the model can emit them; the composable
 *  resolves them async (they call the canvas tools). `restore` is internal. */
const COMPOSITOR_COMMANDS: CommandSpec[] = [
  { op: 'setLayerProps', hint: 'Move/transform a layer. target = layer id; args: { patch }. Keys: x, y (0..1 of canvas, layer CENTER), rotation (deg), opacity (0..1), blend ("normal"|"multiply"|"screen"|…), visible (bool), skewX/skewY (deg). e.g. centre = x:0.5,y:0.5.' },
  { op: 'setText', hint: 'Change a TEXT layer\'s copy. target = layer id; args: { text }. You may write/rewrite the copy yourself.' },
  { op: 'setTextStyle', hint: 'Style a TEXT layer. target = layer id; args: { patch }. Keys: fontFamily (ANY Google Font by name — for an Impact-style / bold condensed poster headline use "Anton" (also good: "Oswald", "Archivo Black", "Bebas Neue"); for body use "Inter"), fontWeight (100..900), fontSize (fraction of canvas WIDTH: body ~0.03, a normal heading ~0.08, a big headline ~0.15, a HUGE poster headline that fills the frame 0.25–0.45), align ("left"|"center"|"right"), lineHeight (multiplier), boxW (0..1 wrap width). For "huge headline" set fontSize ≥ 0.25 and usually fontWeight 700–900.' },
  { op: 'setFill', hint: 'Set a layer\'s FILL — text colour, shape fill, or image tint. target = layer id; args: { paint }. paint is a "#RRGGBB" colour OR a gradient object {type:"linear",angle,stops:[{offset,color}]} / {type:"radial",stops}. "none"/"" = no fill. This is what "make it blue", "give it a sunset gradient" mean.' },
  { op: 'setStroke', hint: 'Set a layer\'s STROKE/outline. target = layer id; args: { paint, width? }. paint as in setFill (or "none"); width is 0..1 of canvas width.' },
  { op: 'setSize', hint: 'Resize a layer. target = layer id; args: { w?, h?, scale? } (0..1 of canvas width; line uses w as length; path uses scale).' },
  { op: 'addLayer', hint: 'Add a NEW layer. args: { layer }. layer needs: kind ("text"|"rect"|"ellipse"|"line"), x, y (0..1, center). text also: text + you may set fontFamily/fontWeight/fontSize/color inline (a HUGE headline = fontSize 0.25–0.45, fontWeight 800; Impact-style font = "Anton"). Give the layer an id you choose so you can target it next. New layers land ON TOP by default — to put one BEHIND the image/other layers, follow with setLayerDepth …"back". (For images use generateImage.)' },
  { op: 'removeLayer', hint: 'Delete a layer by id. target = layer id.' },
  { op: 'setLayerDepth', hint: 'Change a layer\'s stacking depth (z-order). target = layer id; args: { to: "back" | "front" }. "back" puts it BEHIND every other layer including the connected/wired image — use this for "put the headline BEHIND the image". "front" brings it to the top.' },
  { op: 'setBackground', hint: 'Set the FRAME background that sits behind every layer. args: { paint } — a "#RRGGBB" colour, a gradient object, or "none". Use for "make the background blue / a sunset gradient".' },
  { op: 'generateImage', hint: 'Generate a PHOTOGRAPHIC/illustrative AI image and add it as a layer — "generate a picture of a dog", "add a city photo". Not for gradients/colours (use setBackground/setFill). args: { prompt (vivid), aspectRatio? }.' },
  { op: 'removeImageBackground', hint: 'Cut out the subject of an existing IMAGE layer (transparent background). target = image layer id.' },
  { op: 'editImage', hint: 'Edit an existing IMAGE layer from an instruction (Flux Kontext) — "make it brighter", "change the sky". target = image layer id; args: { instruction }.' },
]

function findLayer(s: CompositorState, id?: string): LocalLayer | undefined {
  return s.layers.find(l => l.id === id)
}

/** Read a Compositor frame as an agent snapshot: each layer + a document object. */
export function describeCompositor(state: CompositorState): SurfaceSnapshot {
  const objects: SurfaceSnapshot['objects'] = state.layers.map((l) => {
    const cur: Record<string, unknown> = { x: l.x, y: l.y, opacity: l.opacity }
    if (l.kind === 'text') { cur.text = l.text; cur.fontSize = l.fontSize; cur.color = paintLabel(l.color); cur.align = l.align }
    else if (l.kind === 'image') { cur.image = l.filename; if (l.tint) cur.tint = paintLabel(l.tint) }
    else if (l.kind === 'rect' || l.kind === 'ellipse') { cur.w = l.w; cur.h = l.h; cur.fill = paintLabel(l.fill) }
    else if (l.kind === 'line') { cur.length = l.w; cur.stroke = paintLabel(l.stroke) }
    else if (l.kind === 'path') { cur.fill = paintLabel(l.fill) }
    if (l.visible === false) cur.hidden = true
    return { id: l.id, label: l.kind === 'text' ? `“${l.text}”` : l.kind, type: l.kind, current: cur }
  })
  objects.push({
    id: 'document',
    label: 'Frame / document',
    type: 'document',
    current: {
      background: paintLabel(state.background),
      // The frame is a unit square in normalized coords: x/y/sizes are 0..1.
      coordinateSpace: 'normalized 0..1 (0,0 = top-left, 0.5,0.5 = centre)',
    },
  })
  return { surface: 'compositor', objects, commands: COMPOSITOR_COMMANDS }
}

/** Default layer factory so addLayer only needs kind + position + (text). */
function defaultLayer(kind: LocalLayerKind, id: string): Record<string, unknown> {
  const base = { id, kind, x: 0.5, y: 0.5, rotation: 0, opacity: 1 }
  if (kind === 'text') return { ...base, text: 'New text', fontFamily: 'Inter', fontWeight: 400, fontSize: 0.08, color: '#ffffff', align: 'center', lineHeight: 1.1, strokeColor: '', strokeWidth: 0 }
  if (kind === 'rect') return { ...base, w: 0.3, h: 0.2, fill: '#96b4ff', stroke: '', strokeWidth: 0, radius: 0 }
  if (kind === 'ellipse') return { ...base, w: 0.25, h: 0.25, fill: '#96b4ff', stroke: '', strokeWidth: 0 }
  if (kind === 'line') return { ...base, w: 0.3, stroke: '#ffffff', strokeWidth: 0.004 }
  if (kind === 'image') return { ...base, filename: '', w: 0.5, h: 0.5 }
  return base
}

/** Apply one command to a Compositor frame, returning the new state + an inverse.
 *  Pure — the input is never mutated. */
export function applyCompositorCommand(input: CompositorState, cmd: Command): CommandResult<CompositorState> {
  const state = clone(input)
  const snapshot = (): Command => ({ op: 'restore', args: { layers: clone(input.layers), background: clone(input.background) } })

  switch (cmd.op) {
    case 'setLayerProps': {
      const patch = cmd.args?.patch as Record<string, unknown> | undefined
      if (!patch || typeof patch !== 'object') return { ok: false, reason: 'invalid', detail: 'missing args.patch' }
      const bad = Object.keys(patch).filter(k => !COMMON_PROPS.has(k))
      if (bad.length) return { ok: false, reason: 'invalid', detail: `prop(s) not valid: ${bad.join(', ')}` }
      const layer = findLayer(state, cmd.target)
      if (!layer) return { ok: false, reason: 'invalid', detail: `no layer '${String(cmd.target)}'` }
      Object.assign(layer, clone(patch))
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'setText': {
      const text = cmd.args?.text
      if (typeof text !== 'string') return { ok: false, reason: 'invalid', detail: 'missing args.text' }
      const layer = findLayer(state, cmd.target)
      if (!layer) return { ok: false, reason: 'invalid', detail: `no layer '${String(cmd.target)}'` }
      if (layer.kind !== 'text') return { ok: false, reason: 'invalid', detail: `layer '${String(cmd.target)}' is not text` }
      layer.text = text
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'setTextStyle': {
      const patch = cmd.args?.patch as Record<string, unknown> | undefined
      if (!patch || typeof patch !== 'object') return { ok: false, reason: 'invalid', detail: 'missing args.patch' }
      const allowed = new Set(['fontFamily', 'fontWeight', 'fontSize', 'align', 'lineHeight', 'boxW'])
      const bad = Object.keys(patch).filter(k => !allowed.has(k))
      if (bad.length) return { ok: false, reason: 'invalid', detail: `text style key(s) not valid: ${bad.join(', ')}` }
      const layer = findLayer(state, cmd.target)
      if (!layer || layer.kind !== 'text') return { ok: false, reason: 'invalid', detail: `no text layer '${String(cmd.target)}'` }
      Object.assign(layer, clone(patch))
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'setFill': {
      const paint = cmd.args?.paint as Paint | undefined
      if (paint == null || (typeof paint !== 'string' && typeof paint !== 'object')) return { ok: false, reason: 'invalid', detail: 'missing args.paint' }
      const layer = findLayer(state, cmd.target)
      if (!layer) return { ok: false, reason: 'invalid', detail: `no layer '${String(cmd.target)}'` }
      const field = fillField(layer.kind)
      if (!field) return { ok: false, reason: 'invalid', detail: `${layer.kind} layers have no fill (use setStroke)` }
      ;(layer as unknown as Record<string, unknown>)[field] = clone(paint)
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'setStroke': {
      const paint = cmd.args?.paint as Paint | undefined
      if (paint == null) return { ok: false, reason: 'invalid', detail: 'missing args.paint' }
      const layer = findLayer(state, cmd.target)
      if (!layer) return { ok: false, reason: 'invalid', detail: `no layer '${String(cmd.target)}'` }
      const field = strokeField(layer.kind)
      if (!field) return { ok: false, reason: 'invalid', detail: `${layer.kind} layers have no stroke` }
      ;(layer as unknown as Record<string, unknown>)[field] = clone(paint)
      if (typeof cmd.args?.width === 'number') (layer as unknown as Record<string, unknown>).strokeWidth = cmd.args.width
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'setSize': {
      const layer = findLayer(state, cmd.target)
      if (!layer) return { ok: false, reason: 'invalid', detail: `no layer '${String(cmd.target)}'` }
      const a = cmd.args ?? {}
      const L = layer as unknown as Record<string, unknown>
      let touched = false
      if (typeof a.w === 'number' && ('w' in layer)) { L.w = a.w; touched = true }
      if (typeof a.h === 'number' && (layer.kind === 'rect' || layer.kind === 'ellipse' || layer.kind === 'image')) { L.h = a.h; touched = true }
      if (typeof a.scale === 'number' && layer.kind === 'path') { L.scale = a.scale; touched = true }
      if (!touched) return { ok: false, reason: 'invalid', detail: `no resizable dimension for ${layer.kind} in args` }
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'addLayer': {
      const raw = cmd.args?.layer as Record<string, unknown> | undefined
      const kind = raw?.kind as LocalLayerKind | undefined
      // 'image' is allowed for the composable's media path (generateImage) — it
      // needs a filename; the model is steered to generateImage via the hint.
      if (!raw || !kind || !['text', 'rect', 'ellipse', 'line', 'image'].includes(kind)) return { ok: false, reason: 'invalid', detail: 'layer needs a kind of text|rect|ellipse|line' }
      if (kind === 'image' && typeof raw.filename !== 'string') return { ok: false, reason: 'invalid', detail: 'image layer needs a filename' }
      const id = typeof raw.id === 'string' ? raw.id : `l_${state.layers.length + 1}_${kind}`
      if (state.layers.some(l => l.id === id)) return { ok: false, reason: 'invalid', detail: `layer id '${id}' already exists` }
      const layer = { ...defaultLayer(kind, id), ...clone(raw), id, kind } as unknown as LocalLayer
      return { ok: true, template: { ...state, layers: [...state.layers, layer] }, inverse: snapshot() }
    }
    case 'removeLayer': {
      if (!state.layers.some(l => l.id === cmd.target)) return { ok: false, reason: 'invalid', detail: `no layer '${String(cmd.target)}'` }
      return { ok: true, template: { ...state, layers: state.layers.filter(l => l.id !== cmd.target) }, inverse: snapshot() }
    }
    case 'setLayerDepth': {
      // Reorder among the LOCAL layers; the composable also writes the unified
      // wired+local stack order so "back" sits behind a connected image too.
      const to = String(cmd.args?.to ?? '')
      if (to !== 'back' && to !== 'front') return { ok: false, reason: 'invalid', detail: 'args.to must be "back" | "front"' }
      const idx = state.layers.findIndex(l => l.id === cmd.target)
      if (idx < 0) return { ok: false, reason: 'invalid', detail: `no layer '${String(cmd.target)}'` }
      const [moved] = state.layers.splice(idx, 1)
      if (to === 'back') state.layers.unshift(moved!)
      else state.layers.push(moved!)
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'setBackground': {
      const paint = cmd.args?.paint
      if (paint == null) return { ok: false, reason: 'invalid', detail: 'missing args.paint' }
      const bg = (paint === 'none' || paint === '') ? undefined : clone(paint as Paint)
      return { ok: true, template: { ...state, background: bg }, inverse: snapshot() }
    }
    case 'setImage': { // internal — used by the composable's edit/remove-bg media path
      const filename = cmd.args?.filename
      if (typeof filename !== 'string') return { ok: false, reason: 'invalid', detail: 'missing args.filename' }
      const layer = findLayer(state, cmd.target)
      if (!layer || layer.kind !== 'image') return { ok: false, reason: 'invalid', detail: `no image layer '${String(cmd.target)}'` }
      ;(layer as unknown as Record<string, unknown>).filename = filename
      return { ok: true, template: state, inverse: snapshot() }
    }
    case 'restore': {
      const next: CompositorState = { ...state }
      if ('layers' in (cmd.args ?? {})) next.layers = clone(cmd.args!.layers as LocalLayer[])
      if ('background' in (cmd.args ?? {})) next.background = clone(cmd.args!.background as Paint | undefined)
      return { ok: true, template: next, inverse: snapshot() }
    }
    default:
      return { ok: false, reason: 'out-of-vocabulary', detail: `unknown op '${cmd.op}'` }
  }
}

/** Postcondition checks on a frame (parity with Smart Layout's verify): a layer
 *  off-canvas, text too small or low-contrast against the background, a busy
 *  palette, or an all-centred composition (un-Swiss). Pure; warnings only. */
export function verifyCompositor(state: CompositorState): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const bg = typeof state.background === 'string' ? parseColor(state.background) : null
  const colours = new Set<string>()
  const addColour = (p?: Paint) => { if (typeof p === 'string') { const c = parseColor(p); if (c) colours.add(`${c.r},${c.g},${c.b}`) } }
  addColour(state.background)
  const texts: TextLayer[] = []

  for (const l of state.layers) {
    if (l.visible === false) continue
    const name = l.kind === 'text' ? `“${(l as TextLayer).text}”` : l.kind
    if (l.x < -0.02 || l.x > 1.02 || l.y < -0.02 || l.y > 1.02) {
      issues.push({ level: 'warn', target: l.id, message: `${name} is off-canvas (its centre is outside the frame)` })
    }
    if (l.kind === 'text') {
      const t = l as TextLayer
      texts.push(t)
      addColour(t.color)
      if (t.fontSize < 0.018) issues.push({ level: 'warn', target: l.id, message: `${name} is very small — likely unreadable` })
      const txt = typeof t.color === 'string' ? parseColor(t.color) : null
      if (txt && bg) {
        const ratio = contrastRatio(txt, bg)
        if (ratio < 2.5) issues.push({ level: 'warn', target: l.id, message: `${name} may be hard to read — low contrast (${ratio.toFixed(1)}:1) on the background` })
      }
    } else if (l.kind === 'rect' || l.kind === 'ellipse' || l.kind === 'path') {
      addColour((l as unknown as { fill?: Paint }).fill)
    }
  }
  if (colours.size > SWISS_LIMITS.maxColours) {
    issues.push({ level: 'warn', message: `${colours.size} colours in use — Swiss style favours restraint (one accent)` })
  }
  if (texts.length >= 2 && texts.every(t => t.align === 'center')) {
    issues.push({ level: 'warn', message: 'all text is centred — Swiss style favours a flush-left, asymmetric composition' })
  }
  return issues
}

/** Human-readable summary of a command for the proposal UI. */
export function summarizeCompositorChange(state: CompositorState, cmd: Command): { label: string; before: string; after: string } | null {
  const layer = findLayer(state, cmd.target)
  const name = layer ? (layer.kind === 'text' ? `“${layer.text}”` : layer.kind) : (cmd.target ?? '')
  const a = cmd.args ?? {}
  switch (cmd.op) {
    case 'setText': return { label: name || 'Text', before: layer && layer.kind === 'text' ? layer.text : '', after: String(a.text ?? '') }
    case 'setFill': return { label: `${name} fill`, before: layer ? paintLabel((layer as unknown as Record<string, Paint>)[fillField(layer.kind) ?? ''] as Paint) : '', after: paintLabel(a.paint as Paint) }
    case 'setStroke': return { label: `${name} stroke`, before: '', after: paintLabel(a.paint as Paint) }
    case 'setTextStyle': { const p = (a.patch ?? {}) as Record<string, unknown>; return { label: `${name} type`, before: '', after: Object.keys(p).map(k => `${k}: ${String(p[k])}`).join(', ') } }
    case 'setLayerProps': { const p = (a.patch ?? {}) as Record<string, unknown>; return { label: name || 'Layer', before: '', after: Object.keys(p).map(k => `${k}: ${String(p[k])}`).join(', ') } }
    case 'setSize': return { label: `${name} size`, before: '', after: ['w', 'h', 'scale'].filter(k => k in a).map(k => `${k}: ${String((a as Record<string, unknown>)[k])}`).join(', ') }
    case 'addLayer': { const l = a.layer as { kind?: string; text?: string } | undefined; return { label: 'Add layer', before: '', after: l?.kind === 'text' ? `text “${String(l.text ?? '')}”` : (l?.kind ?? 'layer') } }
    case 'removeLayer': return { label: 'Remove layer', before: name, after: 'deleted' }
    case 'setLayerDepth': return { label: `${name} order`, before: '', after: String(a.to ?? '') === 'back' ? 'behind everything' : 'bring to front' }
    case 'setBackground': return { label: 'Frame background', before: paintLabel(state.background), after: paintLabel(a.paint as Paint) }
    case 'generateImage': return { label: 'Add image', before: '', after: String(a.prompt ?? 'generated') }
    case 'removeImageBackground': return { label: name, before: '', after: 'cut out' }
    case 'editImage': return { label: name, before: '', after: String(a.instruction ?? 'edited') }
    default: return { label: cmd.op, before: '', after: a ? JSON.stringify(a) : '' }
  }
}
