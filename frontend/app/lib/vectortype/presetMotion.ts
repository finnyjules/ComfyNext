/**
 * Vector Type Studio — the shared motion engine, adapted to glyphs. PURE.
 *
 * `./motion.ts` animates the CONFIG (tracks over dotted paths, on a per-glyph
 * clock). This module animates the same glyphs from the OTHER motion source: the
 * Compositor's kinetic preset engine (`~/lib/motion/evaluate`), so Vector Type
 * gets Fade / Slide / Mask / Grow / Blur without a second evaluator — plus the
 * variable-AXIS presets in `./axisPresets.ts`, which cannot live in the shared
 * engine because their values are fractions of the loaded font's own axis
 * ranges. Both tables are dispatched from `unitStateFor` below, on one clock.
 *
 * The two sources are complementary and BOTH ACTIVE AT ONCE. A user with a
 * Slide-Up preset and an `axes.wght` track must see the word slide in *and* the
 * weight wave travel. `vtGlyphMotion` is the one place they meet.
 *
 * ## Three things this file exists to get right
 *
 * ### 1. The coordinate spaces differ — multiply by the em
 *
 * `UnitState.dx/dy/blur` are in UNIT-BOX HEIGHTS (a normalised space: 1 = the
 * height of the animated unit's own box). `VtGlyphTransform.dx/dy` are OUTPUT
 * PIXELS, because that is what `render.ts` places glyphs in and what
 * `drawVectorType` feeds to `ctx.translate`.
 *
 * Vector Type's unit box is the EM, whose height in output pixels is exactly
 * `config.size` (that is the control's definition — CSS `font-size` semantics,
 * `scale = size / unitsPerEm`). So every spatial quantity crossing this boundary
 * is multiplied by `size`.
 *
 * Forget it and a preset looks *almost right at one font size* and wrong at
 * every other, which is why the tests pin it at two sizes rather than one:
 * a missing multiply is invisible in a single-size test.
 *
 * The em is read at the RUN clock, not the glyph's — `size` is itself animatable,
 * and `vtPlacement` scales the whole run by `applyMotion(cfg, t).size`. Using a
 * per-glyph em here would make the offsets disagree with the geometry they move.
 *
 * ### 2. There is only ONE stagger, and it is Vector Type's
 *
 * `LayerAnimSpec.stagger` (seconds between units, inside `evaluateAnimation`) and
 * `motion.stagger` (delay + order + seed, feeding `glyphTime`) are two spellings
 * of the same idea. Two live stagger sources would fight — the engine's is
 * forward-only and defaults to 0.04 even when absent, so a user who set `order:
 * 'edges'` would get an edges wave with a forward wave underneath it.
 *
 * So: **`motion.stagger` wins, always.** The engine is driven at the glyph's own
 * `glyphTime()` clock with the spec's `stagger` forced to 0, which makes the
 * engine's own offset structurally inert rather than merely unused.
 * `mergeConfig` does not even store `stagger` for the same reason.
 *
 * The glyph's real `i`/`n` are still passed through, because seeded presets
 * (`glitch-in`, `wiggle`) key their randomness on the unit index — collapsing
 * that to `n = 1` would give every letter identical jitter.
 *
 * ### 3. Presets and tracks ADD; they never overwrite
 *
 * The previous plan shipped a bug of exactly this shape (a Collection sweep and a
 * motion track wrote the same path; `applyMotion` overwrote the sweep, and five
 * identical baked PNGs looked perfectly fine). Here the rule is spelled out and
 * tested: **offsets and rotation add, scale and opacity multiply.** Both operands
 * are identity-at-rest (0 / 1), so a config with only one source is bit-identical
 * to what that source produced alone.
 */
