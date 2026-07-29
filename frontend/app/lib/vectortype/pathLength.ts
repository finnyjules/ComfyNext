/**
 * Vector Type — PER-PATH ARC LENGTH. PURE.
 *
 * Command lists in, plain numbers out: how long a placed path is, and where a
 * given distance along it lands. No canvas, no DOM, no `fetch`, and — the
 * load-bearing one — **no paper.js**.
 *
 * ## Why not paper, when `paper.Path.length` is exactly this
 *
 * Because **a draw-on runs every frame.** `paper` is reserved for the boolean
 * union (`extrudeSolid.ts`), which runs on bake and export only, and the
 * renderer is proved three independent ways not to reach it — an import-graph
 * test from `extrudeBodyCache.ts`, a second from `canvas.ts`, and a static
 * no-imports check on `curve.ts`. That guarantee is brittle enough that a bare
 * `import 'paper'` in an unrelated cache module turns one of them red. This
 * module is on the draw loop's side of that line and must stay there.
 *
 * What paper would buy is, for the two curve kinds a glyph outline contains, a
 * cumulative-chord table plus a binary-search inversion. That is the whole file
 * — the same shape as `./curve.ts`, which already proved it here.
 *
 * ## BOTH curve kinds, and quadratics are the common one
 *
 * fontkit emits mostly `quadraticCurveTo` for TrueType outlines (a TrueType
 * glyph is quadratic by format) and `bezierCurveTo` for CFF/OpenType ones. A
 * length routine that only handled cubics would under-measure almost every
 * glyph of almost every font in the catalog and the symptom — a draw-on that
 * finishes early — would look like an easing bug rather than a missing branch.
 *
 * ## SUBPATHS are the unit, not the path
 *
 * A letter is several closed contours: `o` has two, `i` has two, `S` has one.
 * Both dashing implementations — canvas's `setLineDash` and SVG's
 * `stroke-dasharray` — **restart the dash pattern at every subpath**, which is
 * not a detail this module may hide: it decides what "the letter is half drawn"
 * means. So the lengths come back per subpath, and `longest` is what a draw-on
 * measures its progress against. See `vtDrawOnDash` for why.
 *
 * ## Units
 *
 * Whatever the commands are in. The renderers hand PLACED commands (output
 * pixels), which is also the space `setLineDash` and `stroke-dasharray` measure
 * in — both are in the current transform's / the element's own user units, the
 * same rule `lineWidth` already follows in this studio.
 *
 * ## Cost
 *
 * `pathLength` allocates one small array of subpath lengths and nothing else;
 * `buildPathTable` retains its samples so the inversion needs no re-evaluation
 * and is correspondingly heavier. The draw loop calls the first.
 */

const TAU = Math.PI * 2

/**
 * Samples per FULL TURN of a curve segment's control polygon — the same
 * constant, for the same reason, as `./curve.ts`'s `VT_CURVE_SAMPLES_PER_TURN`.
 *
 * A chord subtending `h` radians under-measures its arc by ~`h²/24` of itself.
 * At 512 per turn a segment that turns 90° gets 128 samples, `h = 0.0123` rad,
 * and the relative shortfall is 6.3e-6 — 0.004 of a pixel around a 628-pixel
 * circle. Resolution scales with how much the segment TURNS rather than with a
 * flat count, because a nearly-straight curve and a half-circle want wildly
 * different tables and a flat number is either wasteful for the first or wrong
 * for the second.
 */
export const VT_PATH_SAMPLES_PER_TURN = 512

/** Floor, so a gently-bent segment still inverts smoothly. */
export const VT_PATH_SAMPLES_MIN = 8

/** Ceiling. One segment cannot spend more than this however pathological its
 *  control polygon; past it the measurement degrades in accuracy rather than in
 *  frame time, which is the right way round. */
export const VT_PATH_SAMPLES_MAX = 512

