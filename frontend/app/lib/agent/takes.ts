/**
 * Four takes — the client-side half that owes nothing to the network.
 *
 * Two jobs, both pure-ish and both deliberately free of studio knowledge:
 *
 *  1. `spreadAroundTake` — the "≈ variations of this" button. It makes NO second
 *     model call. Given the controls the studio offered, the config values it
 *     started from, and the take the user picked, it moves the 2–3 dials that
 *     take moved most and hands back four parametric neighbours with honest,
 *     generated captions ("Softness +", "Angle −"). Seeded, so the same pick
 *     re-rolled twice gives the same four neighbours (house rule: hash of the
 *     inputs, never Math.random).
 *
 *  2. Visual distinctness — `thumbSignature`/`pixelDistance`. Configs being
 *     provably different is not the promise; the four PICTURES being different
 *     is. These let the wiring check the rendered tiles and widen a spread that
 *     came out looking the same.
 *
 *  3. The pick log — every keep / dismiss / selection-switch, appended to a
 *     bounded localStorage ring. Nothing reads it yet on purpose; it is the
 *     training data the future personal-taste work needs, and it can only be
 *     collected from day one. SSR-safe (no window ⇒ silent no-op).
 */
import type { DescribedControl } from '~/lib/spacetype/controlDescriptor'
import { validatePatch } from '~/lib/spacetype/controlDescriptor'
import type { ParamValue } from '~/lib/spacetype/effect'
import type { PromiseDirection, TakePromise } from '~/lib/vibePrompt'

/** A take as the client handles it: the server's `VibeTake` widened to
 *  `ParamValue`, because `validatePatch` coerces a `switch` change to a real
 *  boolean. A server `VibeTake` is assignable to this. */
export interface StudioTake {
  label: string
  changes: { key: string, value: ParamValue }[]
  rationale: string
  /** What this take CLAIMS its picture will show — checked against the real
   *  thumbnail once it renders. Absent when the model was unsure, and absent on
   *  a parametric neighbour (a spread promises nothing of its own). */
  promise?: TakePromise
}

// ─── seeded randomness ───────────────────────────────────────────────────────
// FNV-1a over the joined inputs. The house rule is "hash of (inputs), never
// Math.random" — the same spread must come back on a reload, and two different
// seeds must genuinely disagree.
function hash01(...parts: (string | number)[]): number {
  let h = 0x811c9dc5
  const s = parts.join('')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h / 0x1_0000_0000
}

/** A deterministic index into a list of `length`, from any seed. Same seed, same
 *  pick — the house rule (hash of the inputs, never Math.random) applied to a
 *  choice that is not numeric. */
export function seededIndex(seed: string | number, length: number): number {
  if (length <= 0) return 0
  return Math.floor(hash01(seed, 'pick') * length) % length
}

// ─── numeric helpers (kept in step with validatePatch's slider maths) ────────
function stepDecimals(step: number): number {
  const s = String(step)
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

function snapClamp(c: DescribedControl, n: number): number {
  const min = c.min!, max = c.max!, step = c.step!
  const snapped = Math.round((n - min) / step) * step + min
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(stepDecimals(step)))
}

const isSlider = (c: DescribedControl | undefined): c is DescribedControl =>
  !!c && c.kind === 'slider' && Number.isFinite(c.min) && Number.isFinite(c.max) && (c.step ?? 0) > 0

// ── how far a neighbour actually moves ──────────────────────────────────────
//
// Live report (2026-08-25, owner): the four "≈ variations" tiles looked
// virtually identical. Two numbers were the cause — the offset pattern's half
// steps (±0.5) multiplied by a 0.75 low jitter meant the WEAKEST of the four
// slots moved only ~6% of a control's range, which on most of these controls is
// invisible at any size, never mind 52px.
//
// So the floor is now explicit rather than emergent: every slot's offset is at
// least MIN_PRIMARY_MOVE of the range before clamping, and the three constants
// below are chosen to satisfy it — 0.75 (weakest pattern step) × 0.18
// (amplitude) × 0.9 (lowest jitter) = 0.1215. A test asserts the floor against
// the constants, so tuning one of them without the others fails loudly.
/**
 * The smallest fraction of a control's range any variation may move it.
 *
 * A PRE-SNAP guarantee, honestly. Snapping to the control's own step can take
 * back up to one step, so on a control whose step is a large slice of its range
 * (0..10 by 1 — one step is already 10%) the promise degrades to "at least one
 * step". A slider with only a handful of reachable values physically cannot
 * carry four distinct tiles 12% apart; the code walks steps rather than
 * pretending, and a spec pins both bounds.
 */