import type { FrameMotion, LayerAnimation, LayerAnimSpec } from '~/lib/motion/types'
import type { PresetCapability, UnitState } from '~/lib/motion/evaluate'
import {
  ALL_PRESET_CAPABILITIES,
  IDENTITY_UNIT,
  evaluateAnimation,
  presetIdsFor,
  presetNeedsStagger,
} from '~/lib/motion/evaluate'
import { resolveEase } from '~/lib/motion/easing'
// TYPE-ONLY against ./font.ts (it loads fontkit at module scope); ./axisPresets
// is deliberately type-only against it too, so this stays a light import.
import type { VtAxis } from './font'
import {
  VT_EVAL,
  vtAxisDelta,
  vtAxisOffersFor,
  vtAxisPreset,
  vtAxisPresetIdsFor,
  type VtAxisOffer,
} from './axisPresets'
import {
  DEFAULT_CONFIG,
  DEFAULT_MOTION,
  VT_PRESET_SLOTS,
  type VectorTypeConfig,
  type VtPresetSlot,
} from './config'
import {
  IDENTITY_GLYPH_TRANSFORM,
  glyphTime,
  glyphTransform,
  resolveStagger,
  type VtGlyphTransform,
} from './motion'
// The THIRD motion source (Task 3). Pure arithmetic over `./random`, so it costs
// this module nothing beyond the call.
import {
  vtBlinkActive,
  vtBlinkOpacity,
  vtBlinkUnitIndex,
  vtResolveBlink,
} from './blink'
// The FOURTH motion source (Task 4). Pure arithmetic over `./random` and the
// font's declared axis ranges, so it costs this module nothing beyond the call.
import {
  vtResolveScatter,
  vtScatterActive,
  vtScatterDelta,
  vtScatterStillTime,
} from './scatter'
import { trackValue } from '~/lib/studio/track'

/** A one-sided reveal of the glyph's own box: `amount` is the fraction hidden
 *  from `side`. Structurally `UnitState['clip']`, restated as a named type
 *  because it is part of this module's published output. */
export interface VtGlyphClip {
  side: 'top' | 'bottom' | 'left' | 'right'
  amount: number
}

/**
 * THE OUTPUT SHAPE. Everything one glyph's motion produces at one instant.
 *
 * A superset of `VtGlyphTransform`, so anything already reading `dx/dy/scale/
 * rotate/opacity` off `VtFrame.transforms` keeps working untouched, and the new
 * fields ride along for the renderer that learns to consume them.
 *
 * Units, spelled out because the whole point of this module is the conversion:
 *
 * | field            | unit                              | rest  |
 * |------------------|-----------------------------------|-------|
 * | `dx`, `dy`       | OUTPUT PIXELS (y-DOWN, like canvas), along the GLYPH'S OWN axes — `dy` is a baseline shift, so on an arc'd run it moves the letter off its own baseline rather than down the screen (`vtGlyphOffset`). Identical on a straight run. | 0   |
 * | `scale`          | multiplier, uniform               | 1     |
 * | `scaleX`,`scaleY`| extra per-axis multipliers (flips) | 1     |
 * | `rotate`         | degrees, clockwise                | 0     |
 * | `opacity`        | 0..1 multiplier                   | 1     |
 * | `blur`           | OUTPUT PIXELS of blur radius      | 0     |
 * | `clip`           | fraction of the glyph box hidden  | null  |
 * | `axes`           | variable-font axis DELTAS by tag  | `{}`  |
 *
 * `blur`, `clip`, `scaleX/scaleY` and `axes` are PRODUCED here and consumed by
 * the canvas/SVG renderers in later tasks. They are always present (0 / null /
 * `{}` at rest) so a consumer never has to distinguish "absent" from "neutral".
 */
export interface VtGlyphMotion extends VtGlyphTransform {
  scaleX: number
  scaleY: number
  /** Blur radius in OUTPUT PIXELS (the engine's unit-box value × em). */
  blur: number
  clip: VtGlyphClip | null
  /** Axis DELTAS by OpenType tag, to be ADDED to the glyph's resting axis
   *  positions (`{ wght: -300 }` = 300 lighter than the config says). Empty at
   *  rest. Deltas, not absolutes, so an axis preset composes with whatever the
   *  user set and with an axis track. */
  axes: Record<string, number>
}

export const IDENTITY_GLYPH_MOTION: Readonly<VtGlyphMotion> = Object.freeze({
  ...IDENTITY_GLYPH_TRANSFORM,
  scaleX: 1,
  scaleY: 1,
  blur: 0,
  clip: null,
  axes: Object.freeze({}) as Record<string, number>,
})

const CLIP_SIDES = ['top', 'bottom', 'left', 'right'] as const

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const fin = (v: unknown, d: number): number => (isNum(v) ? v : d)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * What this studio can draw, in the engine's own vocabulary.
 *
 * `drawVectorType` applies `blur`, `clip`, `scaleX/scaleY` and per-glyph `axes`
 * to real outlines, so Vector Type takes everything the engine offers EXCEPT
 * `copies`: a copy is an extra whole-unit draw, and `VtGlyphMotion` has no field
 * for one. Subtracted from `ALL_PRESET_CAPABILITIES` rather than re-typed, so a
 * capability added to the engine arrives here automatically and only the one
 * genuine gap is stated.
 *
 * ONE list, and everything reads it: `KNOWN_IDS` below (what a stored config may
 * name), `vtPresetIdsFor` (what the gallery offers) and the surface's
 * `:capabilities` prop (what the tiles are allowed to draw). Before this the
 * gallery filtered copy-based presets through a private set inside
 * `MotionPresetPicker` while `vtKnowsPreset` accepted them — so an imported
 * config reported "animated" over a frozen word.
 */
