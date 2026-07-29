import type { ControlSpec } from '~/lib/spacetype/effect'
import { isFill } from '~/lib/compositor/paint'
// Both CPU-only by contract (see fillTile.ts's header) — no `three`, no DOM at
// module scope — so they are safe for the Collection control resolver and the
// node card, same as `shapefx/controls.ts` already assumes.
import { DEFAULT_FILL, FILL_TYPES, type Fill } from '~/lib/spacetype/fillTile'
// The seven blends the studios share — the SAME list `mergeLayer` whitelists
// against, so the picker cannot offer a mode the merge would throw away.
import { BLEND_MODES } from '~/lib/studio/blend'
// TYPE-ONLY, and it must stay that way: ./font.ts loads fontkit at module scope,
// while this module is pulled in by the Collection control resolver and every
// node card. A value import here would drag a font parser into both.
import type { VtAxis } from './font'
import {
  DEFAULT_CONFIG,
  LAYER_DEFAULTS,
  VT_ALIGNS,
  VT_DEFAULT_STROKE_COLOR,
  VT_DEFAULT_STROKE_WIDTH,
  VT_EXTRUDE_DEPTH_MAX,
  VT_FILL_ANCHORS,
  VT_FONT_IDS,
  VT_STAGGER_DELAY_MAX,
  VT_STAGGER_ORDERS,
  VT_STAGGER_SEED_MAX,
  type VectorTypeConfig,
  type VtAppearanceLayer,
} from './config'

/**
 * The single declarative description of Vector Type Studio's parameters.
 *
 * One list, four consumers: the agent's vocabulary (`agentControls.ts`), the
 * motion system's animatable targets (Task 6's `motion.ts`), Collection variable
 * bindings / sweeps (`lib/collection/studioControls.ts`), and the inspector UI
 * (`StudioControlPanel`). Declare a control once and all four pick it up; each
 * consumer opts OUT (`agent: false`, `animatable: false`) rather than in.
 *
 * Keys are dotted paths resolved by `makeConfigParams`, so each one must address
 * a real leaf on `VectorTypeConfig` — pinned by a test, because a key that does
 * not resolve is a control that silently does nothing.
 *
 * ## The axis controls are DERIVED, not declared
 *
 * Every other studio has a closed vocabulary. This one cannot: Inter declares 2
 * variation axes, Roboto Flex 13 (including `XOPQ`, `GRAD`, `YTAS`). You cannot
 * freeze what you do not know, and Collection bindings persist `params.<key>`.
 *
 * This is the same problem shader fills hit (63 catalog effects, each with its
 * own param list) and it takes the same answer — **declare the frame, derive the
 * contents** (`lib/shaderfill/controls.ts`, and the design doc
 * `docs/superpowers/specs/2026-07-26-shader-as-fill-design.md`):
 *
 *   fontId         <- DECLARED here, frozen forever, Collection-bindable
 *   axes.<tag>     <- DERIVED from the loaded font (`derivedAxisControls`)
 *
 * `fontId` never changes shape, so a binding against it is as safe as any
 * hand-authored control. The derived `axes.<tag>` keys are stable only PER FONT
 * — switching `fontId` changes which axes exist — and that instability is
 * inherent to what they represent, not a defect: there is no font-independent
 * "XOPQ" knob. A stale binding degrades to "ignored", never "wrong value
 * applied", because `clampCoords` (./font.ts) drops any tag the font does not
 * declare before the outline is ever asked for.
 *
 * The one structural difference from shader fills: they read their catalog from
 * a synchronous cache (`getEffectSync`), so `shapeAgentControls(cfg)` could keep
 * a one-argument signature. `loadVariableFont` exposes only promises, so the
 * loaded axes are passed IN — exactly as `shaderAgentControls(config, effectDef)`
 * already does for Shader Studio.
 */
export type VtControl = ControlSpec & {
  /** `layer` is the ACTIVE appearance layer, when the caller knows which one it
   *  is. Omit it and the predicate falls back to the stack's first layer — the
   *  headless "layer 0 is active" convention `studioTune` and the Collection
   *  resolver already assume for Gradient's `layer.` prefix. */
  when?: (cfg: VectorTypeConfig, layer?: VtAppearanceLayer | null) => boolean
}