export const MIN_PRIMARY_MOVE = 0.12
const AMPLITUDE = 0.18
/** Two big steps and two smaller ones, so the four read as a spread rather than
 *  two pairs — but no step is small enough to be invisible. */
const PATTERN = [-1.5, 1.5, -0.75, 0.75]
const JITTER_MIN = 0.9
const JITTER_SPAN = 0.2

/**
 * Controls whose value does NOT change a still frame — speeds, drifts, phases,
 * durations. A thumbnail is a still, so spreading one of these produces four
 * tiles that are pixel-identical however far apart the numbers are.
 *
 * A name heuristic, deliberately and honestly: there is no "affects the still"
 * flag on `ControlSpec`, and adding one across five studios' vocabularies is a
 * much larger change than this warrants. It is only ever used to DEPRIORITIZE —
 * never to leave a take with nothing to spread — so a false positive costs a
 * worse ordering, not a broken button. The render-aware pass in the wiring
 * (`thumbDistance` below) is what actually GUARANTEES the tiles differ; this
 * only makes it rarely have to intervene.
 */
export const STATIC_INVISIBLE = /speed|drift|fps|duration|phase/i

/** False for a control whose value cannot show up in a still frame. */
function movesTheStill(c: DescribedControl): boolean {
  return !(STATIC_INVISIBLE.test(c.path) || STATIC_INVISIBLE.test(c.label))
}

/**
 * The keys this take moved most, relative to each control's own range —
 * comparing a 0..1 softness against a 0..360 hue any other way is meaningless.
 * Sliders only (a colour or an enum has no "±"), capped at three, and never a
 * key the take did not actually change.
 *
 * Keys that cannot show in a still (see `STATIC_INVISIBLE`) sort BELOW every key
 * that can, whatever their delta. The live failure that motivated this: a "soft
 * dreamy" gradient take moved blur AND flow speed, flow speed scored highest, so
 * the strongest of the three variation axes was one no thumbnail could ever
 * show. They are only deprioritized, never dropped — a take that moved nothing
 * but motion still spreads motion, which beats refusing to spread at all.
 */
export function chooseSpreadKeys(
  controls: DescribedControl[],
  base: Record<string, ParamValue>,
  take: StudioTake,
): string[] {
  const byPath = new Map(controls.map(c => [c.path, c]))
  const scored: { key: string, score: number, still: boolean }[] = []
  for (const ch of take.changes) {
    const c = byPath.get(ch.key)
    if (!isSlider(c)) continue
    const to = Number(ch.value)
    const from = Number(base[ch.key] ?? c.current)
    if (!Number.isFinite(to) || !Number.isFinite(from)) continue
    const range = c.max! - c.min!
    if (!(range > 0)) continue
    const score = Math.abs(to - from) / range
    if (score <= 0) continue
    scored.push({ key: ch.key, score, still: movesTheStill(c) })
  }
  scored.sort((a, b) =>
    Number(b.still) - Number(a.still) || b.score - a.score || a.key.localeCompare(b.key))
  return scored.slice(0, 3).map(s => s.key)
}

/**
 * Four distinct values around `v`, all inside the control's range and on its
 * step. The offset pattern is ±1.5 / ±0.75 amplitude, rotated by the seed (see
 * MIN_PRIMARY_MOVE for why those numbers and not smaller ones); an offset
 * that would leave the range is mirrored to the other side, and anything that
 * still collides (a take pinned at max, a coarse step) is walked outward by
 * whole steps until it lands somewhere unused. `v` itself counts as used, so a
 * neighbour can never be the take restated.
 */
function fourAround(c: DescribedControl, v: number, seed: string | number, key: string, scale = 1): number[] {
  const range = c.max! - c.min!
  const jitter = JITTER_MIN + JITTER_SPAN * hash01(seed, 'amp', key)
  const amp = Math.max(c.step!, AMPLITUDE * range) * jitter * scale
  const rot = Math.floor(hash01(seed, 'rot', key) * 4) % 4
  const used = new Set<number>([snapClamp(c, v)])
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    const off = PATTERN[(i + rot) % 4]! * amp
    const inRange = (n: number) => n >= c.min! && n <= c.max!
    let n = snapClamp(c, inRange(v + off) ? v + off : v - off)
    if (used.has(n)) {
      // Walk a step at a time, AWAY from the pick first. At a range boundary the
      // mirror folds both signs onto the same side, so collisions are the norm
      // there, and stepping back toward the pick is the only resolution that can
      // shrink a move. Honestly: on the values that actually reach here (always
      // step-snapped, since validatePatch runs first) the floor held with either
      // preference — this is the safer tie-break, not a measured fix. The real
      // boundary weakness is step granularity, which MIN_PRIMARY_MOVE documents
      // and a spec pins. Both directions are still tried, so a free value is
      // always found; only the order changed.
      const steps = Math.max(1, Math.round(range / c.step!))
      const away = n >= v ? 1 : -1
      for (let k = 1; k <= steps; k++) {
        const out = n + away * k * c.step!
        if (!used.has(snapClamp(c, out)) && inRange(out)) { n = snapClamp(c, out); break }
        const back = n - away * k * c.step!
        if (!used.has(snapClamp(c, back)) && inRange(back)) { n = snapClamp(c, back); break }
      }
    }
    used.add(n)
    out.push(n)
  }
  return out
}