export const VT_PRESET_CAPABILITIES: readonly PresetCapability[] =
  Object.freeze(ALL_PRESET_CAPABILITIES.filter(c => c !== 'copies'))

/**
 * The preset ids this studio can render faithfully.
 *
 * UNION with `./axisPresets`, whose table is Vector-Type-only for a structural
 * reason: an axis preset's values are fractions of the LOADED FONT'S range, and
 * the shared engine does not know which font is loaded (see that module's
 * header). Both halves are derived — nothing here is hand-listed.
 */
const KNOWN_IDS: Record<VtPresetSlot, ReadonlySet<string>> = {
  in: new Set([...presetIdsFor('in', VT_PRESET_CAPABILITIES), ...Object.keys(VT_EVAL.in)]),
  out: new Set([...presetIdsFor('out', VT_PRESET_CAPABILITIES), ...Object.keys(VT_EVAL.out)]),
  loop: new Set([...presetIdsFor('loop', VT_PRESET_CAPABILITIES), ...Object.keys(VT_EVAL.loop)]),
}

/** True when SOME table — the engine's or this studio's — has a preset by that
 *  id for that slot. Font-independent on purpose: `vtHasPreset`/`vtIsAnimated`
 *  run against a raw stored blob with no font loaded, so "do we know this id"
 *  and "can this font run it" have to stay separate questions. The second is
 *  `vtAxisAvailability`'s. */
export function vtKnowsPreset(slot: VtPresetSlot, presetId: unknown): boolean {
  return typeof presetId === 'string' && KNOWN_IDS[slot].has(presetId.trim())
}

/**
 * Everything a picker should offer for a slot, given the loaded font's axes.
 *
 * The engine's capability-gated ids (renderable by anything Vector Type draws)
 * plus the axis presets this font can actually run. Task 9's gallery calls this
 * for the ids and `vtAxisOffersFor` for the greyed-out tiles and their reasons —
 * it never assembles a list of its own.
 */
export function vtPresetIdsFor(slot: VtPresetSlot, axes?: readonly VtAxis[] | null): string[] {
  return [...presetIdsFor(slot, VT_PRESET_CAPABILITIES), ...vtAxisPresetIdsFor(slot, axes)]
}

/** The axis tiles for a slot, available ones and unavailable ones with their
 *  reasons. Re-exported here so a surface has ONE import for its preset menu. */
export function vtAxisOffers(
  slot: VtPresetSlot,
  axes?: readonly VtAxis[] | null,
  fontLabel?: string,
): VtAxisOffer[] {
  return vtAxisOffersFor(slot, axes, fontLabel)
}

/**
 * The slots that will actually animate, from a config of any vintage.
 *
 * Defensive for the reason `./motion.ts` is: only the editor surface holds a
 * `mergeConfig`-ed ref — the node card, the baker and the frame source read
 * `properties.sailor_vectorType` as parsed JSON. So a `motion` that is missing, a
 * string, or an array must behave as "no presets" rather than throw.
 *
 * An id the engine does not have is DROPPED here rather than passed on:
 * `evaluateAnimation` silently substitutes `fade-in`/`fade-out` for an unknown
 * id, so forwarding it would show the user a fade they never asked for.
 */
export function vtPresetSpecs(cfg: VectorTypeConfig | null | undefined): Partial<Record<VtPresetSlot, LayerAnimSpec>> {
  const m = cfg?.motion as Record<string, unknown> | undefined
  const out: Partial<Record<VtPresetSlot, LayerAnimSpec>> = {}
  if (!m || typeof m !== 'object') return out
  for (const slot of VT_PRESET_SLOTS) {
    const raw = m[slot] as Partial<LayerAnimSpec> | undefined
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    if (!vtKnowsPreset(slot, raw.presetId)) continue
    out[slot] = {
      presetId: (raw.presetId as string).trim(),
      duration: Math.max(0.05, fin(raw.duration, 0.8)),
      // See the header: the engine's own stagger is forced off so `motion.stagger`
      // is the single source. Not "left absent" — absent means 0.04.
      stagger: 0,
      ...(typeof raw.ease === 'string' && raw.ease.trim() ? { ease: raw.ease.trim() } : {}),
      ...(raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
        ? { params: raw.params as Record<string, number> }
        : {}),
    }
  }
  return out
}

