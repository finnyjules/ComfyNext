/**
 * Vector Type Studio — VARIABLE-AXIS motion presets. PURE.
 *
 * This is the section of the preset gallery that exists because nothing else
 * animates it. Fade, Slide, Grow and Blur are things After Effects and Jitter
 * have had for a decade; a *weight wave travelling across a word*, or a GRADE
 * pulse that darkens letters without reflowing the line, is a design parameter
 * of the typeface itself. Roboto Flex exposes thirteen such axes. Those axes
 * are the studio's reason to exist, so they get first-class presets rather than
 * a raw slider and an animation curve.
 *
 * ## Why these presets are NOT in `lib/motion/evaluate.ts`
 *
 * The engine's `IN_EVAL`/`OUT_EVAL`/`LOOP_EVAL` tables are font-agnostic — they
 * are shared with the Compositor, which paints Canvas2D text and has no axis
 * control at all. But an axis preset cannot be written font-agnostically:
 *
 *   `wght` runs 100–900 on Inter, 100–1000 on Roboto Flex, 300–1000 on
 *   Recursive; `GRAD` runs −200–150; `YTAS` runs 649–854.
 *
 * A hard-coded "go to 700" is meaningless on two of those and out of range on a
 * third. So every value below is expressed as a fraction of THAT FONT'S OWN
 * declared range, and the preset function is handed the real `VtAxis` at
 * evaluation time. That is the whole reason this table lives in the studio that
 * knows which font is loaded, rather than in the engine that does not.
 *
 * The engine's `PresetCapability` machinery still applies: these presets emit
 * `UnitState.axes`, they declare it (see `vtAxisPresetCapabilities`, derived by
 * probing exactly as `deriveCapabilities` does), and a consumer that cannot
 * render axes must not be offered them. The Compositor never sees this table.
 *
 * ## Declare the frame, derive the contents
 *
 * `docs/superpowers/specs/2026-07-26-shader-as-fill-design.md` settled the shape
 * of this problem for shader fills: the *frame* is frozen and declared, the
 * *contents* are derived from the live vocabulary. Here the frame is
 * `VtAxisPreset.axis` — one frozen OpenType tag per preset, the thing the
 * preset cannot run without — and everything else is derived from the loaded
 * font: whether the tile is offered at all, how far the value travels, and the
 * sentence shown when it cannot run.
 *
 * ## Availability is DISABLED-with-a-reason, not hidden
 *
 * Task 3b hid the blur presets from consumers that cannot render blur, and was
 * right to: blur support is a property of the renderer, so there is no switch
 * the user could flip and a permanently dead tile reads as a bug.
 *
 * Axis availability is the opposite case. "This font has no GRAD axis" names a
 * choice the user owns and can change in the same panel, in one click. Hiding it
 * would mean the studio's headline capability is *invisible* on a two-axis font
 * — the user never learns the axis exists, never learns fonts differ, and the
 * gallery silently shrinks to a conventional kinetic-text picker. So the tile is
 * rendered, greyed, and carries the reason. See `vtAxisAvailability`.
 */
// TYPE-ONLY, and it must stay that way — ./font.ts loads fontkit at module
// scope and this module is reached from every node card (via ./presetMotion.ts).
// Same rule as ./motion.ts and ./controls.ts, for the same reason.
import type { VtAxis } from './font'

/** The three slots a preset can occupy, spelled as `LayerAnimation`'s are. */
export type VtAxisSlot = 'in' | 'out' | 'loop'

/** What the preset is told about the font at evaluation time. */
export interface VtAxisContext {
  /** The loaded font's REAL declared range for this preset's tag. */
  axis: VtAxis
  /** Where this glyph rests on that axis right now — the user's setting (or an
   *  axis track's current value), falling back to the font's own default. A
   *  preset returns absolute axis values, and the caller turns them into deltas
   *  by subtracting this, so "ends still" is expressible as "returns `rest`". */
  rest: number
}

