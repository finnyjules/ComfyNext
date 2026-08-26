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

/** A take as the client handles it: the server's `VibeTake` widened to
 *  `ParamValue`, because `validatePatch` coerces a `switch` change to a real
 *  boolean. A server `VibeTake` is assignable to this. */
export interface StudioTake {
  label: string
  changes: { key: string, value: ParamValue }[]
  rationale: string
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

/** How much wider the ONE re-spread attempt reaches. */
export const RESPREAD_AMPLIFY = 2

/** Appended to a variation that stayed too close even after the wider re-spread.
 *  Honest rather than hidden: the tile IS nearly the same picture. */
export const SUBTLE_SUFFIX = ' (subtle)'

/** Appended to a take that lost more than half of what it asked for — the model
 *  named keys this studio cannot apply. Same honesty as SUBTLE_SUFFIX: the tile
 *  admits it is only part of the idea, instead of a rationale describing an
 *  intent nothing carried out. */
export const PARTIAL_SUFFIX = ' (partial)'

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
