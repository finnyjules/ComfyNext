/**
 * Vector Type Studio — the config schema.
 *
 * The stored shape of a Vector Type node: what text, in which variable font, at
 * which axis positions, painted how. Everything the studio renders is a pure
 * function of this plus a time — there is no engine state — which is why motion
 * is a plain list of tracks over dotted paths rather than a rebuild protocol.
 *
 * `mergeConfig` is a STRICT REBUILD, not a deep merge: every field is
 * type-checked and rewritten from the default, so a config saved by an older
 * (or newer, or corrupted) version can only ever contribute values of the right
 * type. Nothing is trusted, including the axes record and the motion tracks.
 *
 * Deliberately NOT here: canvas size and background — both live outside the
 * config in every other studio.
 *
 * `motion.in/out/loop` are the SHARED kinetic engine's preset slots, added once
 * `./presetMotion.ts` existed to read them — same rule as `motion.stagger`
 * below. They compose with `tracks`; neither overwrites the other.
 *
 * `motion.stagger` IS here as of Task 6, which built the evaluator that reads it
 * (`./motion.ts`: `glyphTime` / `glyphTransform`). It was withheld until then
 * for the reason this schema exists — declaring keys no renderer reads is the
 * silent-dead-control failure — and it is declared now because the reader
 * landed, not because the shape got clearer.
 */
import type { MotionTrack as GradientMotionTrack } from '~/lib/gradientfx/types'
import type { LayerAnimSpec } from '~/lib/motion/types'
import { isFill, isGradient, type Gradient, type Paint } from '~/lib/compositor/paint'
import { DEFAULT_FILL, normalizePaint, type Fill } from '~/lib/spacetype/fillTile'
import { DEFAULT_FONT_ID, VARIABLE_FONTS } from '~/data/variable-fonts'

/** Horizontal anchoring of the (single-line, v1) glyph run. */
export type VtAlign = 'left' | 'center' | 'right'

/**
 * Which BOX the fill is sampled against — i.e. what "100% along the gradient"
 * means. Three terms, where Space Type has two (`object | frame`):
 *
 *  - `glyph` — each letter carries its own copy of the fill. Where the renderer
 *              is today (`ctx.fillStyle` inside the per-glyph transform);
 *              `gradientUnits="objectBoundingBox"` in SVG.
 *  - `word`  — ONE fill spans the whole run and the letters are windows onto
 *              it. The middle term type needs and neither Space Type anchor
 *              expresses; a gradient across a word is the most-wanted
 *              treatment in the design doc.
 *  - `frame` — one fill spans the canvas and the type moves over it. Space
 *              Type's `frame`, and the anchor a moving run reads against.
 *
 * NOT ANIMATABLE, and declared so in `controls.ts`. It is a MODE: tweening it
 * would jump between sampling spaces rather than interpolate anything, exactly
 * the reason Space Type declares its own anchor `animatable: false`.
 */
export type VtFillAnchor = 'glyph' | 'word' | 'frame'

/** The three anchors, in picker order. Single source for the select's options
 *  and for `mergeConfig`'s whitelist, so the picker cannot offer a value the
 *  merge would throw away. */
export const VT_FILL_ANCHORS = ['glyph', 'word', 'frame'] as const

/** Same three curves gradientfx's `trackValue` implements. */
export type VtEasing = 'linear' | 'pingpong' | 'easeinout'

/**
 * One animation track. Structurally the subset of gradientfx's `MotionTrack`
 * that its `trackValue` actually reads — minus the deprecated `{layer, param}`
 * legacy targeting, which this studio has no saved configs to carry.
 *
 * Task 6 evaluates these; keeping the shape assignable to gradientfx's means it
 * can reuse `trackValue` outright instead of writing a second easing engine.
 * `VT_TRACK_IS_GRADIENT_COMPATIBLE` below fails to COMPILE if the two drift.
 */