/**
 * Relative flatness below which a curve IS its chord, measured as
 * `(controlPolygon − chord) / chord`.
 *
 * Not an optimisation for its own sake: a font's outline is full of "curves"
 * whose control points are collinear (a straight stem drawn with the curve
 * operator), and for those the chord is not an approximation — it is the exact
 * answer. Sampling them would spend 8 hypots to arrive at the same number with
 * floating-point noise on it.
 */
const FLAT_EPS = 1e-9

const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Minimal structural command, so this module does not import the spine's
 *  runtime — `{ command, args }` is the whole contract and it is stable. */
interface Cmd {
  command: string
  args: number[]
}

/**
 * How many samples one curve segment needs, from how far its control polygon
 * TURNS. `edges` is the polygon as flat `x,y` pairs (3 points for a quadratic,
 * 4 for a cubic).
 */
function samplesForTurn(pts: readonly number[], len: number): number {
  let turn = 0
  for (let i = 2; i + 3 < len; i += 2) {
    const ax = (pts[i] as number) - (pts[i - 2] as number)
    const ay = (pts[i + 1] as number) - (pts[i - 1] as number)
    const bx = (pts[i + 2] as number) - (pts[i] as number)
    const by = (pts[i + 3] as number) - (pts[i + 1] as number)
    // `atan2` of the cross and dot products, which is the signed angle between
    // the two edges and — unlike `acos` of the normalised dot — is well
    // conditioned all the way down to a zero angle.
    const a = Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
    if (Number.isFinite(a)) turn += Math.abs(a)
  }
  const n = Math.ceil((VT_PATH_SAMPLES_PER_TURN * turn) / TAU)
  if (!Number.isFinite(n) || n < VT_PATH_SAMPLES_MIN) return VT_PATH_SAMPLES_MIN
  return n > VT_PATH_SAMPLES_MAX ? VT_PATH_SAMPLES_MAX : n
}

/** Control-polygon length (an upper bound on the arc) and the chord (a lower
 *  bound). Their agreement is the flatness test above. */
function polygonLength(pts: readonly number[], len: number): number {
  let poly = 0
  for (let i = 2; i < len; i += 2) {
    poly += Math.hypot((pts[i] as number) - (pts[i - 2] as number), (pts[i + 1] as number) - (pts[i - 1] as number))
  }
  return poly
}

function quadAt(p: readonly number[], t: number, out: { x: number; y: number }): void {
  const mt = 1 - t
  const a = mt * mt
  const b = 2 * mt * t
  const c = t * t
  out.x = a * (p[0] as number) + b * (p[2] as number) + c * (p[4] as number)
  out.y = a * (p[1] as number) + b * (p[3] as number) + c * (p[5] as number)
}

function cubicAt(p: readonly number[], t: number, out: { x: number; y: number }): void {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  out.x = a * (p[0] as number) + b * (p[2] as number) + c * (p[4] as number) + d * (p[6] as number)
  out.y = a * (p[1] as number) + b * (p[3] as number) + c * (p[5] as number) + d * (p[7] as number)
}

/**
 * The ONE walker. Replays a command list as a sequence of subpaths, each a
 * sequence of sample points, and hands them to the sink.
 *
 * Both public entry points below go through this, so a length and a table built
 * from the same commands cannot disagree — the second is the first with its
 * samples retained. A second replay of the same five commands is a second place
 * to forget `quadraticCurveTo`, which is the bug this file exists to not have.
 *
 * `closePath` ENDS the subpath, after a segment back to where it started: that
 * is what both dashing implementations treat as a subpath boundary, and a
 * closed contour's stroke really does traverse that segment. A drawing command
 * that follows a `closePath` with no `moveTo` begins a new subpath at the
 * closed one's start, which is canvas's and SVG's own rule.
 */