/**
 * ## The `layer.` prefix — Gradient's relative-prefix pattern, adopted whole
 *
 * The appearance stack has RUNTIME cardinality: one config has one fill, the
 * next has three fills, two strokes and an extrude. Declaring N sets of controls
 * would mean the vocabulary changed shape with the data, which is exactly the
 * dynamic-vocabulary problem `derivedAxisControls` was written to dodge for the
 * axes and `lib/shaderfill/controls.ts` for the effect params.
 *
 * Gradient's answer, reused verbatim: declare the per-layer controls ONCE,
 * UNINDEXED, under a `layer.` prefix, and let each consumer expand it —
 *
 *   `makeConfigParams`  resolves `layer.x` against the ACTIVE layer, so the
 *                       inspector and the agent edit whichever layer is selected
 *                       and the key never changes shape;
 *   `animatableTargets` expands it to one absolute path PER layer, so motion
 *                       still reaches all of them.
 *
 * The inspector therefore shows the active layer's controls plus the stack — one
 * flat key list, whatever the stack looks like. Persisted Collection bindings are
 * `params.layer.paint.a`, which is stable across a reorder for the same reason.
 *
 * `makeConfigParams` takes the list name as a parameter (`'appearance'` here,
 * `'layers'` for Gradient and Shape) rather than assuming `layers`.
 */
export const VT_LAYER_PREFIX = 'layer.'

/** Emission order; a control whose group is not listed here is dropped.
 *  `Axes` is declared but carries no STATIC member — it is the slot the derived
 *  per-font sliders land in. That empty section is the "frame" being declared. */
export const VT_SECTIONS = ['Text', 'Font', 'Axes', 'Layout', 'Paint', 'Motion'] as const

/** The group every derived axis slider carries. Must be one of VT_SECTIONS. */
export const VT_AXES_GROUP = 'Axes'

/**
 * The layer a `layer.*` predicate is being asked about.
 *
 * Falls back to `appearance[0]`, matching what `makeConfigParams` resolves a
 * `layer.` key against when the host passes no active index — the headless
 * convention `studioTune`'s Gradient adapter already documents ("Layer 0 is the
 * headless active layer"). Optional-chained because a control list can be asked
 * for from a config straight out of storage, before `mergeConfig` rebuilt it.
 *
 * **Task 8 hand-off:** once `VectorTypeSurface` owns an active-layer ref it must
 * pass it to `visibleVtControls(cfg, active)` AND to `makeConfigParams`, or the
 * panel will gate its controls on layer 0 while editing layer N.
 */
const vtLayerOf = (c: VectorTypeConfig, l?: VtAppearanceLayer | null): VtAppearanceLayer | null =>
  l ?? c?.appearance?.[0] ?? null

const layerIsStroke = (c: VectorTypeConfig, l?: VtAppearanceLayer | null) => vtLayerOf(c, l)?.kind === 'stroke'
const layerIsExtrude = (c: VectorTypeConfig, l?: VtAppearanceLayer | null) => vtLayerOf(c, l)?.kind === 'extrude'

/**
 * An extrude that is asking for its copies to be FUSED — the only layer that can
 * carry a silhouette outline.
 *
 * The outline is one contour around the whole extruded body, which does not exist
 * until the copies have been united: stroking them individually would draw an
 * outline around EACH, i.e. internal seam lines through the block. So on a
 * `solid: false` extrude the width and the colour would be two knobs that
 * resolve, store, survive the merge and change not one pixel — the exact dead
 * control this schema exists to prevent. Gated on `solid`, they appear with the
 * capability.
 *
 * (`solid` itself is deliberately NOT a declared control — `ControlSpec` has no
 * boolean kind and `mergeLayer` reads a real boolean; its home is a stack row.
 * See the note at the bottom of the Paint section.)
 */
const layerIsSolidExtrude = (c: VectorTypeConfig, l?: VtAppearanceLayer | null) => {
  const L = vtLayerOf(c, l)
  return L?.kind === 'extrude' && L.solid === true
}

/** The two kinds `layer.width` is live on — a stroke layer's own outline, and a
 *  solid extrude's silhouette. One predicate so the width and its colour cannot
 *  be gated on two different readings of the same question. */
const layerHasWidth = (c: VectorTypeConfig, l?: VtAppearanceLayer | null) =>
  layerIsStroke(c, l) || layerIsSolidExtrude(c, l)