export interface VtMotionTrack {
  /** Absolute dotted path into VectorTypeConfig, e.g. `axes.wght`. */
  path: string
  from: number
  to: number
  easing: VtEasing
  /** Cycles within the clip; >= 1. */
  loops: number
  /** Hold at extremes, 0..0.5. */
  hold: number
  /** Phase offset into the cycle, 0..1. */
  cycleOffset: number
  /** Start delay, seconds. */
  delay: number
}

/**
 * The queue every glyph waits in. `forward` = first letter first; `center` =
 * middle outwards; `edges` = outermost inwards; `random` = a SEEDED shuffle
 * (see `motion.stagger.seed` — a per-frame `Math.random()` would make the bake
 * flicker and the SVG export unreproducible).
 */
export type VtStaggerOrder = 'forward' | 'reverse' | 'center' | 'edges' | 'random'

/**
 * Per-glyph timing offset. Not a track: it does not animate anything by itself,
 * it SHIFTS THE CLOCK each glyph reads the tracks at — which is what turns a
 * single `axes.wght` track into a weight wave travelling across a word.
 */
export interface VtStaggerConfig {
  /** Seconds between consecutive glyphs in the queue. 0 = one shared clock. */
  delay: number
  order: VtStaggerOrder
  /** Shuffle seed for `order: 'random'`. Ignored by every other order. */
  seed: number
}

export interface VtMotionConfig {
  tracks: VtMotionTrack[]
  /** Clip length in seconds. */
  duration: number
  fps: number
  /** Export height base (1080 / 1440 / 2160). */
  size: number
  stagger: VtStaggerConfig
  /**
   * Entrance / exit / loop presets from the SHARED kinetic engine
   * (`~/lib/motion/evaluate`), evaluated by `./presetMotion.ts`.
   *
   * `LayerAnimSpec` is adopted VERBATIM — the same shape the Compositor stores
   * and the same shape `MotionPresetPicker` emits — so the picker can be mounted
   * here with no conversion layer. A parallel VT-shaped type would have to be
   * translated at the picker, at the evaluator and at every test, and the
   * translation is exactly where a field quietly stops being carried.
   *
   * These COMPOSE with `tracks`; they do not replace them. A Slide-Up preset and
   * a `axes.wght` track are both visible at once (see `./presetMotion.ts` for the
   * composition rule). Absent = that slot contributes nothing.
   *
   * `LayerAnimSpec.stagger` is DELIBERATELY NOT STORED — see `mergeAnimSpec`.
   */
  in?: LayerAnimSpec
  out?: LayerAnimSpec
  loop?: LayerAnimSpec
}

/** Compile-time proof that a VT track can be fed to gradientfx's `trackValue`
 *  (Task 6 reuses it rather than reimplementing easing). If the shapes ever
 *  drift this line stops type-checking — that is its whole job. */
export const VT_TRACK_IS_GRADIENT_COMPATIBLE: VtMotionTrack extends GradientMotionTrack ? true : false = true