function fmt(c: DescribedControl, n: number): string {
  return n.toFixed(stepDecimals(c.step!))
}

/** "Softness +, Angle −" — the two dials that moved most in THIS neighbour,
 *  named by the control's own label. Honest and parametric by construction: no
 *  sentence here was invented, and none of it came from a model. */
function caption(moved: { c: DescribedControl, from: number, to: number }[]): string {
  const parts = moved
    .slice()
    .sort((a, b) => Math.abs(b.to - b.from) / (b.c.max! - b.c.min!) - Math.abs(a.to - a.from) / (a.c.max! - a.c.min!))
    .map(m => `${m.c.label} ${m.to >= m.from ? '+' : '−'}`)
  const two = parts.slice(0, 2).join(', ')
  if (two.length <= 24) return two
  const one = parts[0] ?? ''
  return one.length <= 24 ? one : `${one.slice(0, 23)}…`
}

/**
 * Four parametric neighbours of `take`. Each neighbour carries ALL of the take's
 * changes (so applying one to the ORIGINAL config lands next to the take, not
 * next to the base), with the chosen 2–3 keys moved.
 *
 * Returns `[]` when there is nothing numeric to move at all — four identical
 * tiles would be a lie, and the caller can leave the button disabled.
 */
export function spreadAroundTake(
  controls: DescribedControl[],
  base: Record<string, ParamValue>,
  take: StudioTake,
  seed: string | number = 0,
  /** `amplitudeScale` widens every offset — the wiring re-spreads a slot with it
   *  when the first attempt rendered too close to the take to tell apart. */
  opts: { amplitudeScale?: number } = {},
): StudioTake[] {
  const byPath = new Map(controls.map(c => [c.path, c]))
  // The take, as the studio would actually apply it (unknown keys dropped,
  // sliders clamped and snapped) — spreading around an unvalidated patch would
  // spread around values the studio can't reach.
  const raw: Record<string, ParamValue> = {}
  for (const ch of take.changes) raw[ch.key] = ch.value
  const takeValues = validatePatch(raw, controls)

  let keys = chooseSpreadKeys(controls, base, take)
  if (!keys.length) {
    // Fallback: the take moved nothing numeric (an enum switch, a colour). Move
    // the sliders the studio offered instead, so the button still does something
    // truthful rather than rendering four copies of one tile — still-visible
    // ones first, for the same reason chooseSpreadKeys prefers them.
    const sliders = controls.filter(isSlider)
    keys = [...sliders.filter(movesTheStill), ...sliders.filter(c => !movesTheStill(c))]
      .slice(0, 3).map(c => c.path)
  }
  if (!keys.length) return []

  const scale = opts.amplitudeScale ?? 1
  const spreads = new Map<string, number[]>()
  const starts = new Map<string, number>()
  for (const k of keys) {
    const c = byPath.get(k)!
    const start = snapClamp(c, Number(takeValues[k] ?? base[k] ?? c.current))
    starts.set(k, start)
    spreads.set(k, fourAround(c, start, seed, k, scale))
  }

  const out: StudioTake[] = []
  for (let i = 0; i < 4; i++) {
    const values: Record<string, ParamValue> = { ...takeValues }
    const moved: { c: DescribedControl, from: number, to: number }[] = []
    for (const k of keys) {
      const c = byPath.get(k)!
      const to = spreads.get(k)![i]!
      values[k] = to
      moved.push({ c, from: starts.get(k)!, to })
    }
    const changes = Object.entries(values).map(([key, value]) => ({ key, value }))
    const detail = moved.map(m => `${m.c.label} ${fmt(m.c, m.from)} → ${fmt(m.c, m.to)}`).join(', ')
    out.push({
      label: caption(moved),
      changes,
      rationale: `${detail} — a parametric spread around “${take.label}”, no new model call.`,
    })
  }
  return out
}

