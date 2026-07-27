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
import { DEFAULT_FONT_ID, VARIABLE_FONTS } from '~/data/variable-fonts'

/** Horizontal anchoring of the (single-line, v1) glyph run. */
export type VtAlign = 'left' | 'center' | 'right'

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
  /** Glyph body colour, `#rrggbb` (validatePatch accepts nothing else). */
  fill: string
  /** Outline colour, `#rrggbb`. Only paints when `strokeWidth > 0`. */
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
  fill: '#ffffff',
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
    fill: str(o.fill, d.fill),
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
    motion: {
      ...m,
      stagger: { ...m?.stagger } as VtStaggerConfig,
      tracks: Array.isArray(m?.tracks) ? m.tracks.map(t => ({ ...t })) : [],
      ...slots,
    },
  }
}
