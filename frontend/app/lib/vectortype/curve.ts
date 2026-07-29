/**
 * Vector Type — ARC-LENGTH CURVE SAMPLING. PURE.
 *
 * Plain numbers in, plain numbers out: a curve description and a distance along
 * it, back a `{x, y, angle}`. No canvas, no DOM, no `fetch`, and — the load-bearing
 * one — **no paper.js**.
 *
 * ## Why not paper, when paper has exactly this API
 *
 * `paper.Path` exposes `getPointAt` / `getTangentAt` / `getNormalAt`, and all three
 * already take ARC-LENGTH offsets. It would be a one-liner. It is still the wrong
 * call here, for one reason: **arc placement runs every frame.** paper is reserved
 * for the boolean union (`extrudeSolid.ts`), which runs on bake and export only,
 * and `canvas.ts` is proved three independent ways not to reach it — an
 * import-graph test, a sync-vs-async check, and the renderer's input type. That
 * guarantee is brittle enough that a bare `import 'paper'` in an unrelated cache
 * module turns the import-graph test red. This module is on the draw loop's side
 * of that line and must stay there.
 *
 * What paper would buy is, for the parametric curves this needs, a cumulative-chord
 * table plus a binary-search inversion. That is the whole file.
 *
 * ## The property this module exists to provide
 *
 *   **Equal arc length gives equal spacing.**
 *
 * That is NOT what you get by walking the curve parameter `t` uniformly. Only a
 * constant-speed curve — a circular arc, essentially — has `|dP/dt|` constant, and
 * for everything else uniform `t` bunches glyphs where the curve is slow and
 * stretches them where it is fast.
 *
 * Two places in this codebase have already met that failure:
 *
 *  - `lib/spacetype/tickerGeometry.ts` exists BECAUSE of it. Its header: *"Ribbon
 *    … maps u uniformly in the curve parameter t, so glyphs stretch through bends
 *    and bunch on straights. Ticker fixes both … equal arc length gets equal u."*
 *    It builds the forward half (a `Float64Array cum`); the inversion is what is
 *    new here.
 *  - `utils/textOnPath.ts` gets it **wrong**, and instructively so. Its
 *    `estimatePathLength` walks 200 uniform `t` steps to total the length, then
 *    maps accumulated advance ÷ length straight back to `t`. On a circle that
 *    happens to be right. On a `wave` it is visibly wrong, and the spec beside
 *    this module measures exactly how wrong.
 *
 * Treat `textOnPath.ts` as the spec for the PLACEMENT loop (accumulate half an
 * advance, place the centre, rotate to the tangent) and not as a library.
 *
 * ## Coordinates and conventions
 *
 * Caller's space, unscaled. Angles are **radians** in the standard maths sense
 * (`0` = +x, increasing towards +y) — which in a y-down output space reads as
 * clockwise, the same convention `textOnPath.ts` uses, so absorbing that widget
 * later is a rename and not a re-derivation. Curve parameters that a user types
 * (`startAngle`, `phase`) are **degrees**, again matching the widget.
 *
 * ## Cost
 *
 * `buildCurveTable` is O(samples) and allocates one `Float64Array`; `pointAtLength`
 * on a prebuilt table is O(log samples) and allocates nothing but its result. A run
 * therefore costs one table plus one binary search per glyph. Callers placing more
 * than a glyph or two should build the table once and hand it in — the convenience
 * overload that accepts a bare curve rebuilds the table on every call.
 */

const TAU = Math.PI * 2
const DEG = Math.PI / 180

// ── The curve vocabulary ────────────────────────────────────────────────────

/**
 * Matches `utils/textOnPath.ts`'s `PathType` union deliberately: absorbing that
 * widget into this studio is the stated intent, so the words should already agree.
 *
 * v1 of the arc feature only surfaces `arc` in the UI. The other three are here
 * because they cost about five lines each on top of machinery they share entirely,
 * and because **`wave` is the curve that proves the inversion does any work at all**
 * — a naive-vs-correct comparison against a curve that only exists in a test file
 * would prove nothing about shipped code.
 */
export type VtCurveType = 'arc' | 'circle' | 'wave' | 'line'

/** A circular arc from `startAngle` to `endAngle`, centred on the origin. The one
 *  constant-speed member of the family, and so the one where naive `t`-uniform
 *  sampling happens to be correct. */