/**
 * One axis preset's curve.
 *
 * `e` is the eased progress 0→1 for `in`/`out`, and the raw loop PHASE 0→1 for
 * `loop` (periodic by construction, exactly like `LOOP_EVAL`). `i`/`n` are the
 * glyph's index in the run — only a preset whose wave has a spatial wavelength
 * uses them.
 *
 * Returns an ABSOLUTE axis value in the font's own units. Out-of-range returns
 * are clamped downstream (`vtAxisCoords`), but a preset that needs clamping is
 * a preset that ignored its `axis`.
 */
export type VtAxisEval = (e: number, i: number, n: number, ctx: VtAxisContext) => number

export interface VtAxisPreset {
  id: string
  slot: VtAxisSlot
  label: string
  /** One line for the tile, in the picker's voice. */
  pitch: string
  /** THE DECLARATION — the OpenType tag this preset cannot run without. The
   *  frozen frame; everything else about the motion is derived from the font. */
  axis: string
  /** Human name for the axis, used in the unavailable sentence when the loaded
   *  font's own `fvar` name is not available to quote. */
  axisName: string
  /** Section header in the gallery. Its own group so the axis presets read as
   *  the distinct thing they are rather than as five more slide-ups. */
  group: 'axis'
  /** Easing for `in`/`out`. Ignored for `loop` (phase is linear, as in the
   *  engine — a loop that eases its phase is not periodic). */
  ease: string
  fn: VtAxisEval
}

const TWO_PI = Math.PI * 2
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The axis's own span. Zero for a degenerate axis (guarded by availability). */
const span = (a: VtAxis): number => Math.max(0, a.max - a.min)

/**
 * A safe oscillation about `rest`: amplitude `frac` of the axis's OWN range,
 * with the centre pulled inside the range so the swing never clips.
 *
 * Centring on `rest` alone breaks at the ends — a user sitting at `wght: 900`
 * has no headroom above, and a "swing by the symmetric headroom" rule would
 * give them an amplitude of exactly zero, i.e. a wave preset that visibly does
 * nothing. Pulling the centre in instead keeps the motion visible wherever the
 * user parked the slider, at the cost of a small offset from rest — which is
 * the right trade for a LOOP (it has no resting frame to honour).
 */
function centred(ctx: VtAxisContext, frac: number): { c: number; a: number } {
  const s = span(ctx.axis)
  const a = s * frac
  const c = Math.min(ctx.axis.max - a, Math.max(ctx.axis.min + a, ctx.rest))
  return { c, a }
}

/**
 * Room for a ONE-SIDED move, signed.
 *
 * Prefers the POSITIVE direction, because on the axes this is used for that is
 * the direction with the meaning: `GRAD` up is darker, `wght` up is heavier.
 * (Roboto Flex's GRAD runs −200…150 about a default of 0, so "whichever side
 * has more room" would beat the word *lighter* — the opposite of a pulse.) It
 * flips only when there is genuinely no room above, so a user parked at the top
 * of the axis still sees the preset move.
 */
function headroom(ctx: VtAxisContext, frac: number): number {
  const up = ctx.axis.max - ctx.rest
  const down = ctx.rest - ctx.axis.min
  return (up >= span(ctx.axis) * 0.25 ? up : -down) * frac
}

// ── The five ────────────────────────────────────────────────────────────────

