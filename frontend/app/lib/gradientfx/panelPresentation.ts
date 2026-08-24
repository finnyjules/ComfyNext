import type { ControlSpec } from '~/lib/spacetype/effect'
import { POST_SECTIONS } from '~/lib/studio/post/controls'
import {
  CURVE_DEFAULTS, DEFAULT_CENTER, DEFAULT_FLOW, DEFAULT_LIGHT, RAMP_DEFAULTS,
  effectiveLayout, type GradientConfig,
} from './types'
import { GRADIENT_CONTROLS, gradientPanelOverride, gradientPanelVisible, type GradientControl } from './controls'

/**
 * PRESENTATION layer between `GRADIENT_CONTROLS` and the inspector panel.
 *
 * The schema's `group` strings and declaration order are the AGENT/MOTION contract:
 * `gradientAgentControls` emits in group order and `animatableTargets` derives an
 * ordered path array, both pinned by frozen snapshots. The shipped inspector grouped
 * and ordered its rows differently — one "Color" card holding the ramp axis, the stop
 * repeater and six `Layer` rows; "Liquid" split across two cards; Relief and Shape in
 * a different row order.
 *
 * So the surface hands the panel a remapped COPY rather than the schema itself. Keys
 * are never touched — only `group`, row order, `label`/`max` (the three dynamic
 * captions) and `default` (the reset target the template declared inline).
 *
 * `tests/unit/gradient-panel-parity.unit.spec.ts` asserts BOTH halves: the schema
 * derivation against the shipped row set, and this remap against the shipped card
 * titles and within-card order.
 */

/** On-screen card order for the DESIGN half — the order the shipped panel drew its
 *  StudioSections in. The post stack's own sections follow (POST_SECTIONS). */
export const GRADIENT_PANEL_ORDER = [
  'Canvas', 'Color', 'Curve', 'Flow', 'Depth & light', 'Liquid surface',
  'Mesh', 'Relief', 'Focus', 'Layer', 'Shape',
] as const

/** Design cards + the shared post stack, as StudioControlPanel's `order` prop. */
export const GRADIENT_PANEL_SECTIONS = [...GRADIENT_PANEL_ORDER, ...POST_SECTIONS] as readonly string[]

const POST_GROUPS = new Set<string>(POST_SECTIONS)

export const isPostGroup = (group: string | undefined): boolean => POST_GROUPS.has(String(group ?? ''))

/** The `Liquid` group's two shipped cards, split by key. */
const DEPTH_AND_LIGHT = new Set([
  'flow.depth', 'flow.highlights', 'flow.shadows', 'flow.foldScale', 'flow.gloss',
])

/** The `Layer` group's rows that the shipped panel drew inside the "Color" card. */
const COLOR_CARD_LAYER_ROWS = new Set([
  'layer.color.repeat', 'layer.color.repeatCount', 'layer.color.falloff',
  'layer.color.steps', 'layer.color.hueDrift', 'layer.color.hueRotate',
])

const GROUP_TITLE: Record<string, string> = {
  Canvas: 'Canvas',
  Gradient: 'Color',
  Colours: 'Color',
  Curve: 'Curve',
  Flow: 'Flow',
  Mesh: 'Mesh',
  Relief: 'Relief',
  Focus: 'Focus',
  Shape: 'Shape',
}

/** Schema group (plus, for the two split groups, the key) -> shipped card title. */
export function panelSectionTitle(c: Pick<ControlSpec, 'key' | 'group'>): string {
  const group = String(c.group ?? '')
  if (group === 'Liquid') return DEPTH_AND_LIGHT.has(c.key) ? 'Depth & light' : 'Liquid surface'
  if (group === 'Layer') return COLOR_CARD_LAYER_ROWS.has(c.key) ? 'Color' : 'Layer'
  return GROUP_TITLE[group] ?? group
}

// ── bespoke-block anchors ────────────────────────────────────────────────────