export interface VectorTypeConfig {
  /** The word(s) to set. Long strings are a real performance cost (hundreds of
   *  anchor points per glyph, re-shaped per frame); bounding the INPUT is the
   *  surface's job — truncating here would silently rewrite a saved project. */
  text: string
  /** Catalog id from `~/data/variable-fonts`. Frozen control key. */
  fontId: string
  /**
   * Axis positions by OpenType tag, e.g. `{ wght: 700, XOPQ: 96 }`.
   *
   * SPARSE BY DESIGN: an absent tag means "the font's own default for that
   * axis" (`resolveCoords` in ./outline.ts fills it in), so `{}` is a complete,
   * valid config for any font. Tags the current font does not declare are KEPT
   * here and dropped at render time by `clampCoords` — switching font away and
   * back must not silently discard the axis values you set.
   */
  axes: Record<string, number>
  /** Em size in output pixels (CSS `font-size` semantics). */
  size: number
  /** Extra advance per glyph in 1/1000 em (CSS `letter-spacing` in em × 1000),
   *  applied after the font's own shaping. 0 = the font's spacing untouched. */
  tracking: number
  align: VtAlign
  /**
   * Glyph body paint — the product's whole fill vocabulary, not a colour.
   *
   * A REAL `Paint` (`string | Gradient | Fill`), stored verbatim, NOT a
   * Vector-Type-shaped near-copy. Shape Studio declared its own `SurfaceFill`
   * (a `Fill` minus `textColor`) and the function that mapped one back to the
   * other silently dropped a field and shipped broken — see the doc comment at
   * `shapefx/config.ts:60-70`. There is no mapping function here to get wrong.
   *
   * `mergeConfig` normalises this so the common case is always a `Fill`: a
   * LEGACY `'#rrggbb'` string (what every node saved before this existed holds)
   * is LIFTED to `{ type: 'solid', a: <the string>, … }` — see `mergeFill`. A
   * `Gradient` (multi-stop / radial, which `Fill` cannot express) is the one
   * arm that survives as itself, because collapsing it would be data loss.
   *
   * `textColor` on the `Fill` arm is inert here — it is the type colour for a
   * Space Type slot row. It is carried because `Fill` is adopted WHOLE; the
   * alternative is exactly the near-copy this comment opens by refusing.
   */
  fill: Paint
  /**
   * Which space the fill is sampled in. See `VtFillAnchor`.
   *
   * ## A SIBLING of `fill`, not a field inside it — and that is FORCED
   *
   * The plan spells this control `fill.anchor`, and it cannot be stored there.
   * `normalizePaint` (which this schema is required to reuse, because it owns
   * the depth-1 shader-nesting guard) does not merge — it REBUILDS, field by
   * declared field, on all three arms:
   *
   *  - a bare colour string has nowhere to put an anchor at all;
   *  - `normalizeGradient` rebuilds a `Gradient` as `{ type, angle?, stops }`;
   *  - `normalizeFill` rebuilds a `Fill` as `{ type, a, b, textColor, angle,
   *    density, shader? }`.
   *
   * An `anchor` smuggled onto any of them survives in memory and is DROPPED on
   * the next load — a control that works until you reopen the file, which is
   * precisely the class of failure trap 5 is about. Space Type has no
   * counter-example: its only anchor lives on `ShaderSpec` (`fills.ts:54`),
   * i.e. inside a struct that actually declares the field.
   *
   * So the anchor is a top-level key. `VT_CONTROLS` declares it as `fillAnchor`
   * for the same reason every other key here is the REAL dotted path: a control
   * key that is one segment off the storage it claims to address writes to a
   * phantom object (the lesson `derivedAxisControls` records).
   */
  fillAnchor: VtFillAnchor
  /**
   * Outline colour, `#rrggbb`. Only paints when `strokeWidth > 0`.
   *
   * ## Why `stroke` is DELIBERATELY still a colour and not a `Paint`
   *
   * A gradient stroke is cheap on canvas and free in SVG, and it was still
   * declined for v1:
   *
   *  - it roughly doubles the fill control surface — five more `when`-gated
   *    keys plus a shader arm plus a second anchor question (does the stroke
   *    share `fillAnchor` or own one?), and neither answer is free;
   *  - it multiplies every downstream task in this plan: two paint servers to
   *    dedupe in the SVG spine, an export tier that becomes `max(fill, stroke)`
   *    rather than a property of one value, a second shader field competing for
   *    the 4-live-field ceiling;
   *  - the demand is asymmetric. `strokeWidth` is 0 by default, so the stroke
   *    paints nothing until the user asks for it, and its colour control is
   *    withheld until then — most users would never see the extra knobs, while
   *    every user sees the fill.
   *
   * It stays cheap to add later precisely because nothing here forecloses it:
   * widening `stroke` to `Paint` is purely additive, the resolver is per-call,
   * and `hasStroke` is already the gate the extra controls would hang off.
   */
  stroke: string
  /** Outline width in OUTPUT pixels (so it does not shrink with `size`). 0 = no stroke. */
  strokeWidth: number
  motion: VtMotionConfig
}

export const DEFAULT_STAGGER: VtStaggerConfig = { delay: 0, order: 'forward', seed: 0 }