/**
 * The active layer's paint as a `Fill`, or null.
 *
 * `VtAppearanceLayer.paint` is a `Paint` — `string | Gradient | Fill`. Every
 * `layer.paint.*` control below addresses the `Fill` arm's own fields, so all of
 * them hang off this: on a `Gradient` (multi-stop / radial, which `Fill` cannot
 * express and `mergeConfig` deliberately preserves) `layer.paint.a` resolves to
 * nothing, and a control that resolves to nothing is a control that silently
 * does nothing. `mergeConfig` lifts a bare string, so the string arm is only
 * reachable from a config that has not been merged yet — which is exactly what
 * the optional chaining is for, same as `isShuffled` below.
 */
const vtFill = (c: VectorTypeConfig, l?: VtAppearanceLayer | null): Fill | null => {
  const paint = vtLayerOf(c, l)?.paint
  return isFill(paint) ? paint : null
}

/**
 * A SHADER fill's own `a` / `b` are never read.
 *
 * `effectiveTilePaint` (fillTile.ts:60) unwraps a `type: 'shader'` Fill to
 * `shader.input` and paints THAT — the outer Fill's colours are not consulted by
 * any renderer on the screen path. So `fill.a` on a shader fill is the exact
 * "control that resolves to nothing" this file withholds `stroke` and `fill.b`
 * for elsewhere: a tune like "make the fill red" writes a value that is stored,
 * survives the merge, and changes not one pixel.
 *
 * Task 8 already hid these two in the studio panel (`VectorTypeSurface.vue`'s own
 * `controlVisible`), but that predicate is the PANEL's — `vtAgentControls`,
 * `animatableTargets` and the Collection resolver all read `when` instead, so
 * the agent kept being offered both. Putting the rule here is what makes the four
 * consumers agree; the panel's copy is now redundant rather than contradicted.
 *
 * `fillHasAngle`/`fillHasDensity` below needed no change — neither list contains
 * `shader`, so those two were already withheld.
 */
const fillIsShader = (c: VectorTypeConfig, l?: VtAppearanceLayer | null) => vtFill(c, l)?.type === 'shader'
const fillIsFill = (c: VectorTypeConfig, l?: VtAppearanceLayer | null) => !!vtFill(c, l) && !fillIsShader(c, l)
// Mirrors shapefx/controls.ts:33-35 — the same three questions, asked of the
// same `Fill`. ONE deliberate difference: `gradient` is in `fillHasAngle` here.
// `fillTileBox`'s gradient arm reads `fill.angle` (fillTile.ts:306), so Shape
// Studio's list leaves a knob that DOES change the render unreachable from its
// own UI. Mirroring that would be mirroring a bug.
const fillNeedsB = (c: VectorTypeConfig, l?: VtAppearanceLayer | null) => {
  const f = vtFill(c, l)
  return !!f && f.type !== 'solid' && f.type !== 'shader'
}
const fillHasAngle = (c: VectorTypeConfig, l?: VtAppearanceLayer | null) => {
  const t = vtFill(c, l)?.type
  return t === 'gradient' || t === 'ombre' || t === 'stripes'
}
const fillHasDensity = (c: VectorTypeConfig, l?: VtAppearanceLayer | null) => {
  const t = vtFill(c, l)?.type
  return t === 'grid' || t === 'checkerboard' || t === 'stripes' || t === 'qr'
}

/** The shuffle seed only means anything for the shuffled order; shown for any
 *  other it is a knob whose effect the user can never see. Optional-chained
 *  because a control list can be asked for from a config straight out of
 *  storage, before `mergeConfig` has rebuilt the motion block. */
const isShuffled = (c: VectorTypeConfig) => c.motion?.stagger?.order === 'random'

const slider = (
  key: string, label: string, min: number, max: number, step: number, group: string,
  def: number, hint?: string, extra: Partial<VtControl> = {},
): VtControl =>
  ({ key, label, kind: 'slider', min, max, step, default: def, group, ...(hint ? { hint } : {}), ...extra } as VtControl)

const select = (
  key: string, label: string, options: string[], def: string, group: string,
  hint?: string, extra: Partial<VtControl> = {},
): VtControl =>
  ({ key, label, kind: 'select', options, default: def, group, ...(hint ? { hint } : {}), ...extra } as VtControl)