/**
 * The stagger a typing preset needs to type, in seconds between glyphs.
 *
 * Small on purpose: at 6 glyphs it spreads the entrance over 0.30 s, which reads
 * as typing without making the entrance feel slower than the duration the user
 * set. It is a STARTING POINT, not a lock — the Stagger slider owns it from the
 * moment it is applied.
 */
export const VT_TYPING_STAGGER = 0.06

/**
 * The delay to adopt when a stagger-dependent preset is picked, or null to leave
 * `motion.stagger.delay` alone.
 *
 * WHY A BUMP RATHER THAN HIDING THE TILE. `typewriter` works perfectly here at
 * any non-zero delay (Task 10 measured it typing at 0.15); it is only the
 * shipped DEFAULT of 0 that makes it inert. Hiding it would delete a working —
 * and, in a type studio, conspicuously expected — preset to dodge a default.
 * Task 4's single-stagger rule is untouched: this moves Vector Type's own
 * stagger, the one source there is, and does not resurrect the engine's.
 *
 * The change must be VISIBLE, and it is, in three places: the Stagger slider in
 * the Motion section moves, the surface writes it through the same `setControl`
 * path a user drag takes (so it is an ordinary undoable edit, not a hidden
 * mutation), and the Presets section says what it did.
 *
 * Null whenever the user already has a stagger — their value is never
 * overwritten — and null for every preset that does not need one, so picking
 * `appear` (the same step function, but doing exactly what its label promises)
 * has no side effect on a setting that is global across slots and tracks.
 */
export function vtStaggerBumpFor(presetId: unknown, currentDelay: unknown): number | null {
  if (!presetNeedsStagger(presetId)) return null
  return isNum(currentDelay) && currentDelay > 0 ? null : VT_TYPING_STAGGER
}

/**
 * The slots holding a preset that CANNOT express itself at the config's stored
 * stagger — i.e. a tile that is silently doing nothing.
 *
 * The bump above covers the moment of picking. This covers everything else: a
 * config imported from JSON, an agent-written one, or a user who dragged Stagger
 * back to 0 afterwards. The surface renders it as a warning next to the slot, so
 * "the preview is frozen and I do not know why" is never the user's problem to
 * work out.
 */
export function vtStaggerStarvedSlots(cfg: VectorTypeConfig | null | undefined): VtPresetSlot[] {
  const { delay } = resolveStagger(cfg as VectorTypeConfig)
  if (isNum(delay) && delay > 0) return []
  const specs = vtPresetSpecs(cfg)
  return VT_PRESET_SLOTS.filter(s => presetNeedsStagger(specs[s]?.presetId))
}

/** True when any slot names a preset the engine can actually run. The `?` in
 *  `vtIsAnimated`'s widening (trap 2: a preset-only config used to report
 *  "not animated" and render frozen). */
export function vtHasPreset(cfg: VectorTypeConfig | null | undefined): boolean {
  for (const slot of VT_PRESET_SLOTS) {
    const raw = (cfg?.motion as any)?.[slot]
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && vtKnowsPreset(slot, raw.presetId)) return true
  }
  return false
}

/** Clip length in seconds, however the blob spells it. */
function clipDuration(cfg: VectorTypeConfig | null | undefined): number {
  return Math.max(0.001, fin(cfg?.motion?.duration, DEFAULT_MOTION.duration))
}

/**
 * The em height in OUTPUT PIXELS at run time `t` — the number every spatial
 * conversion in this file goes through.
 *
 * `size` is animatable, so this is not simply `cfg.size`: it is `cfg.size` as a
 * `size` track would have written it. Evaluated directly from the tracks rather
 * than via `applyMotion` so that resolving one number does not clone the config
 * once per glyph per frame.
 */
export function vtEmSize(cfg: VectorTypeConfig | null | undefined, t: number): number {
  let em = fin(cfg?.size, DEFAULT_CONFIG.size)
  const tracks = cfg?.motion?.tracks
  if (Array.isArray(tracks)) {
    const d = clipDuration(cfg)
    for (const tr of tracks) {
      if (!tr || typeof tr !== 'object' || tr.path?.trim?.() !== 'size') continue
      if (!isNum(tr.from) || !isNum(tr.to)) continue
      em = trackValue(tr, t, d)
    }
  }
  return isNum(em) ? em : DEFAULT_CONFIG.size
}