const PRESETS: VtAxisPreset[] = [
  {
    id: 'weight-in',
    slot: 'in',
    label: 'Weight In',
    pitch: 'Sets hairline-light and gains its weight',
    axis: 'wght',
    axisName: 'Weight',
    group: 'axis',
    // Decelerating, like every other entrance in the catalog: the weight
    // arrives quickly and settles, rather than creeping in linearly.
    ease: 'power2.out',
    // An ENTRANCE, so it must END STILL: at e = 1 this returns `rest` exactly,
    // the delta is 0, and the word is left at whatever weight the user set. It
    // STARTS at the font's own lightest cut — the axis minimum, not a guess at
    // one — which is why a 100-min font and a 300-min font both look right.
    fn: (e, _i, _n, ctx) => ctx.rest + (ctx.axis.min - ctx.rest) * (1 - e),
  },
  {
    id: 'weight-wave',
    slot: 'loop',
    label: 'Weight Wave',
    pitch: 'A crest of weight travels through the word',
    axis: 'wght',
    axisName: 'Weight',
    group: 'axis',
    ease: 'none',
    // THE ONE. Each glyph sits one wavelength-fraction further along the same
    // sine, so at any instant the word carries a moving crest of weight — the
    // letters under it are black, the ones ahead of it are light, and the crest
    // walks. Nothing in the market does this, because it needs real outlines at
    // interpolated axis positions, per glyph, per frame.
    //
    // The i/n term is the wave's WAVELENGTH (one cycle across the run), not a
    // second stagger clock: it is spatial, evaluated at the glyph's own time
    // like everything else. `motion.stagger` still shifts that clock on top and
    // the two compose into a faster or slower-travelling crest — which is why
    // the wave travels out of the box, at delay 0, instead of waiting for the
    // user to find the stagger slider.
    fn: (phase, i, n, ctx) => {
      const { c, a } = centred(ctx, 0.35)
      const glyphs = Math.max(1, n)
      return c + a * Math.sin(TWO_PI * (phase - i / glyphs))
    },
  },
  {
    id: 'width-breathe',
    slot: 'loop',
    label: 'Width Breathe',
    pitch: 'The word widens and narrows as one',
    axis: 'wdth',
    axisName: 'Width',
    group: 'axis',
    ease: 'none',
    // Deliberately NOT a wave: breathing is the whole run moving together, and
    // a per-glyph width wave reads as broken typesetting rather than as motion.
    // Small amplitude for the same reason — width is the axis the eye reads as
    // "wrong" fastest.
    fn: (phase, _i, _n, ctx) => {
      const { c, a } = centred(ctx, 0.18)
      return c + a * Math.sin(TWO_PI * phase)
    },
  },
  {
    id: 'grade-pulse',
    slot: 'loop',
    label: 'Grade Pulse',
    pitch: 'Letters darken in place — no reflow',
    axis: 'GRAD',
    axisName: 'Grade',
    group: 'axis',
    ease: 'none',
    // GRAD is weight WITHOUT width: the stems thicken and the advances do not
    // move, so the line does not re-wrap and the letters do not shuffle. That
    // is the entire reason the axis exists, and it is why this preset is not a
    // duplicate of Weight Wave with another tag.
    //
    // The curve says so too. Weight Wave is a full sine that crosses the
    // resting weight in both directions and travels along the word; this is a
    // ONE-SIDED heartbeat — flat at rest for half the cycle, then a single
    // push, the whole word at once. Weight breathes; grade beats.
    fn: (phase, _i, _n, ctx) => {
      const beat = Math.max(0, Math.sin(TWO_PI * phase))
      return ctx.rest + headroom(ctx, 0.6) * beat * beat
    },
  },
  {
    id: 'optical-drift',
    slot: 'loop',
    label: 'Optical Drift',
    pitch: 'Drifts between the font\'s display and text cuts',
    axis: 'opsz',
    axisName: 'Optical size',
    group: 'axis',
    ease: 'none',
    // opsz is the axis a foundry cut by hand: at the display end the letters
    // are tight and high-contrast, at the text end open and sturdy. Nobody
    // animates it, because in every other tool opsz is picked once by the
    // browser from the font size. Wide and slow — 45% of the axis, the whole
    // word together — so the change reads as the typeface re-cutting itself
    // rather than as a wobble.
    fn: (phase, _i, _n, ctx) => {
      const { c, a } = centred(ctx, 0.45)
      return c + a * Math.sin(TWO_PI * phase)
    },
  },
]

/** Every axis preset, in gallery order. */
export const VT_AXIS_PRESETS: readonly VtAxisPreset[] = Object.freeze(PRESETS)

/**
 * THE TABLE — `slot → id → preset`. The Vector-Type-only twin of the engine's
 * `IN_EVAL`/`OUT_EVAL`/`LOOP_EVAL`, derived from the one list above so there is
 * no second registry to keep in step.
 */
export const VT_EVAL: Readonly<Record<VtAxisSlot, Readonly<Record<string, VtAxisPreset>>>> = Object.freeze(
  (['in', 'out', 'loop'] as const).reduce((acc, slot) => {
    acc[slot] = Object.freeze(Object.fromEntries(
      PRESETS.filter(p => p.slot === slot).map(p => [p.id, p]),
    ))
    return acc
  }, {} as Record<VtAxisSlot, Record<string, VtAxisPreset>>),
)