/**
 * A block the schema never described — a repeater, a button grid, a caption. It has
 * no value and no binding; it exists so the surface can hand the panel a
 * `#control-<key>` slot that lands at the exact position the shipped card had it.
 * `#section-<Title>` cannot serve: it renders at the END of a card's body.
 */
export interface PanelAnchor {
  key: string
  label: string
  group: string
  visible: (cfg: GradientConfig, activeLayer: number) => boolean
}

const BANDED = ['linear', 'radial', 'orbit', 'stack']
const activeIs = (cfg: GradientConfig, i: number, kinds: string[]) => kinds.includes(effectiveLayout(cfg, i))
const activeBanded = (cfg: GradientConfig, i: number) => activeIs(cfg, i, BANDED)

export const PANEL_ANCHORS: readonly PanelAnchor[] = [
  { key: 'ui.color.stops', label: 'Colours', group: 'Color', visible: () => true },
  {
    key: 'ui.color.direction', label: 'Gradient direction', group: 'Color',
    visible: (cfg, i) => activeBanded(cfg, i) && !activeIs(cfg, i, ['stack']),
  },
  { key: 'ui.flow.intro', label: 'Flow', group: 'Flow', visible: () => true },
  {
    key: 'ui.liquid.presets', label: 'Presets', group: 'Depth & light',
    visible: (cfg, i) => activeIs(cfg, i, ['liquid']),
  },
  {
    key: 'ui.liquid.intro', label: 'Liquid surface', group: 'Liquid surface',
    visible: (cfg, i) => activeIs(cfg, i, ['liquid']),
  },
  {
    key: 'ui.mesh.points', label: 'Points', group: 'Mesh',
    visible: (cfg, i) => activeIs(cfg, i, ['mesh']),
  },
  {
    key: 'ui.shape.kind', label: 'Shape kind', group: 'Shape',
    visible: (cfg, i) => activeBanded(cfg, i) && !activeIs(cfg, i, ['stack']),
  },
  {
    key: 'ui.shape.ringShape', label: 'Ring shape', group: 'Shape',
    visible: (cfg, i) => activeBanded(cfg, i) && activeIs(cfg, i, ['stack']),
  },
  {
    key: 'ui.shape.direction', label: 'Direction', group: 'Shape',
    visible: (cfg, i) => activeBanded(cfg, i) && !activeIs(cfg, i, ['stack', 'radial', 'orbit']),
  },
  {
    key: 'ui.shape.mirror', label: 'Mirror', group: 'Shape',
    visible: (cfg, i) => activeBanded(cfg, i) && !activeIs(cfg, i, ['stack']),
  },
]

export const PANEL_ANCHOR_KEYS: ReadonlySet<string> = new Set(PANEL_ANCHORS.map((a) => a.key))

// ── row order ────────────────────────────────────────────────────────────────

/** Shape's shipped order moves one row: on a `noise` shape the template drew Scrub
 *  in the noise branch (right after Detail); on every other kind the only Scrub was
 *  the radial tail's "Scrub / rotate", after Sweep. */
const SHAPE_HEAD = [
  'ui.shape.kind', 'layer.shape.count',
  'layer.shape.rotStep', 'layer.shape.pivot', 'layer.shape.ringScale', 'ui.shape.ringShape',
  'layer.shape.peaks', 'layer.shape.phase', 'layer.shape.detail',
]
const SHAPE_TAIL = [
  'layer.shape.valley', 'layer.shape.minDepth', 'layer.shape.curveExp',
  'layer.shape.jitter', 'layer.shape.gap', 'layer.shape.rounding', 'layer.shape.sweep',
]
const SHAPE_FOOT = ['ui.shape.direction', 'ui.shape.mirror']

const shapeOrder = (noise: boolean): string[] =>
  noise
    ? [...SHAPE_HEAD, 'layer.shape.scrub', ...SHAPE_TAIL, ...SHAPE_FOOT]
    : [...SHAPE_HEAD, ...SHAPE_TAIL, 'layer.shape.scrub', ...SHAPE_FOOT]