/**
 * The instant a SINGLE still frame should be sampled at — 0 for a config with no
 * entrance, the moment the entrance has finished for one that has.
 *
 * The still bakes (the render cascade's PNG, the Collection param baker) render
 * `t = 0`. An entrance preset's whole point is that `t = 0` is FULLY OUT, so with
 * presets live those bakes would produce a blank or half-formed PNG and nothing
 * would error — the exact failure mode this plan keeps finding. A track could do
 * this too (`glyph.opacity` 0→1), but a preset does it by default, so the still
 * time has to be derived rather than assumed.
 *
 * The word is at rest one in-duration after the LAST glyph starts, i.e. after the
 * whole stagger queue has run. Capped at the exit's start (and at the clip) so a
 * clip too short to hold a resting frame gives the latest one that is not already
 * leaving, rather than a frame past the end.
 *
 * A SETTLING SCATTER is an entrance too, and it is counted here for exactly the
 * same reason (`vtScatterStillTime`). Its `t = 0` is the MOST scattered frame
 * there is, so without this line a config whose only motion is a settle would
 * bake its PNG, its node thumbnail and every Collection row at maximum scatter —
 * the panel reading `Weight 400` over a picture with nine weights in it, and
 * nothing erroring. A `wander` contributes 0, correctly: it never finishes, and
 * its `t = 0` already IS the configured word.
 */
export function vtStillTime(cfg: VectorTypeConfig | null | undefined): number {
  const specs = vtPresetSpecs(cfg)
  const settle = vtScatterStillTime(cfg)
  if (!specs.in && !(settle > 0)) return 0
  const inDur = specs.in ? specs.in.duration : 0
  const duration = clipDuration(cfg)
  const glyphs = Math.max(1, [...String(cfg?.text ?? '')].length)
  const { delay } = resolveStagger(cfg as VectorTypeConfig)
  const rest = Math.max(inDur, settle) + delay * (glyphs - 1)
  const outStart = specs.out
    ? Math.max(inDur, duration - specs.out.duration)
    : duration
  return Math.max(0, Math.min(rest, outStart, duration - 1e-6))
}

/** The engine's floor on a unit's animating window (`MIN_UNIT_DUR`). Restated
 *  rather than imported because `evaluate.ts` keeps it private; the parity test
 *  pins the two together against real engine output. */
const MIN_UNIT_DUR = 0.05

/** Which slot owns time `gt`, and how far through it that glyph is. */
export interface VtSlotPhase {
  slot: VtPresetSlot
  /** EASED progress 0→1 for `in`/`out`; RAW phase 0→1 for `loop`. */
  e: number
}

/**
 * The slot the clock is inside, mirroring `evaluateAnimation`'s own branch
 * order exactly: `in` while `gt < inDuration`, then `out` from `outStart`, then
 * `loop`. Returns null when nothing is live.
 *
 * This exists because the axis presets are evaluated OUTSIDE the engine (their
 * values depend on the loaded font, which the engine does not know), and they
 * must still land on the same instant as an engine preset would — otherwise a
 * `weight-in` and a `slide-up` picked together would finish at different times.
 *
 * It is a restatement of engine-private arithmetic, which is a drift risk, so
 * the spec cross-checks it against real `evaluateAnimation` output on presets
 * whose easing is `none` (fade-in's opacity IS `e`, fade-out's is `1 − e`,
 * spin-loop's rotation is `360·phase`). If the engine's windowing ever changes,
 * that test goes red rather than the axis presets quietly desynchronising.
 *
 * The engine's own stagger is 0 here (see the header), so a unit's window is
 * the whole slot and `unitProgress` collapses to `gt / duration`.
 */
export function vtSlotPhase(
  specs: Partial<Record<VtPresetSlot, LayerAnimSpec>>,
  gt: number,
  duration: number,
): VtSlotPhase | null {
  const W = Math.max(0.001, fin(duration, DEFAULT_MOTION.duration))
  const t = Math.max(0, fin(gt, 0))
  const inDur = specs.in ? Math.max(0.01, specs.in.duration) : 0
  const outDur = specs.out ? Math.max(0.01, specs.out.duration) : 0
  const outStart = Math.max(inDur, W - outDur)

  if (specs.in && t < inDur) {
    const eased = resolveEase(specs.in.ease ?? easeOf('in', specs.in.presetId))
    return { slot: 'in', e: eased(clamp01(t / Math.max(MIN_UNIT_DUR, specs.in.duration))) }
  }
  if (specs.out && t >= outStart && W > inDur) {
    const effDur = Math.max(0.01, W - outStart)
    const eased = resolveEase(specs.out.ease ?? easeOf('out', specs.out.presetId))
    return { slot: 'out', e: eased(clamp01((t - outStart) / Math.max(MIN_UNIT_DUR, effDur))) }
  }
  if (specs.loop) {
    const cycle = Math.max(0.1, specs.loop.duration)
    // Phase 0 at loop start, so an in→loop handoff is seamless (the engine's rule).
    const phase = (((t - inDur) / cycle) % 1 + 1) % 1
    return { slot: 'loop', e: phase }
  }
  return null
}