export interface VtArcCurve {
  type: 'arc'
  /** Caller units. May be negative — that traverses the mirrored circle; length
   *  uses the magnitude. `0` is a legal, zero-length curve. */
  radius: number
  /** Degrees. */
  startAngle: number
  /** Degrees. `endAngle < startAngle` runs the arc BACKWARDS, and the tangent
   *  follows the direction of travel rather than a fixed handedness. */
  endAngle: number
}

/** A full turn, starting at the top and going clockwise in a y-down space —
 *  identical framing to the widget's `circle`. */
export interface VtCircleCurve {
  type: 'circle'
  radius: number
}

/**
 * `y = amplitude · sin(2π·frequency·t + phase)` over `x ∈ [0, length]`.
 *
 * `length` is the STRAIGHT span, and it is the one deliberate deviation from the
 * widget's `PathType`: there, `evalPath(path, t, totalLength)` takes the span as a
 * third argument computed from the text width, which is what forces that file into
 * its chicken-and-egg "estimate the length to place the text to know the length"
 * dance. Carrying the span on the curve makes `curveLength(curve)` a function of the
 * curve alone, which is what the whole table depends on.
 */
export interface VtWaveCurve {
  type: 'wave'
  /** Straight span along x. The ARC length is longer, and by how much is the point. */
  length: number
  amplitude: number
  /** Full waves across `length`. */
  frequency: number
  /** Degrees. */
  phase: number
}

/**
 * A span bowed by `curvature`: `0` is straight, `±1` closes into a full circle.
 * Positive bows one way, negative the other.
 *
 * Note that `length` is the **arc** length here and not the straight span — the
 * closed form's radius is `length / sweep`, so `curveLength` comes back as
 * `length` for every curvature. Bowing a line therefore keeps the run the same
 * size and only bends it, which is the behaviour a "curvature" slider implies.
 */
export interface VtLineCurve {
  type: 'line'
  length: number
  /** −1…1 in the widget's UI, but nothing here clamps it. */
  curvature: number
}

export type VtCurve = VtArcCurve | VtCircleCurve | VtWaveCurve | VtLineCurve

/** A point on a curve plus the **tangent** direction there, in radians. */
export interface VtCurvePoint {
  x: number
  y: number
  /** Tangent, radians, pointing in the direction of TRAVEL (increasing `s`). */
  angle: number
}

// ── Sanitising ──────────────────────────────────────────────────────────────

const fin = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * The tangent angle from a derivative vector, with an explicit fallback for the
 * degenerate case.
 *
 * A zero derivative is not exotic here: a zero-radius arc, a zero-sweep arc and a
 * zero-length wave all produce one. Returning `atan2(0, 0)` = 0 silently would put
 * every glyph of a degenerate curve at 0°, which is defensible, but a caller that
 * has a better idea (an arc knows its radial direction even when its radius is 0)
 * should be able to say so.
 */
const tangentOf = (dx: number, dy: number, fallback: number): number =>
  dx === 0 && dy === 0 ? fallback : Math.atan2(dy, dx)

// ── Forward evaluation: the parametric curve at `t` ─────────────────────────

/**
 * The curve at parameter `t ∈ [0, 1]`, with its **analytic** tangent.
 *
 * Exported because it is the honest naive baseline — feeding it `s / length`
 * instead of an inverted `t` is precisely the `textOnPath.ts` bug, and the spec
 * uses it that way on purpose, as a control.
 *
 * `t` is clamped, so evaluating past either end returns the endpoint rather than
 * extrapolating off the curve.
 */