const ROW_ORDER: Record<string, readonly string[]> = {
  Canvas: [
    'canvas.aspect', 'canvas.layout', 'canvas.margin', 'canvas.innerRadius',
    'canvas.center.x', 'canvas.center.y', 'canvas.background',
  ],
  Color: [
    'layer.ramp.angle', 'layer.ramp.radius', 'layer.ramp.shape', 'layer.ramp.sweep', 'layer.ramp.closeLoop',
    'ui.color.stops', 'ui.color.direction',
    'layer.color.steps', 'layer.color.hueDrift', 'layer.color.hueRotate',
    'layer.color.repeat', 'layer.color.repeatCount', 'layer.color.falloff',
  ],
  Curve: [
    'layer.curve.mode', 'layer.curve.shape',
    'layer.curve.start.x', 'layer.curve.start.y', 'layer.curve.end.x', 'layer.curve.end.y',
    'layer.curve.curvature', 'layer.curve.bend',
    'layer.curve.waves', 'layer.curve.phase', 'layer.curve.width',
  ],
  Flow: [
    'ui.flow.intro', 'flow.angle', 'flow.noiseScale', 'flow.intensity',
    'flow.distortion', 'flow.detail', 'flow.swirl', 'flow.speed',
  ],
  'Depth & light': [
    'ui.liquid.presets', 'flow.depth', 'flow.highlights', 'flow.shadows', 'flow.foldScale', 'flow.gloss',
  ],
  'Liquid surface': [
    'ui.liquid.intro', 'flow.veins', 'flow.veinScale', 'flow.ripple', 'flow.refract', 'flow.viscosity',
  ],
  Mesh: ['ui.mesh.points', 'layer.mesh.softness', 'layer.mesh.contrast', 'layer.mesh.blur', 'layer.mesh.drift'],
  Relief: ['relief.relief', 'relief.light.azimuth', 'relief.light.elevation'],
  Focus: ['focus.blur', 'focus.shape', 'focus.radius', 'focus.softness', 'focus.x', 'focus.y', 'focus.angle'],
  Layer: ['layer.blend', 'layer.opacity'],
}

// ── absent-field fallbacks ───────────────────────────────────────────────────

/**
 * Config fields that are OPTIONAL on the schema. The shipped rows read them through
 * `?? default` proxies (`layer.ramp?.angle ?? 90`); the dotted params proxy returns
 * `undefined` instead, which a numeric row renders as NaN. Same table supplies the
 * double-click reset target the template declared as `:default`.
 */
export const PANEL_FALLBACKS: Readonly<Record<string, string | number | boolean>> = {
  'canvas.center.x': DEFAULT_CENTER.x,
  'canvas.center.y': DEFAULT_CENTER.y,
  'relief.light.azimuth': DEFAULT_LIGHT.azimuth,
  'relief.light.elevation': DEFAULT_LIGHT.elevation,
  'layer.ramp.angle': RAMP_DEFAULTS.angle,
  'layer.ramp.radius': RAMP_DEFAULTS.radius,
  'layer.ramp.shape': RAMP_DEFAULTS.shape,
  'layer.ramp.sweep': RAMP_DEFAULTS.sweep,
  'layer.ramp.closeLoop': RAMP_DEFAULTS.closeLoop,
  'layer.curve.mode': CURVE_DEFAULTS.mode,
  'layer.curve.shape': CURVE_DEFAULTS.shape,
  'layer.curve.start.x': CURVE_DEFAULTS.start.x,
  'layer.curve.start.y': CURVE_DEFAULTS.start.y,
  'layer.curve.end.x': CURVE_DEFAULTS.end.x,
  'layer.curve.end.y': CURVE_DEFAULTS.end.y,
  'layer.curve.curvature': CURVE_DEFAULTS.curvature,
  'layer.curve.bend': CURVE_DEFAULTS.bend,
  'layer.curve.waves': CURVE_DEFAULTS.waves,
  'layer.curve.phase': CURVE_DEFAULTS.phase,
  'layer.curve.width': CURVE_DEFAULTS.width,
  'flow.speed': DEFAULT_FLOW.speed ?? 0,
  'flow.gloss': DEFAULT_FLOW.gloss ?? 0,
  'flow.swirl': DEFAULT_FLOW.swirl ?? 0,
  'flow.veins': DEFAULT_FLOW.veins ?? 0,
  'flow.veinScale': DEFAULT_FLOW.veinScale ?? 35,
  'flow.ripple': DEFAULT_FLOW.ripple ?? 0,
  'flow.refract': DEFAULT_FLOW.refract ?? 0,
  'flow.viscosity': DEFAULT_FLOW.viscosity ?? 0,
  'layer.mesh.blur': 0,
  'layer.color.repeat': 'once',
  'layer.color.repeatCount': 4,
  'layer.color.falloff': 'linear',
  'layer.shape.rotStep': 8,
  'layer.shape.pivot': 0.1,
  'layer.shape.ringScale': 1,
}