export const DEFAULT_MOTION: VtMotionConfig = {
  tracks: [], duration: 4, fps: 30, size: 1080, stagger: { ...DEFAULT_STAGGER },
}

export const DEFAULT_CONFIG: VectorTypeConfig = {
  text: 'Vector',
  fontId: DEFAULT_FONT_ID,
  axes: {},
  size: 120,
  tracking: 0,
  align: 'center',
  // The same white the legacy `fill: '#ffffff'` painted, said in the fill
  // vocabulary — so the default config's PIXELS are unchanged by this task.
  fill: { ...DEFAULT_FILL },
  // `glyph` is the identity-preserving default: it is what the renderer already
  // does, and for a solid fill all three anchors are the same picture. Task 3
  // lands the three sampling spaces against that known baseline rather than
  // changing the default in the same commit as the mechanism.
  fillAnchor: 'glyph',
  stroke: '#000000',
  strokeWidth: 0,
  // Spread is shallow: `stagger` must be copied too, or DEFAULT_CONFIG and
  // DEFAULT_MOTION would share one mutable object.
  motion: { ...DEFAULT_MOTION, tracks: [], stagger: { ...DEFAULT_STAGGER } },
}

/** Every catalog font id, in catalog order. Exported so the control schema
 *  offers exactly the set `mergeConfig` will accept — a second hand-written
 *  list would silently drift the moment a family is added or removed. */
export const VT_FONT_IDS: string[] = VARIABLE_FONTS.map(f => f.id)

export const VT_ALIGNS = ['left', 'center', 'right'] as const
export const VT_EASINGS = ['linear', 'pingpong', 'easeinout'] as const
export const VT_STAGGER_ORDERS = ['forward', 'reverse', 'center', 'edges', 'random'] as const
/** Upper bound on the per-glyph delay. A whole second between letters is
 *  already longer than most clips; beyond that the tail never enters. */
export const VT_STAGGER_DELAY_MAX = 1
/** Seeds are small integers so the "re-roll the shuffle" control is a short drag. */
export const VT_STAGGER_SEED_MAX = 999
/** Export heights the motion block accepts, matching gradientfx's. */
export const VT_MOTION_SIZES = [1080, 1440, 2160] as const

/** The three preset slots, in evaluation order. */
export const VT_PRESET_SLOTS = ['in', 'out', 'loop'] as const
export type VtPresetSlot = (typeof VT_PRESET_SLOTS)[number]

/** Phase length a slot gets when a stored spec has none, matching what the
 *  Compositor's editor writes (`MotionLayerEditor.assign`) so the same preset
 *  reads the same speed in both studios. */
export const VT_PRESET_DURATIONS: Record<VtPresetSlot, number> = { in: 0.8, out: 0.8, loop: 1.5 }

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? (v as T) : d
const oneOfNum = (v: unknown, allowed: readonly number[], d: number): number =>
  (typeof v === 'number' && allowed.includes(v)) ? v : d
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * An OpenType axis tag is exactly four printable-ASCII characters.
 *
 * A deliberate one-line twin of `isValidAxisTag` in ./font.ts rather than an
 * import: font.ts loads fontkit at module scope, and this module is pulled into
 * the Collection control resolver and every node card. The two are pinned to
 * agree by a test (vectortype-controls.unit.spec.ts) rather than by hope.
 */
export function isAxisTag(tag: unknown): boolean {
  return typeof tag === 'string' && /^[\x20-\x7E]{4}$/.test(tag)
}