/** The default easing for a slot's preset — the axis table's own, so a Vector
 *  Type preset eases like the entrance it is unless the spec overrides it. */
function easeOf(slot: VtPresetSlot, presetId: string): string | undefined {
  return vtAxisPreset(slot, presetId)?.ease
}

/**
 * The environment an AXIS preset needs and the engine cannot supply: the loaded
 * font's real axis ranges, and where this glyph currently rests on them.
 *
 * Optional everywhere. Omit it and axis presets emit nothing at all — the
 * honest answer before a font has loaded, and the same rule `animatableTargets`
 * follows when it is handed no axes.
 */
export interface VtGlyphEnv {
  /** The loaded font's declared axes (`VtFont.axes`). */
  axes: readonly VtAxis[]
  /** This glyph's resting axis values — the config's `axes` as an axis TRACK
   *  would have written them at this glyph's clock. Defaults to `cfg.axes`. */
  resting?: Record<string, number> | null
  /**
   * Which WORD each glyph of the run belongs to — `wordIndexOfGlyph` over the
   * shaped run, index-aligned with it, `VT_NO_WORD` (`-1`) for a separator.
   *
   * Needed only by `unit: 'word'` blink, and needed from OUT HERE for the reason
   * the whole `words.ts` module takes a glyph run rather than a string: a
   * ligature makes glyph indices and character indices disagree, so the grouping
   * cannot be recovered from `cfg.text` and an index. `vectorTypeFrame` has the
   * shaped run and computes it once per frame.
   *
   * Omit it and word blink is INERT — never a silent fallback to letter blink.
   * See `vtBlinkUnitIndex`.
   */
  wordOf?: readonly number[] | null
}

/** @deprecated The env is no longer axis-only — it also carries the run's word
 *  grouping. Kept as an alias so existing importers compile unchanged. */
export type VtAxisEnv = VtGlyphEnv

/**
 * The engine's per-glyph state, or identity when no slot is live.
 *
 * COST: `evaluateAnimation` evaluates the whole run and we keep one unit, so a
 * frame is O(n²) preset calls. Deliberately not memoised — the obvious cache key
 * is the config OBJECT, and the surfaces mutate their config in place (a
 * reactive ref, same reference before and after an edit), so an identity-keyed
 * memo would serve stale motion the moment a slider moved while paused. The
 * arithmetic is a handful of floats per call against per-glyph font shaping and
 * a `Path2D` rebuild every frame, which are orders of magnitude dearer.
 */
function unitStateFor(
  cfg: VectorTypeConfig,
  t: number,
  index: number,
  count: number,
  env?: VtGlyphEnv | null,
): UnitState {
  const specs = vtPresetSpecs(cfg)
  if (!specs.in && !specs.out && !specs.loop) return IDENTITY_UNIT

  const duration = clipDuration(cfg)
  const n = Math.max(1, Math.floor(count))
  const i = Math.min(n - 1, Math.max(0, Math.floor(index)))

  // The glyph's own clock — the SAME `glyphTime` the tracks are read at, so one
  // stagger drives both sources and a wave cannot travel at two speeds.
  //
  // CLAMPED into the clip, never allowed to fall outside it. `evaluateAnimation`
  // reports HIDDEN outside [start, end): before its turn a staggered glyph would
  // vanish (right for an entrance, catastrophic for a loop — every glyph would
  // blink out for its first `rank·delay` seconds), and past the end the whole run
  // would disappear on the final frame of a bake. Clamping instead pins the
  // pre-roll to progress 0 (an entrance's own "fully out" state) and the tail to
  // the last frame's state, which is exactly what `trackValue` does with a
  // single-play track.
  const raw = glyphTime(cfg, t, i, n)
  const gt = Math.min(Math.max(0, isNum(raw) ? raw : 0), duration - 1e-6)

  // AXIS PRESETS FIRST. They are not in the engine's tables — their values are
  // fractions of the loaded font's own range, which the engine cannot know — so
  // the live slot is resolved here and, when it holds an axis preset, that
  // preset's output REPLACES what the engine would have returned for this
  // instant. The unknown id is still passed to `evaluateAnimation` below (for
  // the other slots' sake: `in`'s duration is what times a loop's handoff), and
  // the fade it substitutes is discarded on this branch rather than shown.
  const live = vtSlotPhase(specs, gt, duration)
  const axisPreset = live ? vtAxisPreset(live.slot, specs[live.slot]?.presetId) : null
  if (live && axisPreset) {
    const axes = env?.axes
    if (!axes?.length) return IDENTITY_UNIT
    const resting = env?.resting ?? (cfg?.axes as Record<string, number> | undefined) ?? null
    const delta = vtAxisDelta(axisPreset, live.e, i, n, axes, resting)
    // An axis preset moves ONLY axes: no offset, no scale, no fade. The word is
    // re-cut, not moved, which is the distinction the whole section rests on.
    return Object.keys(delta).length ? { ...IDENTITY_UNIT, axes: delta } : IDENTITY_UNIT
  }

  const anim: LayerAnimation = { offset: 0, duration, ...specs }
  const motion: FrameMotion = { fps: Math.max(1, fin(cfg?.motion?.fps, DEFAULT_MOTION.fps)), duration }
  const state = evaluateAnimation(anim, gt, motion, n)
  if (!state.visible) return IDENTITY_UNIT
  return state.units?.[i] ?? IDENTITY_UNIT
}