// ─── did the variation actually LOOK different? ──────────────────────────────
//
// The numbers moving is not the point; the picture changing is. The distinctness
// tests before this were all numeric, which is exactly the failure the house
// "parity tests agree on the wrong answer" lesson describes — four provably
// different configs that render as four identical tiles still passed. So the
// wiring compares PIXELS after the thumbnails land, and these are the primitives
// it uses. Nothing here knows a studio; a thumbnail is just a canvas.

/** Both thumbnails are shrunk to this before comparing. Small enough to be free
 *  (1024 pixels), big enough that a change of shape or layout still registers. */
export const THUMB_DIFF_SIZE = 32

/**
 * Mean absolute per-channel difference below which two tiles are "the same
 * picture", on the 0..255 scale `pixelDistance` returns.
 *
 * A first estimate, and openly so — it is why `visualDiff` is written into every
 * pick-log event: the real value should come from reading a few hundred logged
 * scores, not from this guess.
 *
 * The one live calibration it has (gradient studio, real renders, 2026-08-25):
 *   before the amplitude fix — worst pair among the four 4.99, worst tile vs the
 *   pick 8.12 (the owner's "they look identical" report);
 *   after — worst pair 9.88, worst tile vs the pick 11.54.
 * So 6 sits between a complaint and an accepted spread, which is the right side
 * of both — on a sample of one gradient.
 */
export const THUMB_DIFF_MIN = 6

/**
 * The bar two MODEL takes must clear to count as different pictures — a much
 * higher bar than `THUMB_DIFF_MIN`, and deliberately its own number.
 *
 * `THUMB_DIFF_MIN` (6) answers "are these the same to the eye?", which is the
 * right question for a parametric spread: four neighbours of one idea are
 * SUPPOSED to look related, and only near-identity is a failure. Model takes
 * claim to be genuinely different readings, so "not literally the same" is far
 * too weak a promise to hold them to.
 *
 * Calibrated from the strips measured live and judged good — worst pairs of
 * 29.79, 40.65 and 55.70 — against a reported bad strip whose duplicate pair sat
 * somewhere between 6 and roughly 20. 20 is under the weakest good strip with
 * about a third of margin, and over three times the "same to the eye" floor.
 * Spreads keep `THUMB_DIFF_MIN`; only take-vs-take uses this.
 */
export const TAKE_DISTINCT_MIN = 20

/** How much wider the ONE re-spread attempt reaches. */
export const RESPREAD_AMPLIFY = 2

/** Appended to a variation that stayed too close even after the wider re-spread.
 *  Honest rather than hidden: the tile IS nearly the same picture. */
export const SUBTLE_SUFFIX = ' (subtle)'

/** Appended to a MODEL take whose picture could not be told apart from another
 *  take's, after the one local re-spread. Lowest of the three honesty suffixes:
 *  a take that lost half its changes, or broke a claim it made itself, is saying
 *  something more serious than "this one looks like that one". */
export const SIMILAR_SUFFIX = ' (similar)'

/** The three honesty suffixes, most serious first. A tile shows at most ONE:
 *  `(partial)` already implies the take is degraded, `(differs)` that it broke
 *  its own promise, and stacking parenthetical apologies on a 52px tile is noise
 *  rather than honesty. Each stage checks this before adding its own. */
export const HONESTY_SUFFIXES = [' (partial)', ' (differs)', ' (similar)'] as const

/** True when a label already carries one of the honesty suffixes. */
export function hasHonestySuffix(label: string): boolean {
  return HONESTY_SUFFIXES.some(sfx => label.includes(sfx.trim()))
}

/** Appended to a take whose rendered picture broke a claim its own promise
 *  made, after the one repair attempt. Never shown alongside PARTIAL_SUFFIX —
 *  see `withSuffix`'s callers: a take that lost half its changes is already
 *  saying the stronger thing about itself, and two parenthetical apologies on
 *  one 52px tile is noise, not honesty. */
export const DIFFERS_SUFFIX = ' (differs)'

/** Appended to a take that lost more than half of what it asked for — the model
 *  named keys this studio cannot apply. Same honesty as SUBTLE_SUFFIX: the tile
 *  admits it is only part of the idea, instead of a rationale describing an
 *  intent nothing carried out. */
export const PARTIAL_SUFFIX = ' (partial)'

/** The strip's tile-label budget (`caption` above targets the same number). */
export const MAX_LABEL_CHARS = 24

/**
 * `label + suffix`, trimming the LABEL rather than the suffix.
 *
 * The suffix is the honest part — `(partial)` / `(subtle)` is the whole reason
 * the tile is labelled at all — so a long angle name must not push it off the
 * end and leave a tile that looks like an ordinary alternative.
 */
export function withSuffix(label: string, suffix: string, max = MAX_LABEL_CHARS): string {
  if (label.length + suffix.length <= max) return `${label}${suffix}`
  const room = Math.max(1, max - suffix.length - 1)
  return `${label.slice(0, room).trimEnd()}…${suffix}`
}