const color = (key: string, label: string, def: string, group: string, extra: Partial<VtControl> = {}): VtControl =>
  ({ key, label, kind: 'color', default: def, group, ...extra } as VtControl)

export const VT_CONTROLS: VtControl[] = [
  // --- Text -----------------------------------------------------------------
  // `kind: 'text'` is not AI-editable by default (controlDescriptor.ts) and that
  // default is kept: `validatePatch` has no branch for text, so an agent write
  // would be dropped silently anyway. It IS declared, because a Collection
  // binding maps `text` to a 'text' variable — sweeping a column of words
  // through the studio is the whole point of having it in the schema.
  { key: 'text', label: 'Text', kind: 'text', default: DEFAULT_CONFIG.text, group: 'Text' },

  // --- Font -----------------------------------------------------------------
  select('fontId', 'Font', VT_FONT_IDS, DEFAULT_CONFIG.fontId, 'Font',
    'Which variable family to set the type in. Changing it changes WHICH AXES EXIST.',
    // A different font is a different axis set, not a point on a scale: tweening
    // it would swap vocabularies mid-clip, not interpolate anything.
    { animatable: false }),

  // --- Layout ---------------------------------------------------------------
  slider('size', 'Size', 8, 600, 1, 'Layout', DEFAULT_CONFIG.size, 'Em size in output pixels (CSS font-size semantics).'),
  slider('tracking', 'Tracking', -200, 500, 1, 'Layout', DEFAULT_CONFIG.tracking,
    "Extra letter spacing in 1/1000 em; 0 = the font's own spacing, negative tightens."),
  select('align', 'Align', [...VT_ALIGNS], DEFAULT_CONFIG.align, 'Layout', 'Horizontal anchoring of the glyph run.'),

  // --- Paint ----------------------------------------------------------------
  // The ACTIVE APPEARANCE LAYER's own keys, declared once under the `layer.`
  // prefix (see VT_LAYER_PREFIX above) rather than once per layer.
  //
  // Every one of them addresses a real leaf on `VtAppearanceLayer`, never inside
  // its `paint` — except the five that genuinely are `Fill` fields, which is why
  // they carry the extra `paint.` segment. `normalizePaint` rebuilds a `Paint`
  // field by declared field, so a per-layer property stored inside one survives
  // in memory and vanishes on the next load (trap 1).
  //
  // Defaults come from `DEFAULT_FILL`, not from a second hand-written copy: a
  // fresh layer's paint IS `{ ...DEFAULT_FILL }`, and reading the shared constant
  // is what keeps the picker's idea of "solid white" and the merge's from
  // drifting.
  select('layer.paint.type', 'Fill type', [...FILL_TYPES], DEFAULT_FILL.type, 'Paint',
    'How this layer is painted: a flat colour, a gradient, or one of the procedural patterns.',
    // A mode, not a point on a scale — the same reason `fontId` opts out.
    // (`animatableTargets` only ever offers sliders, so this is documentation
    // of intent rather than the mechanism; it is declared so the intent
    // survives a future consumer that reads the flag for other kinds.)
    { animatable: false }),
  color('layer.paint.a', 'Fill', DEFAULT_FILL.a, 'Paint', { when: fillIsFill }),
  // A second colour that paints nothing on a solid fill is a control whose
  // effect the user cannot see — the same trade Shape Studio's `fill.b` makes.
  color('layer.paint.b', 'Fill 2', DEFAULT_FILL.b, 'Paint', { when: fillNeedsB }),
  slider('layer.paint.angle', 'Fill angle', 0, 360, 1, 'Paint', DEFAULT_FILL.angle,
    'Direction of the gradient / ombre fade / stripes, in degrees.',
    { when: fillHasAngle }),
  slider('layer.paint.density', 'Fill density', 2, 32, 1, 'Paint', DEFAULT_FILL.density,
    'How many cells or stripes span the fill.',
    { when: fillHasDensity }),
  // NOT `layer.paint.anchor` — `normalizePaint` rebuilds every arm field by
  // declared field, so an anchor stored inside the paint is dropped on the next
  // load. It is a field on the LAYER. See `VtAppearanceLayer`'s doc.
  select('layer.anchor', 'Fill anchor', [...VT_FILL_ANCHORS], 'glyph', 'Paint',
    'Which box this layer is measured against: each glyph, the whole word, or the frame (so the type moves over a fill that stays put).',
    // A MODE. Tweening it would jump between sampling spaces rather than
    // interpolate anything — the same reason Space Type's own anchor is
    // withheld from motion.
    { animatable: false }),
  // Withheld unless the active layer can actually draw an outline: on a fill
  // layer a width paints nothing, which is the dead-control failure this schema
  // exists to prevent. The old flat `strokeWidth` was ungated and defaulted to 0,
  // so its companion colour control was withheld instead — the arrangement that
  // made the stroke invisible and prompted this whole change.
  //
  // TWO kinds now: a `stroke` layer's outline around the letterform, and a SOLID
  // `extrude`'s outline around the whole fused body — the silhouette. Same knob,
  // one level apart, so it is one control rather than two keys addressing one
  // leaf. The `default` here is the STROKE layer's (`VT_DEFAULT_STROKE_WIDTH`); a
  // fresh extrude stores `VT_DEFAULT_EXTRUDE_STROKE_WIDTH` (0) instead, because
  // an outline is what a stroke layer is FOR and one knob among five on an
  // extrude. `ControlSpec` carries one default; the per-kind pair lives in
  // `vtDefaultWidth`, which is what both build sites read.
  slider('layer.width', 'Stroke width', 0, 40, 0.5, 'Paint', VT_DEFAULT_STROKE_WIDTH,
    'Outline width in OUTPUT pixels, so it does not shrink with size. On a solid extrude it outlines the whole fused body — one silhouette, not one outline per copy.',
    { when: layerHasWidth }),
  // The silhouette's COLOUR, and only a colour — see `VtAppearanceLayer.strokeColor`
  // for why the extrude's outline is deliberately not the nine-type `Paint` a
  // stroke LAYER carries. On the layer, never inside its paint (trap 1).
  color('layer.strokeColor', 'Stroke color', VT_DEFAULT_STROKE_COLOR, 'Paint',
    { when: layerIsSolidExtrude }),
  // The EXTRUDE knobs, withheld unless the active layer IS an extrude — same
  // gate, same reason, as the stroke width above. An extrude layer draws the
  // glyph path `depth` more times behind the face (see `./extrude.ts`); the face
  // itself is whatever fill layer sits ABOVE it in the stack.
  slider('layer.depth', 'Extrude depth', 0, VT_EXTRUDE_DEPTH_MAX, 1, 'Paint', LAYER_DEFAULTS.depth,
    'How many offset copies of the letterform are drawn behind the face. 0 = none.',
    { when: layerIsExtrude }),
  // NOT the same knob as `layer.paint.angle`, and it shares its convention with
  // it on purpose: 0° steps right, 90° steps down, so two "angle" sliders in one
  // panel cannot rotate in opposite directions.
  slider('layer.angle', 'Extrude angle', 0, 360, 1, 'Paint', LAYER_DEFAULTS.angle,
    'Which way the extrude steps, in degrees. 0 is to the right, 90 is straight down.',
    { when: layerIsExtrude }),
  slider('layer.distance', 'Extrude distance', 0, 40, 0.5, 'Paint', LAYER_DEFAULTS.distance,
    'Pixels between consecutive copies, so the extrude reaches depth × distance.',
    { when: layerIsExtrude }),
  slider('layer.taper', 'Extrude taper', -1, 1, 0.01, 'Paint', LAYER_DEFAULTS.taper,
    'Shrinks the copies as they recede: 1 fades the far end to nothing, 0 keeps them all the same size, negative flares them outwards.',
    { when: layerIsExtrude }),
  // How strongly this layer's ink lands. Both were withheld until now for the
  // reason this file's header gives — a control that cannot be WRITTEN is as
  // dead as one that cannot be read, and until the stack panel existed there was
  // nowhere to write them from. Task 3 made them real on the canvas and Task 6
  // in the SVG; Task 8 is the panel, so they are declared in the same commit as
  // their UI, exactly as the header demands.
  //
  // Ungated on purpose: unlike `width` and the extrude knobs, these two mean the
  // same thing on all three kinds and paint on all three.
  slider('layer.opacity', 'Layer opacity', 0, 1, 0.01, 'Paint', LAYER_DEFAULTS.opacity,
    "How strong this layer's ink is in the stack. MULTIPLIES the glyph's own motion fade rather than replacing it, so a half-strength layer still fades out with the word."),
  select('layer.blend', 'Layer blend', [...BLEND_MODES], LAYER_DEFAULTS.blend, 'Paint',
    'How this layer composites onto the layers below it (and onto the background, which this studio draws straight onto).',
    // A MODE — tweening `multiply` towards `screen` interpolates nothing.
    { animatable: false }),
  // DELIBERATELY NOT DECLARED: `layer.solid`. It renders (Task 5 — the copies
  // fuse into one body on a bake or an export) but is a **boolean**, and
  // `ControlSpec` has no boolean kind. The house pattern for one is a `select`
  // over `['off','on']`, which works for Space Type because its params are
  // strings — here `mergeLayer` reads `typeof o.solid === 'boolean'` and drops
  // the string on the next load (trap 1's shape, one level out). So declaring it
  // as a select would ship a toggle that appears to work and forgets itself,
  // which is strictly worse than no control. Its home is a stack row, beside
  // `enabled` — the other boolean this schema deliberately does not declare.

  // --- Motion ---------------------------------------------------------------
  // Stagger is NOT a track: it shifts the clock each glyph reads the tracks at.
  // So it is `animatable: false` on purpose — a track pointing at the stagger
  // block would be asking the timeline to rewrite its own reader mid-frame.
  slider('motion.stagger.delay', 'Stagger', 0, VT_STAGGER_DELAY_MAX, 0.01, 'Motion',
    DEFAULT_CONFIG.motion.stagger.delay,
    'Seconds between glyphs. 0 = every glyph animates on one clock; raise it and a track becomes a wave travelling across the word.',
    { animatable: false }),
  select('motion.stagger.order', 'Stagger order', [...VT_STAGGER_ORDERS], DEFAULT_CONFIG.motion.stagger.order, 'Motion',
    'Which glyph goes first: forward, reverse, center (middle outwards), edges (outermost inwards), or random.'),
  slider('motion.stagger.seed', 'Shuffle seed', 0, VT_STAGGER_SEED_MAX, 1, 'Motion',
    DEFAULT_CONFIG.motion.stagger.seed,
    'Re-rolls the random order. The shuffle is seeded, so the same seed always gives the same order — that is what keeps a bake from flickering.',
    { animatable: false, when: isShuffled }),
]