/**
 * Rebuild the glyph paint — and LIFT A LEGACY COLOUR STRING.
 *
 * ## Trap 5, and it is the whole reason this function exists
 *
 * Every Vector Type node saved before this task holds `fill: '#ffffff'` — a
 * bare string. `Paint` still ACCEPTS a bare string, so nothing would throw and
 * nothing would look wrong at first glance; what would break is every dotted
 * control key (`fill.type`, `fill.a`, …), which would resolve against a string
 * and silently address nothing. So the string is lifted to a solid `Fill`
 * HERE, at the one function every read path goes through, rather than defended
 * against at each renderer.
 *
 * Only `a` is seeded from the legacy colour. `b`/`angle`/`density` come from
 * `DEFAULT_FILL`, which is what a fresh solid fill has always had, and
 * `textColor` stays at its default because Vector Type never reads it (see the
 * note on `VectorTypeConfig.fill`).
 *
 * ## Why the lift happens BEFORE `normalizePaint`, not inside it
 *
 * `normalizePaint`'s first arm passes a string through UNCHANGED, deliberately
 * — for `ShaderSpec.input` a flat colour IS a valid terminal value. That
 * contract is not ours to change, so the lift is a pre-step and everything
 * after it is `normalizePaint` verbatim: no second normaliser, and in
 * particular no second copy of its DEPTH-1 shader-nesting guard, which is what
 * stops a shader-inside-a-shader from hanging the renderer.
 *
 * `depth: 0` is the top level, so `type: 'shader'` is accepted here and refused
 * one level down inside the spec's own `input`.
 *
 * EXPORTED because `mergeConfig` is not the only place a config is BUILT.
 * `thumbPreview.ts` assembles one directly from a `VtThumbSpec` (it is not
 * loading a stored blob, so it has nothing to merge), and a tile whose `fill`
 * did not go through the same lift would be a config `mergeConfig` rejects —
 * which is exactly what its own round-trip test pins.
 */
export function mergeFill(raw: unknown): Paint {
  const seed = typeof raw === 'string' ? { ...DEFAULT_FILL, a: raw } : raw
  return finitePaint(normalizePaint(seed, 0))
}

/**
 * Repair non-finite `angle`/`density` on the `Fill` arm.
 *
 * NOT a second normaliser, and deliberately not a change to `normalizePaint`:
 * it runs AFTER it, adds no arms, and enforces nothing about shape. It enforces
 * the one invariant this schema holds everywhere else and `normalizeFill` does
 * not — `num()` above rejects `NaN`/`Infinity` on every other numeric field,
 * because a non-finite number does not fall back at the renderer, it propagates
 * (`Math.max(1, Math.round(NaN))` is `NaN`, and `fillTileBox`'s cell maths then
 * produces a blank tile with no error anywhere).
 *
 * `normalizeFill` keeps a `NaN` density because Space Type's own consumers have
 * always tolerated it; changing that is not this task's to make, so the repair
 * lives here where the stricter contract already is.
 *
 * Recursion is bounded by the SAME depth-1 guard: at depth 1 `normalizeFill`
 * refuses `type: 'shader'` and drops a `shader` field from any non-shader fill,
 * so a shader's `input` can never itself carry one and this cannot loop.
 */
function finitePaint(p: Paint): Paint {
  if (!isFill(p)) return p
  const out: Fill = {
    ...p,
    angle: Number.isFinite(p.angle) ? p.angle : DEFAULT_FILL.angle,
    density: Number.isFinite(p.density) ? p.density : DEFAULT_FILL.density,
  }
  if (out.shader) out.shader = { ...out.shader, input: finitePaint(out.shader.input) }
  return out
}

/** Deep copy of a `Paint` — see `cloneConfig`, which needs one because motion
 *  writes THROUGH the clone (`fill.angle`/`fill.density` are animatable, and a
 *  shared `fill` object would write frame 37 back into the config the surface
 *  is holding and then save it). Tolerant of a config straight out of storage,
 *  same as its caller: a string clones as itself. */
function clonePaint(p: Paint): Paint {
  if (typeof p !== 'object' || p === null) return p
  if (isGradient(p)) return { ...p, stops: (p as Gradient).stops.map(s => ({ ...s })) } as Gradient
  const f = p as Fill
  if (!f.shader) return { ...f }
  return {
    ...f,
    shader: { ...f.shader, params: { ...f.shader.params }, input: clonePaint(f.shader.input) },
  }
}

/** Rebuild the axes record: four-char tags mapped to finite numbers, nothing else.
 *  A stringified number is REJECTED rather than coerced — `Number('')` is 0 and
 *  `Number('700abc')` is NaN, so coercion here would invent axis positions. */