function walkPath(
  commands: readonly Cmd[] | null | undefined,
  onStart: (x: number, y: number) => void,
  onPoint: (x: number, y: number) => void,
): void {
  if (!Array.isArray(commands)) return
  // `open` is false before the first `moveTo` AND after a `closePath`; the first
  // drawing command in either state opens a subpath at the current point, which
  // is (0, 0) for a list that never moved.
  let open = false
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  const p: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
  const out = { x: 0, y: 0 }

  const ensure = (): void => {
    if (open) return
    open = true
    sx = cx
    sy = cy
    onStart(cx, cy)
  }

  const curve = (n: 3 | 4): void => {
    const len = n * 2
    const poly = polygonLength(p, len)
    const ex = p[len - 2] as number
    const ey = p[len - 1] as number
    const chord = Math.hypot(ex - (p[0] as number), ey - (p[1] as number))
    if (poly <= 0) {
      // A zero-extent segment. Emitting the endpoint keeps the point list in
      // step with the commands and contributes exactly zero length.
      onPoint(ex, ey)
      cx = ex; cy = ey
      return
    }
    if (poly - chord <= FLAT_EPS * chord) {
      // Collinear controls: the chord is not an approximation, it is the answer.
      onPoint(ex, ey)
      cx = ex; cy = ey
      return
    }
    const steps = samplesForTurn(p, len)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      if (n === 3) quadAt(p, t, out)
      else cubicAt(p, t, out)
      onPoint(out.x, out.y)
    }
    cx = ex; cy = ey
  }

  for (const c of commands) {
    if (!c) continue
    const a = c.args
    switch (c.command) {
      case 'moveTo':
        cx = fin(a?.[0]); cy = fin(a?.[1])
        open = true
        sx = cx; sy = cy
        onStart(cx, cy)
        break
      case 'lineTo': {
        ensure()
        const x = fin(a?.[0]); const y = fin(a?.[1])
        onPoint(x, y)
        cx = x; cy = y
        break
      }
      case 'quadraticCurveTo':
        ensure()
        p[0] = cx; p[1] = cy
        p[2] = fin(a?.[0]); p[3] = fin(a?.[1])
        p[4] = fin(a?.[2]); p[5] = fin(a?.[3])
        curve(3)
        break
      case 'bezierCurveTo':
        ensure()
        p[0] = cx; p[1] = cy
        p[2] = fin(a?.[0]); p[3] = fin(a?.[1])
        p[4] = fin(a?.[2]); p[5] = fin(a?.[3])
        p[6] = fin(a?.[4]); p[7] = fin(a?.[5])
        curve(4)
        break
      case 'closePath':
        if (!open) break
        // The closing segment is real ink on a stroked contour.
        onPoint(sx, sy)
        cx = sx; cy = sy
        open = false
        break
      default:
        break
    }
  }
}

// ── Lengths — the draw loop's entry point ───────────────────────────────────

export interface VtPathLength {
  /** Arc length of each SUBPATH, in the order the commands declare them. */
  subpaths: number[]
  /** Sum over the subpaths. */
  total: number
  /**
   * The longest subpath. **This is the number a draw-on dashes against** — see
   * `vtDrawOnDash`.
   */
  longest: number
}

const EMPTY_LENGTH = (): VtPathLength => ({ subpaths: [], total: 0, longest: 0 })

/**
 * Arc length of a command list, per subpath and in total.
 *
 * Allocation-light on purpose: one array of subpath lengths, no retained
 * samples. This is what runs once per (glyph, frame) on a draw-on.
 */
export function pathLength(commands: readonly Cmd[] | null | undefined): VtPathLength {
  const subpaths: number[] = []
  let acc = 0
  let px = 0
  let py = 0
  let started = false
  walkPath(
    commands,
    (x, y) => {
      if (started) subpaths.push(acc)
      started = true
      acc = 0
      px = x
      py = y
    },
    (x, y) => {
      acc += Math.hypot(x - px, y - py)
      px = x
      py = y
    },
  )
  if (started) subpaths.push(acc)
  if (!subpaths.length) return EMPTY_LENGTH()
  let total = 0
  let longest = 0
  for (const s of subpaths) {
    total += s
    if (s > longest) longest = s
  }
  return { subpaths, total, longest }
}