/**
 * Controls applicable to this config, in VT_SECTIONS order. Static only — the
 * per-font axis sliders come from `derivedAxisControls`, which needs a loaded
 * font this function has no access to.
 *
 * `active` is the index of the appearance layer the `layer.*` keys are being
 * asked about, and it must match whatever index the caller gave
 * `makeConfigParams` — a control gated on layer 0 while the proxy writes to
 * layer 2 is a control that appears and disappears for the wrong reasons.
 * Defaults to 0, the headless convention.
 */
export function visibleVtControls(cfg: VectorTypeConfig, active = 0): VtControl[] {
  const layer = cfg?.appearance?.[active] ?? null
  const out: VtControl[] = []
  for (const section of VT_SECTIONS) {
    for (const c of VT_CONTROLS) {
      if (c.group !== section) continue
      if (c.when && !c.when(cfg, layer)) continue
      out.push(c)
    }
  }
  return out
}

/** Short semantic notes for the axis tags a user is least likely to recognise.
 *  Anything not listed falls back to a generic hint naming the tag. */
const AXIS_HINTS: Record<string, string> = {
  wght: 'Weight — thin to black, as real outline geometry.',
  wdth: 'Width — condensed to extended.',
  opsz: 'Optical size — the cut the designer intended at this size.',
  slnt: 'Slant — a true oblique, not a skew.',
  ital: 'Italic — the font\'s own italic forms where it has them.',
  GRAD: 'Grade — weight WITHOUT changing the width the text occupies.',
  XOPQ: 'Thick stroke — thickness of the vertical strokes.',
  YOPQ: 'Thin stroke — thickness of the horizontal strokes.',
  XTRA: 'Counter width — the space inside the letters.',
  YTAS: 'Ascender height.',
  YTDE: 'Descender depth.',
  YTUC: 'Uppercase height.',
  YTLC: 'Lowercase height (x-height).',
  YTFI: 'Figure height.',
  SOFT: 'Softness — how rounded the terminals are.',
  WONK: 'Wonk — the quirkier alternate forms.',
  CASL: 'Casual — upright to relaxed handwriting-ish.',
  CRSV: 'Cursive — connected letterforms.',
  MONO: 'Mono — proportional to monospaced.',
}