/** A thumbnail as the strip accepts it. Only a canvas can be compared — an
 *  adapter that hands back a data URL is simply not measured (no decode, no
 *  async), and the caller treats an unmeasurable pair as "can't tell". */
export type ComparableThumb = HTMLCanvasElement | string | null | undefined

/** Shrink a thumbnail to THUMB_DIFF_SIZE² and return its raw RGBA bytes, or
 *  `null` if it cannot be read (no DOM, a data-URL thumb, a tainted or
 *  zero-sized canvas). Never throws. */
export function thumbSignature(t: ComparableThumb, size = THUMB_DIFF_SIZE): Uint8ClampedArray | null {
  if (!t || typeof t === 'string') return null
  if (typeof document === 'undefined') return null
  try {
    const off = document.createElement('canvas')
    off.width = size
    off.height = size
    const ctx = off.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null
    if (!ctx) return null
    ctx.drawImage(t, 0, 0, size, size)
    return ctx.getImageData(0, 0, size, size).data
  } catch { return null }
}

/**
 * Mean absolute difference per channel between two RGBA buffers, 0..255.
 * `null` when the two cannot be compared at all (missing, or different sizes) —
 * deliberately not 0, which would read as "identical" and trigger a re-spread of
 * something nobody actually measured.
 *
 * Alpha counts: Shape and Vector Type draw on transparency, where a silhouette
 * change moves alpha and nothing else.
 */
export function pixelDistance(
  a: Uint8ClampedArray | null,
  b: Uint8ClampedArray | null,
): number | null {
  if (!a || !b || !a.length || a.length !== b.length) return null
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!)
  return sum / a.length
}

/** The two above, together: how different these two tiles look, or `null`. */
export function thumbDistance(a: ComparableThumb, b: ComparableThumb): number | null {
  return pixelDistance(thumbSignature(a), thumbSignature(b))
}


// ─── take promises: measuring what a picture actually shows ──────────────────
//
// A rationale is prose — it can describe a sunset over a picture of a rainbow,
// and nothing notices. A PROMISE is the same intent stated in terms these
// functions can measure against the real thumbnail. Everything below is pure
// maths over the SAME 32² RGBA downsample `thumbSignature` produces for the
// visual-diff guard, so a promise costs one buffer we already had.
//
// The governing rule, everywhere: NO EVIDENCE IS NOT A MISS. A render that
// failed, a fully transparent picture, a colour word we cannot name — all skip
// the claim rather than fail it. Labelling a tile "(differs)" because we could
// not look at it would be the same dishonesty in the other direction.

/** Fraction of the picture a promised colour must own (with neighbours) to
 *  count as dominant. 12%: low enough that a real accent colour in a four-stop
 *  ramp passes, high enough that a stray sliver does not. */
export const COLOR_SHARE_MIN = 0.12
/** Below this mean per-channel change, an axis is flat — no direction claim can
 *  be made from it either way. On the 0..255 scale `pixelDistance` uses. */
export const DIRECTION_MIN_ENERGY = 1.5
/** How much one axis must beat the other to be called THE direction. 1.6 keeps
 *  an isotropic-but-busy field (marble) honestly undirected. */
export const DIRECTION_RATIO = 1.6
/** Centre-vs-edge mean difference above which a picture reads as radial. */
export const RADIAL_MIN = 8
/** Fraction of the frame that must be OPAQUE before a direction can be read at
 *  all. Below it there is too little picture to say anything about. */
export const DIRECTION_MIN_COVERAGE = 0.05
/** Half-width of the luminance band where a picture is neither dark nor light,
 *  and so fails NEITHER claim. */
export const TONE_DEAD_ZONE = 0.08

/** Alpha below this is empty canvas, not a colour — Shape and Vector Type draw
 *  on transparency, and counting their background as black would make every one
 *  of their takes "mostly black". */
const ALPHA_FLOOR = 32
/** Below this CHROMA (max-min channel, 0..1) a pixel has no hue worth naming;
 *  it is white, grey or black by luminance instead.
 *
 *  Chroma, not HSL saturation, and the difference matters: HSL divides by
 *  `1-|2L-1|`, which collapses toward zero at the ends of the range, so a
 *  near-white #fafafc reports a saturation of 0.25 and would be named by a hue
 *  it does not visibly have. Chroma stays proportional to what the eye sees. */
const ACHROMATIC_CHROMA = 0.1

/** Hue wheel, in the order the eye walks it — adjacency comes from this order,
 *  so the table is the single source for both naming and tolerance. */