/** Reader wrapper for StudioControlPanel's `value` prop. */
export function panelValue(key: string, raw: string | number | boolean | undefined): string | number | boolean {
  if (raw !== undefined && raw !== null) return raw
  return PANEL_FALLBACKS[key] ?? 0
}

/** Container objects the shipped rows seeded WHOLE before writing one field
 *  (`onRamp`/`onCurve`/the `??=` proxies). A dotted write creates `{}`, leaving the
 *  siblings undefined, and the renderer's `L.ramp ?? RAMP_DEFAULTS` then no longer
 *  fires — so the other axis fields read as undefined instead of defaulted.
 *
 *  WHY `flow.*` IS NOT IN THIS TABLE. `flow` is the fourth optional container with a
 *  `?? DEFAULT_FLOW` fallback (`flowOf`), so on the face of it a `flow.speed` write into
 *  an absent `flow` would create the same partial `{ speed }` — worse than the shipped
 *  rows, which held a `??=` proxy that simply no-op'd when `flow` was missing. It is safe
 *  because `config.value` is only ever assigned from two kinds of source, and BOTH
 *  guarantee a whole `flow`: the load path runs `ensureConfigDefaults` (types.ts — `if
 *  (!cfg.flow) cfg.flow = { ...DEFAULT_FLOW }`), and every randomize.ts builder sets
 *  `flow` outright (`reroll` ends with the same explicit `if (!next.flow)` guard).
 *  That guarantee is LOAD-BEARING, not incidental: a future config source that skips
 *  both would not merely leave the Flow rows reading defaults — it would let one row's
 *  write bake a partial flow object that permanently defeats `flowOf`'s fallback. Add
 *  `flow` here rather than relaxing it. */
export function panelWriteSeed(key: string): { path: 'ramp' | 'curve' | 'center' | 'light' | 'mesh' } | null {
  if (key.startsWith('layer.ramp.')) return { path: 'ramp' }
  if (key.startsWith('layer.curve.')) return { path: 'curve' }
  if (key.startsWith('canvas.center.')) return { path: 'center' }
  if (key.startsWith('relief.light.')) return { path: 'light' }
  if (key.startsWith('layer.mesh.')) return { path: 'mesh' }
  return null
}

// ── multi-layer gating ───────────────────────────────────────────────────────