/** Sub-unit axes (CASL/WONK, 0..1) need a fine step; wght-style ranges do not. */
function axisStep(a: VtAxis): number {
  const span = a.max - a.min
  if (span <= 2) return 0.01
  if (span <= 20) return 0.1
  return 1
}

/**
 * One slider per axis the loaded font declares, addressed at `axes.<tag>` — the
 * REAL path into `VectorTypeConfig.axes`, so `makeConfigParams` and
 * `getByPath`/`setByPath` land on the stored value with no translation layer.
 * (Shader fills paid for this lesson: a reserved `.p.` segment one step off the
 * real path wrote to a phantom object and never reached the renderer.)
 *
 * Sliders are animatable by default, which is the point — every axis of every
 * font becomes a motion target without this function opting in per-tag.
 *
 * Pass `font.axes` from a loaded `VtFont`; the ranges and defaults are the
 * FILE's `fvar`, not the catalog's curated subset, so exotic axes appear too.
 */
export function derivedAxisControls(axes: VtAxis[]): ControlSpec[] {
  const out: ControlSpec[] = []
  for (const a of axes ?? []) {
    // A zero-width axis cannot be dragged and would break the "max > min"
    // invariant every slider consumer assumes. `normaliseAxes` allows it
    // (it only rejects max < min); this is where it stops.
    if (!(a.max > a.min)) continue
    out.push({
      key: `axes.${a.tag}`,
      label: a.name || a.tag,
      kind: 'slider',
      min: a.min,
      max: a.max,
      step: axisStep(a),
      default: a.default,
      group: VT_AXES_GROUP,
      hint: AXIS_HINTS[a.tag] ?? `Variable axis ${a.tag} — real outline geometry.`,
    })
  }
  return out
}