// ── The cumulative-chord table, and the inversion ───────────────────────────

export interface VtSubpathTable {
  /** Sample points, `x, y` interleaved. `cum.length * 2` entries. */
  readonly pts: Float64Array
  /** Cumulative chord length at each sample. `cum[0]` is 0, monotone
   *  non-decreasing by construction — which is what the binary search assumes,
   *  so it is built the only way that cannot violate it. */
  readonly cum: Float64Array
  /** `cum[cum.length - 1]`. Never negative; may be exactly 0. */
  readonly length: number
}

export interface VtPathTable {
  readonly subpaths: VtSubpathTable[]
  readonly total: number
  readonly longest: number
}

/**
 * The same walk, with its samples RETAINED — a cumulative-chord table per
 * subpath, ready for `pointAtPathLength`.
 *
 * Heavier than `pathLength` (it keeps every sample) and not on the draw path.
 * Build one when you need to place something ALONG the outline — a pen dot
 * following the stroke, a marker at 40 % — rather than only to measure it.
 */
export function buildPathTable(commands: readonly Cmd[] | null | undefined): VtPathTable {
  const subs: Array<{ xs: number[]; cum: number[] }> = []
  let cur: { xs: number[]; cum: number[] } | null = null
  let px = 0
  let py = 0
  walkPath(
    commands,
    (x, y) => {
      cur = { xs: [x, y], cum: [0] }
      subs.push(cur)
      px = x
      py = y
    },
    (x, y) => {
      if (!cur) return
      cur.xs.push(x, y)
      cur.cum.push((cur.cum[cur.cum.length - 1] as number) + Math.hypot(x - px, y - py))
      px = x
      py = y
    },
  )
  const subpaths: VtSubpathTable[] = subs.map(s => ({
    pts: new Float64Array(s.xs),
    cum: new Float64Array(s.cum),
    length: s.cum[s.cum.length - 1] as number,
  }))
  let total = 0
  let longest = 0
  for (const s of subpaths) {
    total += s.length
    if (s.length > longest) longest = s.length
  }
  return { subpaths, total, longest }
}

/** A point on a path plus the direction of travel there, in radians. */
export interface VtPathPoint {
  x: number
  y: number
  /** Tangent, radians, pointing along increasing `s`. */
  angle: number
}

/**
 * **The inversion.** The point at arc length `s` along a subpath — binary
 * search over the cumulative table, then a linear interpolation inside the
 * bracketing chord.
 *
 * Linear is the right order: within one sample step the curve is a chord to
 * within the `h²/24` above, so the residual is smaller than the table's own
 * quantisation. `s` outside `[0, length]` clamps to an end, and a zero-length
 * subpath returns its single point for every `s` — no NaN leaves here.
 */
export function pointOnSubpath(sub: VtSubpathTable, s: number): VtPathPoint {
  const { pts, cum, length } = sub
  const last = cum.length - 1
  if (last < 1 || !(length > 0)) {
    return { x: pts[0] ?? 0, y: pts[1] ?? 0, angle: 0 }
  }
  const sc = Math.min(length, Math.max(0, typeof s === 'number' && Number.isFinite(s) ? s : 0))
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((cum[mid] as number) <= sc) lo = mid
    else hi = mid
  }
  const c0 = cum[lo] as number
  const span = (cum[hi] as number) - c0
  // A zero-width step means the path stalled here (a cusp, a repeated point).
  // Landing on the step's start is the only defined answer.
  const f = span > 0 ? (sc - c0) / span : 0
  const x0 = pts[lo * 2] as number
  const y0 = pts[lo * 2 + 1] as number
  const x1 = pts[hi * 2] as number
  const y1 = pts[hi * 2 + 1] as number
  const dx = x1 - x0
  const dy = y1 - y0
  return {
    x: x0 + dx * f,
    y: y0 + dy * f,
    angle: dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx),
  }
}