/** The preset in `slot` with that id, or null. Font-independent: KNOWING a
 *  preset and being able to RUN it on the loaded font are different questions
 *  (`vtAxisAvailability` answers the second). */
export function vtAxisPreset(slot: VtAxisSlot, presetId: unknown): VtAxisPreset | null {
  if (typeof presetId !== 'string') return null
  return VT_EVAL[slot]?.[presetId.trim()] ?? null
}

/** True when `id` is one of these, in any slot. */
export function isVtAxisPresetId(presetId: unknown): boolean {
  return (['in', 'out', 'loop'] as const).some(s => vtAxisPreset(s, presetId) !== null)
}

// ── Availability, derived from the loaded font ──────────────────────────────

/** An OpenType axis tag is exactly four printable-ASCII characters. Restated
 *  from `./font.ts` rather than imported: that module loads fontkit at module
 *  scope, and this one is deliberately type-only against it. */
const AXIS_TAG = /^[\x20-\x7E]{4}$/

/**
 * Whether a font can run something that needs ONE named axis, and if not, why.
 *
 * Preset-free on purpose. The axis presets name their tag in a frozen table, but
 * the per-glyph axis SCATTER (`./scatter.ts`) lets the user pick the tag, and
 * both must fail the same way and say the same sentence — otherwise the studio
 * has two vocabularies for "this font cannot do that". One generator, two
 * callers; `VtAxisOffer` below is this plus the preset that asked.
 */
export interface VtAxisTagOffer {
  /** The font's own axis, when it has one — so a picker can show the real range. */
  axis: VtAxis | null
  available: boolean
  /** Present IFF unavailable. A sentence naming the missing axis, because the
   *  user can act on it: pick another font. Never a bare "unsupported". */
  reason?: string
}

export interface VtAxisOffer extends VtAxisTagOffer {
  preset: VtAxisPreset
}

/**
 * The two ways one axis can be unavailable, both of them the font's doing and
 * both worth saying out loud:
 *  - the font has no such axis (Inter has 2, Roboto Flex has 13);
 *  - the font declares the axis with `min === max`, which is a static value
 *    wearing an axis's clothes — it would animate to exactly nothing.
 *
 * `axisName` is the human name to quote beside the tag, when the caller has one.
 * The presets carry one in their table; a user-chosen tag has only the tag, and
 * the sentence simply names it once rather than repeating it in brackets.
 */
export function vtAxisTagAvailability(
  tag: string,
  axisName: string | undefined,
  axes: readonly VtAxis[] | null | undefined,
  fontLabel?: string,
): VtAxisTagOffer {
  const list = Array.isArray(axes) ? axes : []
  const axis = list.find(a => a?.tag === tag) ?? null
  const who = fontLabel && fontLabel.trim() ? fontLabel.trim() : 'This font'
  const named = axisName && axisName !== tag ? `${tag} (${axisName})` : tag
  if (!axis) {
    return {
      axis: null,
      available: false,
      reason: `${who} has no ${named} axis — pick a font that does.`,
    }
  }
  if (span(axis) <= 0) {
    return {
      axis,
      available: false,
      reason: `${who}'s ${named} axis has no range — it is fixed at ${axis.min}.`,
    }
  }
  return { axis, available: true }
}

/**
 * Can this preset run on a font with these axes, and if not, WHY.
 *
 * The whole judgement is `vtAxisTagAvailability`'s — this only attaches the
 * preset that asked, so a gallery tile can show its own label beside the reason.
 */
export function vtAxisAvailability(
  preset: VtAxisPreset,
  axes: readonly VtAxis[] | null | undefined,
  fontLabel?: string,
): VtAxisOffer {
  return { preset, ...vtAxisTagAvailability(preset.axis, preset.axisName, axes, fontLabel) }
}

/**
 * Every axis preset for a slot, each marked available or not.
 *
 * Returns ALL of them, unavailable ones included — the caller greys those out
 * and shows `reason` (see the header). A caller that wants only the runnable
 * ids uses `vtAxisPresetIdsFor`.
 */