/**
 * Domain guidance injected into the /api/vibe prompt. Owned here, co-located
 * with the schema it describes.
 *
 * Every control key it names is backticked and pinned by a test — prose that
 * teaches the model a key which does not exist teaches it to emit patches
 * `validatePatch` will silently drop.
 */
export const VT_GUIDANCE = `This is a VECTOR TYPE studio: real glyph OUTLINES pulled from a VARIABLE font and animated as geometry. Not a raster text layer, not 3D type.

THE FONT COMES FIRST. \`fontId\` picks the variable family, and it decides WHICH AXES EXIST — change it before touching any axis, never after.

AXES ARE THE POINT. Every axis the chosen font declares is a live slider at \`axes.<tag>\`: the familiar ones are \`axes.wght\` (weight), \`axes.wdth\` (width), \`axes.opsz\` (optical size) and \`axes.slnt\` (slant), and Roboto Flex adds the rare ones — \`axes.GRAD\` (grade: weight without changing the width the text occupies), \`axes.XOPQ\` (thick-stroke thickness), \`axes.XTRA\` (counter width), \`axes.YTAS\` (ascender height), \`axes.YTLC\` (x-height). These interpolate the OUTLINE itself, so reach for an axis before faking weight with an outline. Only tags the current font declares exist; anything else is ignored.

LAYOUT. \`size\` is the em size in output pixels. \`tracking\` is extra letter spacing in 1/1000 em (0 = the font's own spacing, negative tightens). \`align\` anchors the run horizontally.

STAGGER MAKES IT KINETIC. \`motion.stagger.delay\` is the gap in seconds between one glyph and the next; at 0 the whole word animates as one, and raising it turns any animated axis into a wave that travels across the word. \`motion.stagger.order\` picks which glyph leads — forward, reverse, center (middle outwards), edges (outermost inwards) or random — and \`motion.stagger.seed\` re-rolls the random one. Reach for these when the user asks for letters to cascade, ripple, or come in one at a time.

PAINT IS A STACK. The type carries an ordered list of appearance layers — fills, strokes and extrudes, painted back to front, Illustrator's Appearance panel. The paint controls address the ACTIVE layer and are prefixed \`layer.\`; they do not name an index, so the same keys work whichever layer is selected.

NAMING ONE LAYER INSTEAD. Every layer also appears in the control list under its own key, \`appearance.<layerId>.<key>\`, labelled with the layer's name — "Stroke · Stroke width", "Fill 2 · Fill". Use those when the user names a layer rather than the selection ("make the OUTLINE thicker", "the second fill should be red"): the \`layer.\` keys only ever reach whichever layer is active, which on a fill-then-stroke stack is the fill, so an outline request sent to \`layer.width\` reaches nothing. The id in the key is that layer's own; never invent one, and never write a key that is not in the control list you were given.

\`layer.paint.type\` picks how the active layer is painted: solid, gradient, ombre (a grainy A→B fade), grid, noise, checkerboard, stripes, qr, or shader. \`layer.paint.a\` is the main colour and \`layer.paint.b\` the second one, which appears for everything except solid — and neither applies to a shader fill (see below). \`layer.paint.angle\` sets the direction of a gradient, ombre or stripes; \`layer.paint.density\` sets how many cells or stripes span grid, checkerboard, stripes and qr. \`layer.anchor\` decides which box THIS LAYER is measured against — "glyph" gives every letter its own copy, "word" spans one fill across the whole run so the letters are windows onto it, and "frame" pins the fill to the canvas so moving type slides over it. Reach for "word" when the user asks for a gradient across a word.

\`layer.width\` is the outline width in output pixels, and it only exists when the active layer can draw an outline — a STROKE layer, or a solid EXTRUDE (see below) — so for a stroke that is NOT the active one, reach for that layer's own \`appearance.<layerId>.width\` key instead. A stroke is visible because it is in the stack, not because a width was raised. You cannot add, remove or reorder layers; you can adjust any layer that is already there.

EVERY LAYER COMPOSITES. \`layer.opacity\` is how strong that layer's ink is in the stack, 0 to 1 — it multiplies the glyph's own motion fade rather than replacing it, so a half-strength layer still fades out with the word. \`layer.blend\` is how the layer composites onto what is below it: normal, lighten, screen, add, multiply, darken or overlay. Both apply to fills, strokes and extrudes alike. Reach for them when the user asks for a layer to be subtler, to glow, or to darken the one underneath.

EXTRUDE IS A BLOCK SHADOW, not 3D. An extrude layer redraws the letterform several times behind the face, which is what gives retro block lettering and hard offset shadows; the FACE is whichever fill layer sits above it in the stack. Its four knobs exist only when the active layer is an EXTRUDE layer. \`layer.depth\` is how many copies (0 draws none), \`layer.distance\` is the gap in pixels between consecutive copies, so the block reaches depth × distance, and \`layer.angle\` is the direction in degrees — 0 steps right, 90 steps straight down, using the same convention as the fill angle above. \`layer.taper\` shrinks the copies as they recede: 1 fades the far end away for a vanishing-point look, 0 keeps the block even, and negative values flare it outwards.

OUTLINED BLOCK LETTERING. An extrude whose copies have been fused into one body can carry a SILHOUETTE — a single outline around the whole extruded mass, the classic outlined-3D look, never one outline per copy. \`layer.width\` is that outline's thickness in output pixels (0 = none, and that is the default) and \`layer.strokeColor\` is its colour. Both only exist while the active extrude layer is fused; on an unfused one there is no single contour to draw, so they are withheld rather than offered as knobs that would change nothing.

SHADER FILLS. Setting \`layer.paint.type\` to shader paints the layer with a live catalog shader effect rather than a flat pattern, and the flat colours stop applying: a shader fill is painted from the effect's own input, so \`layer.paint.a\` and \`layer.paint.b\` are withdrawn and writing them would change nothing. Three controls take their place. \`layer.paint.shader.effectId\` names the catalog effect. \`layer.paint.shader.anchor\` is object (every glyph carries its own copy of the field) or frame (one continuous field, and the letters are windows onto it) — the same distinction \`layer.anchor\` draws for the other fills, applied to the effect. \`layer.paint.shader.speed\` is the animation rate, 0 = frozen. Each effect also brings its OWN parameters, at \`layer.paint.shader.params.<param>\`: which ones exist depends entirely on the chosen effect, so they only appear in the control list once an effect is picked, and changing \`layer.paint.shader.effectId\` replaces the whole set. Be aware that many effects also declare a speed parameter of their own, which is a different knob from \`layer.paint.shader.speed\` — both must be non-zero for the fill to move.

\`text\` is the user's own copy and is not yours to rewrite; change how it LOOKS, not what it says.`