/**
 * A control's `when` reads `cfg.canvas.layout` and always will: `visibleGradientControls`
 * is ALSO the agent's vocabulary and motion's animatable-target list, both pinned by
 * frozen snapshots, and both are canvas-level questions. The PANEL's question is
 * narrower and has three different answers, which the deleted template answered with
 * three computed families (9c20f8b72 `GradientStudioSurface.vue` lines 65-90):
 *
 *   is*    the ACTIVE layer's layout (`activeLayout = effectiveLayout(cfg, activeLayer)`)
 *          — every per-layer family: the Gradient axis, the Color card's layout gates,
 *          Curve, Mesh, Liquid and Shape. These rows address `layer.*`, and the params
 *          proxy resolves `layer.` against the SELECTED layer, so gating them on the
 *          canvas layout both hides rows that render (a curve layer over a ramp canvas)
 *          and draws rows that don't (a Curve card over a stack layer, whose writes land
 *          in `layers[n].curve` where nothing reads them).
 *   any*   ANY layer (`anyBanded` / `anyInnerRadius` / `anyCenter`) — the GLOBAL canvas
 *          rows. `canvas.margin`, `canvas.innerRadius` and `canvas.center.*` live on the
 *          whole gradient, so selecting a layer that ignores them must not hide them
 *          from the layer that doesn't.
 *   base*  LAYER 0 (`baseBanded` / `baseLiquid`) — the rows whose uniform the shader only
 *          applies under layer 0's layout: the relief light, and the four global liquid
 *          uniforms (highlights/shadows/gloss/ripple).
 *
 * The `is*` family is reproduced by evaluating `when` against a SHADOW config whose
 * canvas layout (and layer 0) is the active layer's; the other two are explicit rules
 * below, because they are not a question any single-layout config can express.
 * Pinned by the multi-layer scenarios in tests/unit/gradient-panel-parity.unit.spec.ts.
 */
const someLayerIs = (cfg: GradientConfig, kinds: string[]): boolean =>
  (cfg.layers ?? []).some((_l, i) => kinds.includes(effectiveLayout(cfg, i)))
const baseIs = (cfg: GradientConfig, kinds: string[]): boolean => kinds.includes(effectiveLayout(cfg, 0))

/**
 * The `any*` / `base*` rows, keyed by control. A rule is the WHOLE answer for its row
 * (it replaces both the schema `when` and `gradientPanelVisible`) — a shadow-config
 * `when` would re-impose the active layer's reading and undo the point.
 */
const GLOBAL_ROW_RULES: Record<string, (cfg: GradientConfig, activeLayer: number) => boolean> = {
  // anyBanded / anyInnerRadius / anyCenter. Note innerRadius is one layout narrower
  // than center: conic reads u_center but never u_innerRadius.
  'canvas.margin': (cfg) => someLayerIs(cfg, BANDED),
  'canvas.innerRadius': (cfg) => someLayerIs(cfg, ['radial', 'orbit', 'radialRamp']),
  'canvas.center.x': (cfg) => someLayerIs(cfg, ['radial', 'orbit', 'radialRamp', 'conic']),
  'canvas.center.y': (cfg) => someLayerIs(cfg, ['radial', 'orbit', 'radialRamp', 'conic']),
  // baseBanded — shaders.ts gates u_light on `u_layout < 3.5`, i.e. layer 0's layout.
  'relief.relief': (cfg) => baseIs(cfg, BANDED),
  'relief.light.azimuth': (cfg) => baseIs(cfg, BANDED),
  'relief.light.elevation': (cfg) => baseIs(cfg, BANDED),
  // isLiquid AND baseLiquid — the template drew these inside the liquid-only cards
  // (active layer) behind a second `v-if="baseLiquid"`: the uniforms are global and
  // only applied under layer 0's layout.
  'flow.highlights': (cfg, i) => activeIs(cfg, i, ['liquid']) && baseIs(cfg, ['liquid']),
  'flow.shadows': (cfg, i) => activeIs(cfg, i, ['liquid']) && baseIs(cfg, ['liquid']),
  'flow.gloss': (cfg, i) => activeIs(cfg, i, ['liquid']) && baseIs(cfg, ['liquid']),
  'flow.ripple': (cfg, i) => activeIs(cfg, i, ['liquid']) && baseIs(cfg, ['liquid']),
}

/**
 * `cfg` as the per-layer families see it: the ACTIVE layer's effective layout standing
 * in for the canvas layout, and the active layer standing in at index 0 for the handful
 * of `when` clauses that read `layers[0]` for per-layer STATE (curve shape/mode, colour
 * repeat, shape kind) rather than layout. Both substitutions say the same thing — "this
 * row is about the selected layer" — and neither is visible outside this module: only
 * the `when` predicates and `gradientPanelVisible` ever see it.
 */