const HUE_BUCKETS: { name: string, from: number, to: number }[] = [
  { name: 'red', from: 345, to: 15 }, // wraps
  { name: 'orange', from: 15, to: 45 },
  { name: 'yellow', from: 45, to: 70 },
  { name: 'green', from: 70, to: 160 },
  { name: 'teal', from: 160, to: 185 },
  { name: 'cyan', from: 185, to: 200 },
  { name: 'blue', from: 200, to: 255 },
  { name: 'purple', from: 255, to: 285 },
  { name: 'magenta', from: 285, to: 320 },
  { name: 'pink', from: 320, to: 345 },
]

/** Who counts as "close enough" to whom. The chromatic ring is circular; grey
 *  sits between white and black, which are NOT neighbours of each other. */
const NEIGHBOURS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {}
  HUE_BUCKETS.forEach((b, i) => {
    const prev = HUE_BUCKETS[(i - 1 + HUE_BUCKETS.length) % HUE_BUCKETS.length]!
    const next = HUE_BUCKETS[(i + 1) % HUE_BUCKETS.length]!
    out[b.name] = [prev.name, next.name]
  })
  out.white = ['grey']
  out.grey = ['white', 'black']
  out.black = ['grey']
  return out
})()

/** Every name `measureColors` can produce, and so every name a promise can be
 *  checked against. Anything else is unmeasurable, not wrong. */
export const MEASURABLE_COLORS: string[] = [...HUE_BUCKETS.map(b => b.name), 'white', 'grey', 'black']

function hueOf(r: number, g: number, b: number): { hue: number, chroma: number, lum: number } {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const d = max - min
  const lum = (max + min) / 2
  let hue = 0
  if (d !== 0) {
    if (max === R) hue = 60 * (((G - B) / d) % 6)
    else if (max === G) hue = 60 * ((B - R) / d + 2)
    else hue = 60 * ((R - G) / d + 4)
  }
  return { hue: (hue + 360) % 360, chroma: d, lum }
}

function nameOf(r: number, g: number, b: number): string {
  const { hue, chroma, lum } = hueOf(r, g, b)
  if (chroma < ACHROMATIC_CHROMA) return lum > 0.85 ? 'white' : lum < 0.15 ? 'black' : 'grey'
  for (const b2 of HUE_BUCKETS) {
    if (b2.from > b2.to) { if (hue >= b2.from || hue < b2.to) return b2.name } // the wrap-around bucket
    else if (hue >= b2.from && hue < b2.to) return b2.name
  }
  return 'grey'
}

export interface ColorMeasure {
  /** name → fraction of the OPAQUE pixels. */
  shares: Record<string, number>
  /** How many pixels were opaque enough to count. 0 ⇒ nothing measurable. */
  total: number
}

/** The picture's colour histogram, by name. */
export function measureColors(sig: Uint8ClampedArray): ColorMeasure {
  const counts: Record<string, number> = {}
  let total = 0
  for (let i = 0; i < sig.length; i += 4) {
    if (sig[i + 3]! < ALPHA_FLOOR) continue
    const name = nameOf(sig[i]!, sig[i + 1]!, sig[i + 2]!)
    counts[name] = (counts[name] ?? 0) + 1
    total++
  }
  const shares: Record<string, number> = {}
  if (total) for (const [k, v] of Object.entries(counts)) shares[k] = v / total
  return { shares, total }
}

export interface DirectionMeasure {
  direction: PromiseDirection
  vertical: number
  horizontal: number
  centreEdge: number
  /** Fraction of comparable samples that were opaque enough to count. */
  coverage: number
  /** True when neither axis nor the centre carries enough signal to read —
   *  distinct from `direction: 'none'`, which a BUSY undirected picture also
   *  produces. No signal is not the same as signal that disagrees. */
  flat: boolean
}

/**
 * Which way the picture reads. `vertical`/`horizontal` come from the same
 * row-to-row vs column-to-column mean change measured live on the real studio;
 * `radial` from centre-vs-edge; `none` when no axis dominates AND the picture is
 * not radial, which is the honest answer for something busy but undirected.
 *
 * TRANSPARENCY GATE. Shape and Vector Type draw on an empty background, and a
 * transparent pixel decodes as (0,0,0,0) — pure black. Without this gate the
 * measurement is of the SILHOUETTE, not the picture: a white bar down the middle
 * of an empty frame reads "horizontal" (the two bar edges are the only change
 * across a row), a correct vertical ramp with empty side margins reads
 * horizontal for the same reason, and any centred motif reads "radial" because
 * its middle is opaque and its border is not. Each of those would fail a take's
 * own correct promise and write a miss that never happened into the taste log.
 * So a sample pair counts only when BOTH ends are opaque, and the centre/edge
 * comparison only sums opaque pixels.
 */