/**
 * What the PRESETS alone add to glyph `index` at time `t`.
 *
 * The unit conversion lives here and nowhere else: `dx`, `dy` and `blur` come out
 * of the engine in unit-box heights and leave in output pixels, multiplied by the
 * em at run time `t` (see the header, trap 1).
 *
 * `em` may be passed explicitly by a caller that has already resolved it — the
 * renderer knows the exact size it is drawing at, and passing it keeps the
 * transform and the geometry from resolving `size` twice.
 */
export function presetTransform(
  cfg: VectorTypeConfig,
  t: number,
  index: number,
  count: number,
  em: number = vtEmSize(cfg, t),
  env?: VtGlyphEnv | null,
): VtGlyphMotion {
  const u = unitStateFor(cfg, t, index, count, env)
  if (u === IDENTITY_UNIT) return { ...IDENTITY_GLYPH_MOTION, axes: {} }

  const scale = fin(u.scale, 1)
  const emPx = isNum(em) ? em : DEFAULT_CONFIG.size

  const axes: Record<string, number> = {}
  if (u.axes && typeof u.axes === 'object') {
    for (const [tag, v] of Object.entries(u.axes)) if (isNum(v) && v !== 0) axes[tag] = v
  }

  let clip: VtGlyphClip | null = null
  if (u.clip && (CLIP_SIDES as readonly string[]).includes(u.clip.side) && isNum(u.clip.amount)) {
    const amount = clamp01(u.clip.amount)
    // A zero-amount clip hides nothing; emitting it would make every consumer
    // set up a clipping region per glyph for no visual difference.
    if (amount > 0) clip = { side: u.clip.side, amount }
  }

  return {
    dx: fin(u.dx, 0) * emPx,
    dy: fin(u.dy, 0) * emPx,
    scale,
    scaleX: fin(u.scaleX, 1),
    scaleY: fin(u.scaleY, 1),
    rotate: fin(u.rotation, 0),
    opacity: clamp01(fin(u.opacity, 1)),
    blur: Math.max(0, fin(u.blur, 0) * emPx),
    clip,
    axes,
  }
}