export function evalCurve(curve: VtCurve | null | undefined, t: number): VtCurvePoint {
  const u = clamp01(fin(t, 0))
  switch (curve?.type) {
    case 'circle':
      // A full turn from the top. Expressed through the same arc body so the two
      // cannot drift: one of them being off by a quarter turn is exactly the kind
      // of bug a parallel implementation invites.
      return arcPoint(fin(curve.radius, 0), -Math.PI / 2, TAU, u)

    case 'wave': {
      const L = Math.max(0, fin(curve.length, 0))
      const amp = fin(curve.amplitude, 0)
      const omega = TAU * fin(curve.frequency, 0)
      const ph = fin(curve.phase, 0) * DEG
      const arg = omega * u + ph
      return {
        x: u * L,
        y: amp * Math.sin(arg),
        // dP/du = (L, amp·ω·cos(arg)).
        angle: tangentOf(L, amp * omega * Math.cos(arg), 0),
      }
    }

    case 'line': {
      const L = Math.max(0, fin(curve.length, 0))
      const c = fin(curve.curvature, 0)
      // HALF the swept angle, so `curvature = ±1` sweeps a full turn.
      const m = Math.PI * Math.abs(c)
      if (m < 1e-9) return { x: u * L, y: 0, angle: 0 }
      const sign = c > 0 ? -1 : 1
      const a = m * (2 * u - 1)
      // y is written through the half-angle identity
      //   cos a − cos a₀ = −2·sin((a+a₀)/2)·sin((a−a₀)/2)
      // rather than as the literal difference of two cosines. The literal form
      // (which is what the widget uses) multiplies a radius of L/2m — enormous at
      // small curvature — by a difference of two nearly-equal cosines, and loses
      // most of its significant figures doing it. This form is well conditioned
      // all the way down to the straight case, so the dead zone above can be 1e-9
      // instead of the widget's 0.01, and the family stays geometrically continuous
      // as `curvature` is animated through zero.
      return {
        x: L / 2 + (L / (2 * m)) * Math.sin(a),
        y: -sign * (L / m) * Math.sin(m * (u - 1)) * Math.sin(m * u),
        // dP/du = L·(cos a, −sign·sin a).
        angle: tangentOf(L * Math.cos(a), -sign * L * Math.sin(a), 0),
      }
    }

    case 'arc': {
      const a0 = fin(curve.startAngle, 0) * DEG
      const a1 = fin(curve.endAngle, 0) * DEG
      return arcPoint(fin(curve.radius, 0), a0, a1 - a0, u)
    }

    default:
      // An unknown or absent curve is a single point at the origin, not a throw:
      // this sits under a live studio config, and a config that has not migrated
      // yet should draw a straight run, not a red screen.
      return { x: 0, y: 0, angle: 0 }
  }
}

function arcPoint(radius: number, a0: number, sweep: number, u: number): VtCurvePoint {
  const a = a0 + sweep * u
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  // dP/du = radius·sweep·(−sin a, cos a). The tangent therefore flips with the
  // sign of the sweep, which is what makes a reversed arc's letters face the way
  // they are travelling. (`textOnPath.ts` hard-codes `a + π/2` and so gets a
  // backwards run for `endAngle < startAngle`.)
  const k = radius * sweep
  return {
    x: radius * cos,
    y: radius * sin,
    // Fallback for radius 0 or sweep 0: perpendicular to the radius, in the
    // sweep's direction — the limit of the real tangent rather than a flat 0.
    angle: tangentOf(-sin * k, cos * k, a + (Math.PI / 2) * (sweep < 0 ? -1 : 1)),
  }
}

// ── The cumulative-chord table ──────────────────────────────────────────────

/** Samples per full turn for `arc` / `circle` / `line`. A chord subtending `h`
 *  radians under-measures its arc by ~`h²/24` of itself; at 512 per turn that is
 *  6.3e-6, i.e. 0.04px lost around a 1000px-radius circle. */
export const VT_CURVE_SAMPLES_PER_TURN = 512

/** Samples per full wave period. */
export const VT_CURVE_SAMPLES_PER_WAVE = 256

/** Floor — a nearly-straight curve still gets enough samples to invert smoothly. */
export const VT_CURVE_SAMPLES_MIN = 32

/** Ceiling. A 40-turn spiral or a 200-cycle wave is a pathological config, not a
 *  reason to allocate megabytes on a frame. Past this the table degrades in
 *  accuracy rather than in frame time, which is the right way round. */
export const VT_CURVE_SAMPLES_MAX = 4096

/**
 * A curve's cumulative chord length at `samples + 1` uniformly-spaced `t` values.
 *
 * `cum[i]` is the length from `t = 0` to `t = i / samples`, so `cum[0]` is 0 and
 * `cum[samples]` is the total. Monotone non-decreasing by construction, which is
 * what the binary search relies on.
 */
export interface VtCurveTable {
  readonly curve: VtCurve
  readonly samples: number
  readonly cum: Float64Array
  /** `cum[samples]`. Never negative; may be exactly 0. */
  readonly length: number
}

/**
 * How many samples a curve needs, from how much it turns or waves.
 *
 * Resolution has to scale with the curve rather than being a flat constant: a 10°
 * arc and a 40-turn spiral want wildly different tables, and a flat number is
 * either wasteful for the first or wrong for the second.
 */