export function measureDirection(sig: Uint8ClampedArray, size = THUMB_DIFF_SIZE): DirectionMeasure {
  const at = (x: number, y: number) => (y * size + x) * 4
  const opaque = (i: number) => sig[i + 3]! >= ALPHA_FLOOR
  let vert = 0, vertN = 0, horiz = 0, horizN = 0, pairs = 0
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const a = at(x, y), down = at(x, y + 1), right = at(x + 1, y)
      pairs++
      if (!opaque(a)) continue
      if (opaque(down)) { for (let k = 0; k < 3; k++) vert += Math.abs(sig[a + k]! - sig[down + k]!); vertN += 3 }
      if (opaque(right)) { for (let k = 0; k < 3; k++) horiz += Math.abs(sig[a + k]! - sig[right + k]!); horizN += 3 }
    }
  }
  const vertical = vertN ? vert / vertN : 0
  const horizontal = horizN ? horiz / horizN : 0
  const coverage = pairs ? Math.min(vertN, horizN) / (pairs * 3) : 0

  // Centre disc vs outer ring, opaque samples only.
  const c = (size - 1) / 2, maxR = Math.hypot(c, c)
  const inSum = [0, 0, 0], outSum = [0, 0, 0]
  let inN = 0, outN = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = at(x, y)
      if (!opaque(i)) continue
      const d = Math.hypot(x - c, y - c) / maxR
      if (d < 0.35) { for (let k = 0; k < 3; k++) inSum[k]! += sig[i + k]!; inN++ }
      else if (d > 0.75) { for (let k = 0; k < 3; k++) outSum[k]! += sig[i + k]!; outN++ }
    }
  }
  let centreEdge = 0
  if (inN && outN) {
    for (let k = 0; k < 3; k++) centreEdge += Math.abs(inSum[k]! / inN - outSum[k]! / outN)
    centreEdge /= 3
  }

  const isVertical = vertical >= DIRECTION_MIN_ENERGY && vertical >= horizontal * DIRECTION_RATIO
  const isHorizontal = horizontal >= DIRECTION_MIN_ENERGY && horizontal >= vertical * DIRECTION_RATIO
  const isRadial = centreEdge >= RADIAL_MIN
  const direction: PromiseDirection = isVertical
    ? 'vertical'
    : isHorizontal
      ? 'horizontal'
      : isRadial ? 'radial' : 'none'
  const flat = !isVertical && !isHorizontal && !isRadial
    && Math.max(vertical, horizontal) < DIRECTION_MIN_ENERGY
  return { direction, vertical, horizontal, centreEdge, coverage, flat }
}

export interface ToneMeasure { tone: 'dark' | 'light' | 'mid', luminance: number, total: number }

/** Mean perceived luminance, 0..1, with a middle band that belongs to neither
 *  claim — a mid-grey picture is not evidence against "dark" OR "light". */
export function measureTone(sig: Uint8ClampedArray): ToneMeasure {
  let sum = 0, n = 0
  for (let i = 0; i < sig.length; i += 4) {
    if (sig[i + 3]! < ALPHA_FLOOR) continue
    sum += (0.299 * sig[i]! + 0.587 * sig[i + 1]! + 0.114 * sig[i + 2]!) / 255
    n++
  }
  // `total: 0` means nothing was opaque enough to read. Defaulting the
  // luminance to 0.5 and reporting "mid" would fabricate a PASSING result for a
  // picture nobody could see — the same dishonesty as failing on no evidence,
  // pointing the other way.
  const luminance = n ? sum / n : 0.5
  const tone = luminance < 0.5 - TONE_DEAD_ZONE ? 'dark' : luminance > 0.5 + TONE_DEAD_ZONE ? 'light' : 'mid'
  return { tone, luminance, total: n }
}

export type PromiseClaim = 'colors' | 'direction' | 'tone'
export interface PromiseCheck {
  claim: PromiseClaim
  ok: boolean
  /** What the picture actually showed, for the warning and the log. */
  measured: string
}

/**
 * Check a take's promise against its rendered thumbnail's signature.
 *
 * Returns one result per CHECKABLE claim — a claim we cannot measure (an unknown
 * colour word, a picture that is entirely transparent, no signature at all)
 * produces no result rather than a failure.
 */