/**
 * The point at arc length `s` along the WHOLE path, subpaths treated as
 * concatenated in declaration order.
 *
 * The public promise, identical to `./curve.ts`'s: **advance `s` by a fixed
 * amount and the point moves a fixed distance along the path**, however fast
 * the Bézier parameterisation happens to be running there.
 */
export function pointAtPathLength(table: VtPathTable, s: number): VtPathPoint {
  const subs = table.subpaths
  if (!subs.length) return { x: 0, y: 0, angle: 0 }
  let rest = typeof s === 'number' && Number.isFinite(s) ? s : 0
  if (rest <= 0) return pointOnSubpath(subs[0] as VtSubpathTable, 0)
  for (const sub of subs) {
    if (rest <= sub.length) return pointOnSubpath(sub, rest)
    rest -= sub.length
  }
  const tail = subs[subs.length - 1] as VtSubpathTable
  return pointOnSubpath(tail, tail.length)
}

// ── The dash a draw-on is made of ───────────────────────────────────────────

/**
 * A dash pattern, in the two forms the two surfaces want:
 * `ctx.setLineDash(dash)` + `ctx.lineDashOffset = offset` on canvas,
 * `stroke-dasharray` + `stroke-dashoffset` in SVG. Same two numbers, one
 * derivation, so the surfaces cannot drift.
 */
export interface VtDashSpec {
  /** `[dash, gap]`, both equal to the reference length. */
  dash: [number, number]
  offset: number
}

/**
 * The draw-on dash for a reference length and a progress in 0..1.
 *
 * `dasharray = [L, L]` makes one dash of `L` followed by one gap of `L`, i.e. a
 * pattern of period `2L` in which at most one dash can start inside a subpath
 * of length ≤ L. `dashoffset = L·(1 − p)` slides that pattern so the dash
 * covers exactly the first `L·p` of the subpath:
 *
 *   - `p = 0` → offset `L` → the whole subpath sits in the gap. Nothing drawn.
 *   - `p = 1` → offset `0` → the dash starts at the subpath's own start and runs
 *     for `L`. Everything drawn.
 *
 * **This is the canonical idiom, and that is a feature of the EXPORT**: a
 * designer who opens the SVG finds a real dashed stroke with a real offset and
 * can restyle, re-time or delete it. A clip or a mask would give them a
 * permanently half-drawn letter.
 *
 * ## `L` is the LONGEST SUBPATH, not the total
 *
 * Both dashing implementations restart the pattern at every subpath, and there
 * is exactly one dasharray per path element — so the choice of `L` decides how
 * a multi-contour letter draws, and only one choice finishes when the progress
 * does. With `L` = the TOTAL, an `o` whose outer contour is 200 and inner 150
 * would be fully drawn at `p = 200/350 = 0.57` and the last 43 % of the slider
 * would do nothing visible. With `L` = the longest, every contour draws at the
 * same SPEED (`L·p` of arc each), the short ones finish early, and the letter
 * completes exactly at `p = 1`. That is also what a pen doing the drawing would
 * do — it does not slow down for the counter of an `o`.
 *
 * Returns `null` when there is nothing to dash — a non-positive length, or
 * `p ≥ 1`. `null` means **emit no dash at all**, which is what keeps every
 * config written before draw-on existed byte-identical on both surfaces.
 */
export function vtDrawOnDash(length: number, progress: number): VtDashSpec | null {
  const L = typeof length === 'number' && Number.isFinite(length) ? length : 0
  if (!(L > 0)) return null
  const p = clamp01(typeof progress === 'number' && Number.isFinite(progress) ? progress : 1)
  if (p >= 1) return null
  return { dash: [L, L], offset: L * (1 - p) }
}