export function autoSamples(curve: VtCurve | null | undefined): number {
  switch (curve?.type) {
    case 'circle':
      return clampSamples(VT_CURVE_SAMPLES_PER_TURN)
    case 'wave':
      return clampSamples(Math.abs(fin(curve.frequency, 0)) * VT_CURVE_SAMPLES_PER_WAVE)
    case 'line':
      // `curvature = ±1` sweeps a full turn.
      return clampSamples(Math.abs(fin(curve.curvature, 0)) * VT_CURVE_SAMPLES_PER_TURN)
    case 'arc': {
      const turns = Math.abs(fin(curve.endAngle, 0) - fin(curve.startAngle, 0)) / 360
      return clampSamples(turns * VT_CURVE_SAMPLES_PER_TURN)
    }
    default:
      return VT_CURVE_SAMPLES_MIN
  }
}

function clampSamples(n: number): number {
  if (!Number.isFinite(n)) return VT_CURVE_SAMPLES_MIN
  const c = Math.ceil(n)
  return c < VT_CURVE_SAMPLES_MIN ? VT_CURVE_SAMPLES_MIN : c > VT_CURVE_SAMPLES_MAX ? VT_CURVE_SAMPLES_MAX : c
}

/** Build the table once, then hand it to `pointAtLength` for every glyph. */
export function buildCurveTable(curve: VtCurve, samples: number = autoSamples(curve)): VtCurveTable {
  const n = clampSamples(samples)
  const cum = new Float64Array(n + 1)
  let prev = evalCurve(curve, 0)
  for (let i = 1; i <= n; i++) {
    const p = evalCurve(curve, i / n)
    // `Math.max(…, cum[i-1])` is not needed — a hypot is never negative — but the
    // monotonicity it guarantees IS what the binary search assumes, so the array
    // is built the only way that cannot violate it.
    cum[i] = cum[i - 1]! + Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  return { curve, samples: n, cum, length: cum[n]! }
}

const isTable = (v: VtCurve | VtCurveTable): v is VtCurveTable =>
  (v as VtCurveTable).cum instanceof Float64Array

/**
 * Total arc length of a curve, in caller units.
 *
 * Builds a table and throws it away, so a placement loop should call
 * `buildCurveTable` once and read `.length` off it instead.
 */
export function curveLength(curve: VtCurve): number {
  return buildCurveTable(curve).length
}

/**
 * **The inversion.** The curve parameter `t` at arc length `s` — binary search over
 * the cumulative table, then a linear interpolation inside the bracketing segment.
 *
 * Linear is the right order here: within one segment the curve is a chord to within
 * the `h²/24` above, and the residual is smaller than the table's own quantisation.
 * `s` outside `[0, length]` clamps to an end.
 */
export function tAtLength(table: VtCurveTable, s: number): number {
  const { cum, samples, length } = table
  const sc = fin(s, 0)
  if (!(length > 0)) return 0
  if (sc <= 0) return 0
  if (sc >= length) return 1

  let lo = 0
  let hi = samples
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid]! <= sc) lo = mid
    else hi = mid
  }
  const c0 = cum[lo]!
  const span = cum[hi]! - c0
  // A zero-width segment means the curve stalled here (a cusp, or a zero radius).
  // Landing on the segment's start is the only defined answer.
  const frac = span > 0 ? (sc - c0) / span : 0
  return (lo + frac) / samples
}

/**
 * The point and tangent at arc length `s` along a curve.
 *
 * This is the whole public promise: **advance `s` by a fixed amount and the point
 * moves a fixed distance along the curve**, regardless of how fast the curve's
 * parameterisation happens to be running there. Placing glyph centres at
 * accumulated half-advances therefore spaces them evenly on a wave, a bend and a
 * straight alike.
 *
 * Pass a `VtCurveTable` in a loop; passing a bare `VtCurve` is a convenience that
 * rebuilds the table each call.
 *
 * `s ≤ 0` gives the start, `s ≥ length` gives the end, and a zero-length curve
 * gives its single point for every `s` — no NaN reaches a transform matrix from
 * here.
 */
export function pointAtLength(target: VtCurve | VtCurveTable, s: number): VtCurvePoint {
  const table = isTable(target) ? target : buildCurveTable(target)
  return evalCurve(table.curve, tAtLength(table, s))
}