/**
 * THE COMPOSITION. Preset ∘ tracks ∘ blink for glyph `index` at time `t`.
 *
 *   dx, dy, rotate  ADD        (identity 0 — either source alone passes through)
 *   scale           MULTIPLIES (identity 1)
 *   opacity         MULTIPLIES (identity 1), clamped to 0..1
 *   blur, clip, axes, scaleX/scaleY  come from the presets; tracks cannot
 *                   express them (a track carries one number down one config path)
 *
 * Multiplying opacity rather than adding is what makes "fade in *and* pulse"
 * read as a pulse inside a fade instead of saturating at 1 the moment both are
 * partly on. Multiplying scale means a Grow preset scales whatever the track
 * already scaled, rather than one of the two winning.
 *
 * ## Blink is the THIRD source, and it multiplies for a reason
 *
 * `./blink.ts` returns 1 or 0, so multiplying makes it compose exactly as the
 * rule already says opacity composes: a letter blinked out during a fade-in is
 * out, and one that is lit is at whatever the fade had reached. Adding would
 * make a dark letter reappear the moment anything else raised its opacity, and
 * overwriting would make the blink win over an exit and leave the word visible
 * after the clip had faded it away.
 *
 * ## Blink is on the RUN clock, not the glyph's
 *
 * `tr` and `pr` are read at `glyphTime()`; blink is read at `t`. That asymmetry
 * is deliberate and it is what makes `unit: 'word'` mean anything: two glyphs of
 * one word sit at different stagger ranks, so on the glyph clock they would be
 * in different beats and the word would come apart letter by letter. The stagger
 * shifts when a glyph reads its TRACKS; the blink beat is a property of the run.
 *
 * ## The SCATTER is the fourth source, and its axes ADD
 *
 * `./scatter.ts` returns an axis DELTA, the same currency `presetTransform`
 * already emits, so the two are summed per tag and the sum is clamped ONCE, by
 * `vtAxisCoords`, against the font's own range. Addition rather than replacement
 * is what makes "a weight wave AND a scatter" read as a scattered wave instead
 * of one source winning; addition rather than multiplication because an axis
 * coordinate is a position on a scale with an arbitrary origin (`GRAD` runs
 * −200…150 about 0), where a multiplier has no fixed point and inverts as the
 * value crosses zero. Identity is 0, which is exactly what "no scatter" emits,
 * so a config with only a wave is bit-identical to what it was before.
 *
 * Unlike the blink, the scatter is read on the GLYPH'S clock — there is no unit
 * above the glyph here for a run clock to protect, and staggering the settle so
 * the letters find their weight one after another is exactly what the stagger is
 * for.
 *
 * This is the function every renderer should call. `glyphTransform` (tracks only)
 * and `presetTransform` (presets only) remain exported for tests and for callers
 * that genuinely want one source.
 */
export function vtGlyphMotion(
  cfg: VectorTypeConfig,
  t: number,
  index: number,
  count: number,
  em?: number,
  env?: VtGlyphEnv | null,
): VtGlyphMotion {
  const tr = glyphTransform(cfg, t, index, count)
  const pr = presetTransform(cfg, t, index, count, em ?? vtEmSize(cfg, t), env)
  const blink = vtResolveBlink(cfg, t)
  // `vtBlinkActive` is the cheap gate: with blink off (the shipped default) the
  // per-glyph hashing below never runs, so every config written before this
  // feature composes to exactly what it composed to before.
  const lit = vtBlinkActive(blink)
    ? vtBlinkOpacity(blink, t, vtBlinkUnitIndex(blink.unit, index, env?.wordOf))
    : 1
  // Same cheap gate for the scatter, and the same guarantee behind it: `spread`
  // is the only control that can switch it on, and it ships at 0.
  const scatter = vtResolveScatter(cfg, t)
  let axes = pr.axes
  if (vtScatterActive(scatter)) {
    const gt = glyphTime(cfg, t, index, count)
    const resting = env?.resting ?? (cfg?.axes as Record<string, number> | undefined) ?? null
    axes = addAxes(pr.axes, vtScatterDelta(scatter, isNum(gt) ? gt : 0, index, env?.axes, resting))
  }
  return {
    dx: tr.dx + pr.dx,
    dy: tr.dy + pr.dy,
    scale: tr.scale * pr.scale,
    scaleX: pr.scaleX,
    scaleY: pr.scaleY,
    rotate: tr.rotate + pr.rotate,
    opacity: clamp01(tr.opacity * pr.opacity * lit),
    blur: pr.blur,
    clip: pr.clip,
    axes,
  }
}

/**
 * Two axis-delta records summed per tag, dropping any tag that cancels to 0.
 *
 * The zero drop is not tidiness: `vectorTypeFrame` decides whether a frame needs
 * PER-GLYPH SHAPING by asking whether any glyph emitted an axis at all, so a tag
 * carrying 0 would send the whole run down the expensive path — one fontkit
 * instance per distinct coordinate set — to draw a picture identical to the
 * cheap one. `vtAxisDelta` withholds a zero delta for the same reason, and the
 * sum has to keep that property or the two sources together would break what
 * either alone preserves.
 *
 * Returns the left operand UNCHANGED when the right one is empty, so the common
 * case allocates nothing and a preset-only frame is object-identical to what it
 * was before the scatter existed.
 */
function addAxes(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const tags = Object.keys(b)
  if (!tags.length) return a
  const out: Record<string, number> = { ...a }
  for (const tag of tags) {
    const v = fin(out[tag], 0) + fin(b[tag], 0)
    if (v === 0) delete out[tag]
    else out[tag] = v
  }
  return out
}