function shadowConfig(cfg: GradientConfig, activeLayer: number): GradientConfig {
  const layout = effectiveLayout(cfg, activeLayer)
  const active = cfg.layers?.[activeLayer]
  const layers = active && activeLayer > 0 ? [active, ...cfg.layers.slice(1)] : cfg.layers
  return { ...cfg, canvas: { ...cfg.canvas, layout }, layers }
}

/** The panel's whole visibility answer for one schema row. */
function panelRowVisible(c: GradientControl, cfg: GradientConfig, activeLayer: number, shadow: GradientConfig): boolean {
  const rule = GLOBAL_ROW_RULES[c.key]
  if (rule) return rule(cfg, activeLayer)
  if (c.when && !c.when(shadow)) return false
  return gradientPanelVisible(c, shadow, activeLayer)
}

// ── the remap ────────────────────────────────────────────────────────────────

const inRange = (c: ControlSpec): boolean => {
  if (c.kind !== 'slider') return true
  const d = (c as { default?: number }).default
  return d != null && d >= c.min && d <= c.max
}

function withPresentation(c: GradientControl, cfg: GradientConfig, activeLayer: number): ControlSpec {
  const out: Record<string, unknown> = {
    ...c, group: panelSectionTitle(c), ...(gradientPanelOverride(c, cfg, activeLayer) ?? {}),
  }
  const fallback = PANEL_FALLBACKS[c.key]
  if (fallback !== undefined) out.default = fallback
  else if (!inRange(out as unknown as ControlSpec)) delete out.default
  return out as unknown as ControlSpec
}

function sortWithinCards(rows: ControlSpec[], noiseShape: boolean): ControlSpec[] {
  const buckets = new Map<string, ControlSpec[]>()
  for (const c of rows) {
    const g = String(c.group ?? '')
    if (!buckets.has(g)) buckets.set(g, [])
    buckets.get(g)!.push(c)
  }
  const out: ControlSpec[] = []
  for (const [group, list] of buckets) {
    const order = group === 'Shape' ? shapeOrder(noiseShape) : ROW_ORDER[group]
    if (order) {
      const at = new Map(order.map((k, i) => [k, i]))
      list.sort((a, b) => (at.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (at.get(b.key) ?? Number.MAX_SAFE_INTEGER))
    }
    out.push(...list)
  }
  return out
}

/**
 * The panel's control list: every row the shipped inspector drew for this config,
 * carrying its shipped card title, caption, bounds and reset target, in its shipped
 * within-card order, with the bespoke-block anchors spliced in at their positions.
 *
 * Design rows are filtered by `when && gradientPanelVisible` — byte-identical to the
 * derivation the parity spec pins. Post rows pass through with their own group and
 * the caller's `showIf` rule.
 */
export function gradientPanelControls(
  cfg: GradientConfig,
  activeLayer = 0,
  opts: { controls?: readonly GradientControl[]; postVisible?: (c: ControlSpec) => boolean } = {},
): ControlSpec[] {
  const source = opts.controls ?? GRADIENT_CONTROLS
  const shadow = shadowConfig(cfg, activeLayer)
  const rows: ControlSpec[] = []
  const post: ControlSpec[] = []
  for (const c of source) {
    if (isPostGroup(c.group)) {
      if (!opts.postVisible || opts.postVisible(c)) post.push(c)
      continue
    }
    if (!panelRowVisible(c, cfg, activeLayer, shadow)) continue
    rows.push(withPresentation(c, cfg, activeLayer))
  }
  for (const a of PANEL_ANCHORS) {
    if (!a.visible(cfg, activeLayer)) continue
    rows.push({ key: a.key, label: a.label, kind: 'text', default: '', group: a.group, bindable: false } as ControlSpec)
  }
  const type = (cfg.layers?.[activeLayer] ?? cfg.layers?.[0])?.shape?.type ?? 'bands'
  return [...sortWithinCards(rows, type === 'noise'), ...post]
}