function mergeAxes(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [tag, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAxisTag(tag)) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    out[tag] = v
  }
  return out
}

/** Rebuild one motion track, or null if it targets nothing. A track without a
 *  path cannot be evaluated or edited — it would sit in the timeline forever
 *  doing nothing — so it is dropped rather than defaulted to some path. */
function mergeTrack(raw: unknown): VtMotionTrack | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const path = typeof o.path === 'string' ? o.path.trim() : ''
  if (!path) return null
  return {
    path,
    from: num(o.from, 0),
    to: num(o.to, 0),
    easing: oneOf(o.easing, VT_EASINGS, 'linear'),
    loops: Math.max(1, Math.round(num(o.loops, 1))),
    hold: clamp(num(o.hold, 0), 0, 0.5),
    cycleOffset: clamp(num(o.cycleOffset, 0), 0, 1),
    delay: Math.max(0, num(o.delay, 0)),
  }
}

/** Rebuild the stagger block. Same strictness as everything else here: an
 *  unknown order, a NaN delay or a fractional seed can only ever yield the
 *  default, never a value the evaluator has to defend against. */
function mergeStagger(raw: unknown): VtStaggerConfig {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  return {
    // Negative delays are not "reverse" — `order` already says that — so they
    // clamp to 0 rather than silently inverting the queue.
    delay: clamp(num(o.delay, DEFAULT_STAGGER.delay), 0, VT_STAGGER_DELAY_MAX),
    order: oneOf(o.order, VT_STAGGER_ORDERS, DEFAULT_STAGGER.order),
    seed: clamp(Math.round(num(o.seed, DEFAULT_STAGGER.seed)), 0, VT_STAGGER_SEED_MAX),
  }
}

/** Rebuild a preset's knob values: finite numbers only, and `undefined` rather
 *  than an empty record so an untouched preset stores nothing. A non-numeric
 *  knob is DROPPED, not coerced — `resolveParams` spreads this straight over the
 *  preset defaults, so a `"3"` would reach the maths as a string. */
function mergeParams(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Rebuild one preset slot, or `undefined` if it names no preset.
 *
 * Same rule as `mergeTrack`: a spec with no `presetId` cannot be evaluated or
 * edited, so it is dropped rather than defaulted to some preset the user never
 * picked. An UNKNOWN-but-well-formed id is KEPT — the config layer does not own
 * the preset catalog, and dropping ids would silently delete a newer version's
 * work on an older load (the same reason `mergeAxes` keeps a tag the current
 * font lacks). `./presetMotion.ts` refuses to evaluate an id the engine does not
 * have rather than guessing, so an unknown id animates nothing instead of
 * animating the wrong thing.
 *
 * `stagger` IS NOT CARRIED. `LayerAnimSpec.stagger` and `motion.stagger.delay`
 * are two spellings of the same idea, and Vector Type already has the richer one
 * (delay + order + seed, feeding `glyphTime`). The evaluator therefore drives the
 * engine with a per-glyph CLOCK and a zeroed spec stagger, which makes a stored
 * `stagger` structurally dead — so it is not stored, rather than stored and
 * silently ignored.
 */
function mergeAnimSpec(raw: unknown, slot: VtPresetSlot): LayerAnimSpec | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const presetId = typeof o.presetId === 'string' ? o.presetId.trim() : ''
  if (!presetId) return undefined
  const spec: LayerAnimSpec = {
    presetId,
    // 0.05 is the engine's own floor (MIN_UNIT_DUR); below it a phase cannot be
    // seen, and `evaluateAnimation` clamps there anyway.
    duration: clamp(num(o.duration, VT_PRESET_DURATIONS[slot]), 0.05, 60),
  }
  const ease = typeof o.ease === 'string' ? o.ease.trim() : ''
  if (ease) spec.ease = ease
  const params = mergeParams(o.params)
  if (params) spec.params = params
  return spec
}