export function vtAxisOffersFor(
  slot: VtAxisSlot,
  axes: readonly VtAxis[] | null | undefined,
  fontLabel?: string,
): VtAxisOffer[] {
  return PRESETS.filter(p => p.slot === slot).map(p => vtAxisAvailability(p, axes, fontLabel))
}

/** The ids in `slot` this font can actually run. */
export function vtAxisPresetIdsFor(slot: VtAxisSlot, axes: readonly VtAxis[] | null | undefined): string[] {
  return vtAxisOffersFor(slot, axes).filter(o => o.available).map(o => o.preset.id)
}

// ── Evaluation ──────────────────────────────────────────────────────────────

/**
 * What this preset adds to glyph `i` at progress/phase `e`, as an axis DELTA
 * keyed by tag — the shape `UnitState.axes` and `VtGlyphMotion.axes` carry.
 *
 * Empty when the font lacks the axis or the axis is degenerate. Empty, not
 * "0" and not a throw: an axis a font does not have is a no-op by definition,
 * and the picker has already told the user why (that is the contract that keeps
 * a stored preset from breaking when the font is changed underneath it).
 */
export function vtAxisDelta(
  preset: VtAxisPreset,
  e: number,
  i: number,
  n: number,
  axes: readonly VtAxis[] | null | undefined,
  restingAxes?: Record<string, number> | null,
): Record<string, number> {
  const offer = vtAxisAvailability(preset, axes)
  if (!offer.available || !offer.axis) return {}
  const axis = offer.axis
  const raw = restingAxes?.[axis.tag]
  const rest = isNum(raw) ? Math.min(axis.max, Math.max(axis.min, raw)) : axis.default
  const progress = isNum(e) ? e : 0
  const value = preset.fn(progress, Math.max(0, Math.floor(i)), Math.max(1, Math.floor(n)), { axis, rest })
  if (!isNum(value)) return {}
  const delta = Math.min(axis.max, Math.max(axis.min, value)) - rest
  // A zero delta is not emitted, for the same reason `blur: 0` is not a
  // capability: it is indistinguishable from no axis motion at all, and
  // emitting it would send the renderer down the per-glyph shaping path for a
  // frame that is identical to the cheap one.
  return delta === 0 ? {} : { [axis.tag]: delta }
}

/**
 * Resolve a full coords record: every axis of the font at its resting value,
 * plus the preset's deltas, clamped to each axis's own range.
 *
 * Equal to `resolveCoords(font, resting)` when `deltas` is empty — deliberately,
 * so the axis-preset path and the plain path agree exactly and the shaping cache
 * key stays a faithful description of the coords actually used.
 */
export function vtAxisCoords(
  axes: readonly VtAxis[] | null | undefined,
  resting: Record<string, number> | null | undefined,
  deltas: Record<string, number> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of Array.isArray(axes) ? axes : []) {
    if (!a || !AXIS_TAG.test(a.tag)) continue
    const r = resting?.[a.tag]
    const d = deltas?.[a.tag]
    const base = isNum(r) ? r : a.default
    out[a.tag] = Math.min(a.max, Math.max(a.min, base + (isNum(d) ? d : 0)))
  }
  return out
}

// ── Capability derivation, the Task-3b way ──────────────────────────────────

/**
 * What a consumer must implement to render this preset — DERIVED by probing the
 * function, never hand-written, exactly as `deriveCapabilities` does for the
 * engine's tables (`lib/motion/evaluate.ts`).
 *
 * These presets cannot be probed font-agnostically (that is the whole point of
 * this module), so the probe runs against a synthetic axis with a real range.
 * A preset that never moves off `rest` across its entire domain requires
 * nothing — and is also a preset that does nothing, which is what the
 * non-vacuity assertion in the spec is for.
 */
export function vtAxisPresetCapabilities(preset: VtAxisPreset): readonly 'axes'[] {
  const probe: VtAxis[] = [{ tag: preset.axis, name: preset.axisName, min: 0, default: 50, max: 100 }]
  const STEPS = 40
  for (const n of [1, 3]) {
    for (let i = 0; i < n; i++) {
      for (let k = 0; k <= STEPS; k++) {
        if (Object.keys(vtAxisDelta(preset, k / STEPS, i, n, probe)).length > 0) return ['axes']
      }
    }
  }
  return []
}