export function checkPromise(sig: Uint8ClampedArray | null, promise: TakePromise, size = THUMB_DIFF_SIZE): PromiseCheck[] {
  if (!sig || !sig.length) return []
  const out: PromiseCheck[] = []

  if (promise.colors?.length) {
    const { shares, total } = measureColors(sig)
    const known = promise.colors.filter(c => MEASURABLE_COLORS.includes(c))
    if (total > 0 && known.length) {
      const scoreOf = (name: string) =>
        (shares[name] ?? 0) + (NEIGHBOURS[name] ?? []).reduce((s, nb) => s + (shares[nb] ?? 0) * 0.5, 0)
      const misses = known.filter(c => scoreOf(c) < COLOR_SHARE_MIN)
      const top = Object.entries(shares).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')
      out.push({ claim: 'colors', ok: misses.length === 0, measured: top || 'nothing' })
    }
  }

  if (promise.direction) {
    const m = measureDirection(sig, size)
    // Two ways to have no evidence, both of which skip rather than fail:
    // too little opaque picture to read, and a picture flat enough that no
    // direction is discernible either way (a solid shape on transparency). A
    // "none" claim is still confirmed by flatness — that IS what it claims.
    const readable = m.coverage >= DIRECTION_MIN_COVERAGE && (!m.flat || promise.direction === 'none')
    if (readable) {
      out.push({
        claim: 'direction',
        ok: m.direction === promise.direction,
        measured: `${m.direction} (v ${m.vertical.toFixed(1)} / h ${m.horizontal.toFixed(1)} / centre ${m.centreEdge.toFixed(1)})`,
      })
    }
  }

  if (promise.tone) {
    const m = measureTone(sig)
    // The dead zone belongs to both claims: `mid` never fails either.
    if (m.total > 0) {
      out.push({
        claim: 'tone',
        ok: m.tone === 'mid' || m.tone === promise.tone,
        measured: `${m.tone} (${m.luminance.toFixed(2)})`,
      })
    }
  }

  return out
}

// ─── the pick log ────────────────────────────────────────────────────────────

export type TakeAction = 'keep' | 'dismiss' | 'switch'

/** One decision. `prompt` is the phrase the user typed — the only free text
 *  stored, and it never leaves the browser. */
export interface TakeEvent {
  studio: string
  prompt: string
  takeLabel: string
  changes: { key: string, value: ParamValue }[]
  action: TakeAction
  ts: number
  /** How different this take's thumbnail looked from "yours", on
   *  `pixelDistance`'s 0..255 scale — absent when it could not be measured.
   *  Free observability: THUMB_DIFF_MIN is a guess today, and these are the
   *  numbers that should replace it. */
  visualDiff?: number
  /** How different it looked from the take it was spread AROUND — present only
   *  for a "≈ variations" tile. The guard that decides whether a variation is
   *  distinct enough measures exactly this, so it is the number that can
   *  calibrate THUMB_DIFF_MIN; `visualDiff` (vs "yours") answers a different,
   *  also-useful question and neither substitutes for the other. */
  visualDiffFromPick?: number
  /** Keys the take asked for that nothing could apply. Present only when
   *  non-empty; the third time silent key-dropping cost a day, it became data. */
  droppedKeys?: string[]
  /** How the take's own promise measured against its real render. Taste data
   *  (which claims a person keeps despite a miss) and diagnostics in one. */
  promiseResults?: PromiseCheck[]
  /** What the model said when it was shown this take's own picture — keep, fix
   *  or replace, and why. Taste data of a different kind: it records the model's
   *  second thoughts alongside the person's first ones. */
  reviewVerdict?: { verdict: string, label?: string, reason?: string }
}

export const TAKE_LOG_KEY = 'sailor.takeLog.v1'
/** Ring bound. ~500 decisions is months of use and a few hundred KB at most. */
export const TAKE_LOG_MAX = 500

/** localStorage, or null on the server / in a browser that refuses it (private
 *  mode, disabled storage). Never throws — logging a pick must not be able to
 *  break a studio. */
function store(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return (window as any).localStorage ?? null } catch { return null }
}

/** The log, oldest first. Empty on the server, and empty rather than throwing on
 *  anything malformed. Exported for the future taste consumer — nothing reads it
 *  today, by design. */
export function readTakeLog(): TakeEvent[] {
  const s = store()
  if (!s) return []
  try {
    const raw = s.getItem(TAKE_LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e: any) => e && typeof e === 'object' && typeof e.action === 'string')
  } catch { return [] }
}

/** Append one decision, dropping the oldest past `TAKE_LOG_MAX`. */
export function logTakeEvent(e: Omit<TakeEvent, 'ts'> & { ts?: number }): void {
  const s = store()
  if (!s) return
  try {
    const log = readTakeLog()
    log.push({ ...e, ts: e.ts ?? Date.now() })
    s.setItem(TAKE_LOG_KEY, JSON.stringify(log.slice(-TAKE_LOG_MAX)))
  } catch { /* storage full or refused — a lost log entry is not worth an error */ }
}
