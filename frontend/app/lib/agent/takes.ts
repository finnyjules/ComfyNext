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
 *  2. The pick log — every keep / dismiss / selection-switch, appended to a
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

/** How far out one "step" of the spread reaches, as a fraction of the control's
 *  full range. Small enough that a neighbour still reads as the same idea. */
const AMPLITUDE = 0.16

/**
 * The keys this take moved most, relative to each control's own range —
 * comparing a 0..1 softness against a 0..360 hue any other way is meaningless.
 * Sliders only (a colour or an enum has no "±"), capped at three, and never a
 * key the take did not actually change.
 */
export function chooseSpreadKeys(
  controls: DescribedControl[],
  base: Record<string, ParamValue>,
  take: StudioTake,
): string[] {
  const byPath = new Map(controls.map(c => [c.path, c]))
  const scored: { key: string, score: number }[] = []
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
    scored.push({ key: ch.key, score })
  }
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
  return scored.slice(0, 3).map(s => s.key)
}

/**
 * Four distinct values around `v`, all inside the control's range and on its
 * step. The offset pattern is ±1 / ±½ amplitude, rotated by the seed; an offset
 * that would leave the range is mirrored to the other side, and anything that
 * still collides (a take pinned at max, a coarse step) is walked outward by
 * whole steps until it lands somewhere unused. `v` itself counts as used, so a
 * neighbour can never be the take restated.
 */
function fourAround(c: DescribedControl, v: number, seed: string | number, key: string): number[] {
  const range = c.max! - c.min!
  const jitter = 0.75 + 0.5 * hash01(seed, 'amp', key)
  const amp = Math.max(c.step!, AMPLITUDE * range) * jitter
  const pattern = [-1, 1, -0.5, 0.5]
  const rot = Math.floor(hash01(seed, 'rot', key) * 4) % 4
  const used = new Set<number>([snapClamp(c, v)])
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    const off = pattern[(i + rot) % 4]! * amp
    const inRange = (n: number) => n >= c.min! && n <= c.max!
    let n = snapClamp(c, inRange(v + off) ? v + off : v - off)
    if (used.has(n)) {
      // Walk outward a step at a time, trying both sides, before giving up.
      const steps = Math.max(1, Math.round(range / c.step!))
      for (let k = 1; k <= steps; k++) {
        const a = snapClamp(c, n + k * c.step!)
        if (!used.has(a) && inRange(n + k * c.step!)) { n = a; break }
        const b = snapClamp(c, n - k * c.step!)
        if (!used.has(b) && inRange(n - k * c.step!)) { n = b; break }
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
    // truthful rather than rendering four copies of one tile.
    keys = controls.filter(isSlider).slice(0, 3).map(c => c.path)
  }
  if (!keys.length) return []

  const spreads = new Map<string, number[]>()
  const starts = new Map<string, number>()
  for (const k of keys) {
    const c = byPath.get(k)!
    const start = snapClamp(c, Number(takeValues[k] ?? base[k] ?? c.current))
    starts.set(k, start)
    spreads.set(k, fourAround(c, start, seed, k))
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