function mergeMotion(raw: unknown): VtMotionConfig {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const rawTracks = Array.isArray(o.tracks) ? o.tracks : []
  const tracks: VtMotionTrack[] = []
  for (const t of rawTracks) {
    const track = mergeTrack(t)
    if (track) tracks.push(track)
  }
  // Spread-when-present, not `in: undefined`: an absent slot must leave no key
  // behind, so a round-tripped default config is byte-identical to the default.
  const slots: Partial<Record<VtPresetSlot, LayerAnimSpec>> = {}
  for (const slot of VT_PRESET_SLOTS) {
    const spec = mergeAnimSpec(o[slot], slot)
    if (spec) slots[slot] = spec
  }
  return {
    tracks,
    duration: clamp(num(o.duration, DEFAULT_MOTION.duration), 0.1, 60),
    fps: clamp(Math.round(num(o.fps, DEFAULT_MOTION.fps)), 1, 60),
    size: oneOfNum(o.size, VT_MOTION_SIZES, DEFAULT_MOTION.size),
    stagger: mergeStagger(o.stagger),
    ...slots,
  }
}

/**
 * Rebuild an untrusted parsed value into a valid VectorTypeConfig.
 *
 * Every field is checked against its own type and domain; anything that fails
 * falls back to the default. `null`, `{}`, an array, a string, a config from a
 * version that spelled a field differently — all yield a usable config.
 */
export function mergeConfig(raw: unknown): VectorTypeConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const d = DEFAULT_CONFIG
  return {
    text: str(o.text, d.text),
    // An unknown font id is NOT kept: every later stage (the proxy, the loader,
    // the axis controls) resolves it against the catalog, so keeping it would
    // leave the studio pointing at a font that can never load.
    fontId: oneOf(o.fontId, VT_FONT_IDS, d.fontId),
    axes: mergeAxes(o.axes),
    size: num(o.size, d.size),
    tracking: num(o.tracking, d.tracking),
    align: oneOf(o.align, VT_ALIGNS, d.align),
    fill: mergeFill(o.fill),
    fillAnchor: oneOf(o.fillAnchor, VT_FILL_ANCHORS, d.fillAnchor),
    stroke: str(o.stroke, d.stroke),
    strokeWidth: num(o.strokeWidth, d.strokeWidth),
    motion: mergeMotion(o.motion),
  }
}

/** A deep copy safe to mutate — what motion evaluation clones before applying
 *  tracks, and what the surface hands to a preview render. */
export function cloneConfig(cfg: VectorTypeConfig): VectorTypeConfig {
  // Tolerant of a config straight out of storage (`motion`/`tracks`/`stagger`
  // absent), because `applyMotion` clones BEFORE anything normalises — see the
  // choke-point note in ./motion.ts. Values are copied, never invented: a
  // missing block clones as empty and the evaluator resolves defaults itself.
  const m = cfg.motion
  // Preset slots carry a nested `params` record, so a shallow spread would leave
  // the clone sharing one knob object with its source.
  const spec = (s: LayerAnimSpec | undefined): LayerAnimSpec | undefined =>
    s ? { ...s, ...(s.params ? { params: { ...s.params } } : {}) } : undefined
  const slots: Partial<Record<VtPresetSlot, LayerAnimSpec>> = {}
  for (const slot of VT_PRESET_SLOTS) {
    const copy = spec(m?.[slot])
    if (copy) slots[slot] = copy
  }
  return {
    ...cfg,
    axes: { ...cfg.axes },
    // `fill` is now a mutable OBJECT, so the shallow spread above would leave
    // the clone sharing it. `fill.angle`/`fill.density` are animatable sliders,
    // and `applyMotion` writes THROUGH this clone: without the deep copy, frame
    // 37's angle lands in the config the surface is holding — and, because
    // `DEFAULT_CONFIG.fill` is one object, in the module-level default too.
    fill: clonePaint(cfg.fill),
    motion: {
      ...m,
      stagger: { ...m?.stagger } as VtStaggerConfig,
      tracks: Array.isArray(m?.tracks) ? m.tracks.map(t => ({ ...t })) : [],
      ...slots,
    },
  }
}
