/**
 * Vector Type Studio — motion. PURE.
 *
 * Two things happen here, and they are different kinds of thing:
 *
 *   `applyMotion(cfg, t)`                    — the WHOLE config at time t
 *   `glyphTime` / `glyphTransform` / `glyphConfig` — one GLYPH at time t
 *
 * The second exists because the first cannot express stagger. Stagger is
 * per-glyph by definition: glyph *i* must evaluate the very same tracks at its
 * own shifted time, so a single `axes.wght` track becomes a weight wave
 * TRAVELLING across the word rather than the whole word pulsing at once. That
 * is the single most valuable motion this studio offers, and it is why
 * `glyphConfig(cfg, t, i, n)` — not `applyMotion` — is what a renderer loops
 * over when `motion.stagger.delay > 0`.
 *
 * This is Gradient's model, not Shape's. Gradient could animate anything
 * because `f(cfg, t) → pixels` is stateless; Shape's `setConfig` disposes and
 * rebuilds geometry, which capped it at camera and scale. Vector Type is
 * `f(cfg, t) → paths` — no engine, nothing to rebuild — so every declared
 * slider is animatable for free.
 *
 * ## Do not assume anything normalised the config first
 *
 * When Gradient's motion shipped, the plan assumed `ensureConfigDefaults` ran on
 * every load path. It did not — only the editor surface called it, while the
 * node card, the headless bake and the studio frame source all rendered straight
 * from the saved blob. Saved animations would have silently stopped moving.
 *
 * The fix was a fallback INSIDE `applyMotion`, because that is the one choke
 * point every render path crosses. Same rule here, and it is not hypothetical:
 * Task 7 wires a surface, a node card, a `registerStudioBaker` and a
 * `registerStudioFrameSource`, and only the surface will hold a `mergeConfig`-ed
 * ref — the other three read `data.properties.sailor_vectorType` as parsed
 * JSON. So everything below tolerates a missing `motion`, a missing `stagger`,
 * a non-array `tracks`, and a track whose numbers are not numbers.
 *
 * ## NAME COLLISION, on purpose
 *
 * `./render.ts` also exports `glyphTransform`, and it means something else
 * there: where a glyph SITS on the line (placement). This one is what motion
 * ADDS to that placement. A module importing both must alias one — that is a
 * compile error at the import site, not a silent mix-up, which is the trade
 * being made.
 */
// TYPE-ONLY, and it must stay that way — ./font.ts loads fontkit at module
// scope and this module is reached from every node card. Same rule as
// ./controls.ts, for the same reason.
import type { VtAxis } from './font'
import {
  DEFAULT_MOTION,
  DEFAULT_STAGGER,
  VT_STAGGER_ORDERS,
  cloneConfig,
  type VectorTypeConfig,
  type VtMotionTrack,
  type VtStaggerConfig,
  type VtStaggerOrder,
} from './config'
import { VT_CONTROLS, VT_LAYER_PREFIX, derivedAxisControls, visibleVtControls } from './controls'
import { getByPath, setByPath } from '~/lib/studio/path'
import { trackValue } from '~/lib/studio/track'
import { makeListRemap } from '~/lib/studio/listRemap'

export { trackValue } from '~/lib/studio/track'

/** One thing a track can point at, with the range a timeline should offer. */
export interface VtAnimatableTarget {
  /** Dotted path, exactly what `VtMotionTrack.path` stores. */
  path: string
  label: string
  min: number
  max: number
  /** The section it came from, so a picker can group targets like the inspector. */
  group: string
}

/**
 * The per-glyph transform namespace.
 *
 * These are the one set of targets that are NOT config leaves: there is no
 * stored `glyph.dy`, because a per-glyph offset has no meaning outside an
 * animation — it is an output, not state. They are therefore declared here
 * rather than in `VT_CONTROLS` (where every key must resolve against the config,
 * pinned by a test) and read by `glyphTransform`, never by `applyMotion`.
 *
 * `dx`/`dy` are OUTPUT PIXELS, matching `render.ts` (which bakes the y-flip into
 * the coordinates so stroke widths and glyph offsets are in the same units on
 * canvas and in SVG). `rotate` is degrees, `scale` multiplies, `opacity` is 0..1.
 */
export const VT_GLYPH_PREFIX = 'glyph.'

export const VT_GLYPH_TARGETS: readonly VtAnimatableTarget[] = Object.freeze([
  { path: 'glyph.dx', label: 'Glyph · Offset X', min: -400, max: 400, group: 'Glyph' },
  { path: 'glyph.dy', label: 'Glyph · Offset Y', min: -400, max: 400, group: 'Glyph' },
  { path: 'glyph.scale', label: 'Glyph · Scale', min: 0, max: 4, group: 'Glyph' },
  { path: 'glyph.rotate', label: 'Glyph · Rotate', min: -360, max: 360, group: 'Glyph' },
  { path: 'glyph.opacity', label: 'Glyph · Opacity', min: 0, max: 1, group: 'Glyph' },
] as const)

/** What a glyph's motion adds to its placement. Identity when nothing animates it. */
export interface VtGlyphTransform {
  dx: number
  dy: number
  scale: number
  rotate: number
  opacity: number
}

export const IDENTITY_GLYPH_TRANSFORM: Readonly<VtGlyphTransform> =
  Object.freeze({ dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 })

/** `glyph.dy` → `dy`, and nothing else. Built from VT_GLYPH_TARGETS so the two
 *  cannot drift: adding a target here is the only edit a new one needs. */
const GLYPH_FIELD: Record<string, keyof VtGlyphTransform> = Object.fromEntries(
  VT_GLYPH_TARGETS.map(t => [t.path, t.path.slice(VT_GLYPH_PREFIX.length) as keyof VtGlyphTransform]),
)

const isFinite_ = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const finite = (v: unknown, d: number): number => (isFinite_(v) ? v : d)

/**
 * How to rewrite the positional stack paths `animatableTargets` emits below.
 *
 * It lives HERE, beside the loop that builds `appearance.<i>.<leaf>`, because
 * the module that decides a path's shape is the only one that can be trusted to
 * describe it — Shader's scheme needs `mid: 'params'` and a non-empty leaf, and
 * either knob set wrongly matches nothing and silently remaps nothing. The stack
 * UI imports this rather than restating it.
 *
 * Splicing `appearance` without it re-aims every track at whatever slid into the
 * slot, and nothing throws. (See `lib/studio/listRemap.ts` — and its note that
 * stable ids would remove the need for any of this, which is where this should
 * go once motion resolves through `resolveIdPath`.)
 */
export const VT_APPEARANCE_REMAP = makeListRemap({ list: 'appearance' })

/**
 * Every path a track may point at, derived from the SAME declaration the agent,
 * the inspector and Collection sweeps read — `animatable !== false` means
 * animatable, and there is no second list to keep in step.
 *
 * `axes` is the loaded font's axis list, passed in for the reason
 * `vtAgentControls(cfg, axes)` takes it: `loadVariableFont` exposes promises
 * only, with no synchronous cache. Omit it and you get the static targets plus
 * the glyph namespace — the honest answer before a font has loaded, not a
 * hard-coded guess at which axes exist.
 */
export function animatableTargets(cfg: VectorTypeConfig, axes: VtAxis[] = []): VtAnimatableTarget[] {
  const out: VtAnimatableTarget[] = []
  const sliderRange = (c: any) => {
    // An explicit range lets animation reach past what the UI slider allows
    // (Gradient's `layer.shape.sweep` is the precedent).
    const flag = c.animatable
    return flag && typeof flag === 'object' ? flag : { min: c.min, max: c.max }
  }
  const usable = (c: any) => c.kind === 'slider' && c.animatable !== false

  // `visibleVtControls` gates the `layer.*` keys on ONE layer (the active one),
  // which is right for a panel and wrong here: motion must reach every layer.
  // So they are skipped in this loop and expanded per layer below.
  for (const c of [...visibleVtControls(cfg), ...derivedAxisControls(axes)]) {
    if (c.key.startsWith(VT_LAYER_PREFIX) || !usable(c)) continue
    out.push({ path: c.key, label: c.label, group: c.group, ...sliderRange(c) })
  }

  // ═══ TASK 9 BRIDGE ═══ the relative `layer.` prefix expands to one ABSOLUTE
  // path per appearance layer, exactly as `gradientfx/motion.ts` expands its own,
  // with each layer's own `when` predicate applied to it — a stroke width is a
  // target on a stroke layer and on no other.
  //
  // POSITIONAL for now (`appearance.2.width`), because `applyMotion` below
  // resolves through `getByPath`/`setByPath`, which understand positions only; an
  // id-addressed path would silently animate nothing until Task 9 routes motion
  // through `resolveIdPath`. Task 9 also replaces `Layer N` with
  // `gradientfx/layerLabel.ts`-style names derived from what each layer IS.
  const stack = Array.isArray(cfg?.appearance) ? cfg.appearance : []
  for (const c of VT_CONTROLS) {
    if (!c.key.startsWith(VT_LAYER_PREFIX) || !usable(c)) continue
    const rest = c.key.slice(VT_LAYER_PREFIX.length)
    stack.forEach((l, i) => {
      if (c.when && !c.when(cfg, l)) return
      out.push({
        path: `appearance.${i}.${rest}`,
        label: `Layer ${i + 1} · ${c.label}`,
        group: c.group,
        ...sliderRange(c),
      })
    })
  }
  out.push(...VT_GLYPH_TARGETS.map(t => ({ ...t })))
  return out
}

/** The motion block as the evaluator needs it, from a config of any vintage. */
function resolveDuration(cfg: VectorTypeConfig): number {
  return Math.max(0.001, finite(cfg?.motion?.duration, DEFAULT_MOTION.duration))
}

/** Tracks worth evaluating: real path, real numbers. A track that fails this is
 *  skipped rather than defaulted — writing `NaN` into `size` from a half-parsed
 *  blob is worse than not animating. */
function usableTracks(cfg: VectorTypeConfig): VtMotionTrack[] {
  const raw = cfg?.motion?.tracks
  if (!Array.isArray(raw)) return []
  return raw.filter((t): t is VtMotionTrack =>
    !!t && typeof t === 'object'
    && typeof (t as VtMotionTrack).path === 'string' && (t as VtMotionTrack).path.trim() !== ''
    && isFinite_((t as VtMotionTrack).from) && isFinite_((t as VtMotionTrack).to))
}

/**
 * Build a frame-specific config: clone `cfg` and overwrite each animated path
 * with its value at time `t`.
 *
 * CLONES, never mutates — a mutating version would write animation values back
 * into the config the surface is holding, and the next save would persist frame
 * 37 as the user's settings.
 *
 * With nothing to animate it returns `cfg` ITSELF rather than a pointless copy
 * (Gradient does the same), so the result is read-only to callers either way.
 */
export function applyMotion(cfg: VectorTypeConfig, t: number): VectorTypeConfig {
  const tracks = usableTracks(cfg)
  if (!tracks.length) return cfg
  const duration = resolveDuration(cfg)
  const out = cloneConfig(cfg)
  for (const track of tracks) {
    const path = track.path.trim()
    // The per-glyph namespace is `glyphTransform`'s, not the config's. Skipped
    // explicitly rather than relying on the parent guard below, so it stays
    // skipped even if a future config ever grows a real `glyph` field.
    if (path.startsWith(VT_GLYPH_PREFIX)) continue
    // Guard on the PARENT container, not the leaf: `axes` is SPARSE by design,
    // so `axes.wght` legitimately has no leaf until something writes one. What
    // must not happen is fabricating structure — `setByPath` creates missing
    // containers, so a typo'd path would silently grow junk into the config and
    // then get SAVED. An absent or non-object parent is skipped.
    const lastDot = path.lastIndexOf('.')
    const parentPath = lastDot === -1 ? '' : path.slice(0, lastDot)
    const parent = parentPath ? getByPath(out, parentPath) : out
    if (typeof parent !== 'object' || parent === null) continue
    setByPath(out, path, trackValue(track, t, duration))
  }
  return out
}

// ── Per-glyph stagger ───────────────────────────────────────────────────────

/** The stagger block, defaulted field by field. The choke-point fallback: this
 *  is what makes a raw stored blob (or a `motion` written by an older version
 *  that had no stagger at all) behave as "no stagger" rather than throw. */
export function resolveStagger(cfg: VectorTypeConfig): VtStaggerConfig {
  const s = cfg?.motion?.stagger as Partial<VtStaggerConfig> | undefined
  const order = s?.order
  return {
    delay: Math.max(0, finite(s?.delay, DEFAULT_STAGGER.delay)),
    order: (VT_STAGGER_ORDERS as readonly string[]).includes(order as string)
      ? (order as VtStaggerOrder)
      : DEFAULT_STAGGER.order,
    seed: finite(s?.seed, DEFAULT_STAGGER.seed),
  }
}

/**
 * A 32-bit avalanche hash of (index, seed). Integer maths only — no floats, no
 * `Math.random()`, no module-level mutable RNG state — so the same inputs give
 * the same bits in the browser preview, the headless bake and the SVG export.
 */
function hash32(index: number, seed: number): number {
  let h = (index | 0) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad)
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97)
  return (h ^ (h >>> 15)) >>> 0
}

// The shuffled ranks depend only on (count, seed), and within a frame both are
// constant — so a single-entry memo removes the per-glyph re-sort without
// needing a cache-eviction policy.
let shuffleMemo: { key: string; ranks: number[] } | null = null

/** Position of each glyph in the shuffled queue. Deterministic in (count, seed). */
function shuffledRanks(count: number, seed: number): number[] {
  const key = `${count}:${seed}`
  if (shuffleMemo && shuffleMemo.key === key) return shuffleMemo.ranks
  const order = Array.from({ length: count }, (_, i) => i)
  // Tie-broken by index so two colliding hashes still give one stable order.
  order.sort((a, b) => (hash32(a, seed) - hash32(b, seed)) || (a - b))
  const ranks = new Array<number>(count)
  order.forEach((glyph, position) => { ranks[glyph] = position })
  shuffleMemo = { key, ranks }
  return ranks
}

/**
 * Where glyph `index` sits in the queue, 0 = first to move.
 *
 * Every order leads at 0 and spans to (roughly) count-1, so switching order
 * changes WHO leads without changing how long the run takes. `center`/`edges`
 * use TWICE the distance from the midpoint for exactly that reason — the plain
 * distance halves the span and makes those two quietly faster than the others —
 * and `center` subtracts the even-count offset so its leaders still start at 0
 * rather than the whole word lagging by one delay.
 *
 * All five orders return integers: `2·|i − (n−1)/2|` is odd for even `n` and
 * even for odd `n`, never fractional.
 */
export function staggerRank(order: VtStaggerOrder, index: number, count: number, seed = 0): number {
  const n = Math.max(1, Math.floor(count))
  const i = Math.min(n - 1, Math.max(0, Math.floor(index)))
  const mid = (n - 1) / 2
  const spread = 2 * Math.abs(i - mid)
  switch (order) {
    case 'reverse': return (n - 1) - i
    case 'center': return spread - (n % 2 === 0 ? 1 : 0)
    case 'edges': return (n - 1) - spread
    case 'random': return shuffledRanks(n, Math.round(seed) | 0)[i] ?? 0
    default: return i
  }
}

/**
 * The time glyph `index` of `count` reads the tracks at.
 *
 * Later glyphs read an EARLIER time (t − rank·delay), which is what makes the
 * motion appear to travel forwards through the word: glyph 3 is showing what
 * glyph 0 showed three delays ago.
 */
export function glyphTime(cfg: VectorTypeConfig, t: number, index: number, count: number): number {
  const { delay, order, seed } = resolveStagger(cfg)
  if (!(delay > 0) || count <= 1) return t
  return t - delay * staggerRank(order, index, count, seed)
}

/**
 * The config as glyph `index` sees it at time `t` — `applyMotion` on that
 * glyph's own clock.
 *
 * This is the function a renderer loops over. With `delay === 0`, `glyphTime`
 * returns `t` for every glyph and this collapses to one shared `applyMotion`
 * result, so a renderer may (and should) hoist it out of the loop then.
 */
export function glyphConfig(cfg: VectorTypeConfig, t: number, index: number, count: number): VectorTypeConfig {
  return applyMotion(cfg, glyphTime(cfg, t, index, count))
}

/**
 * The per-glyph transform at time `t`: tracks in the `glyph.` namespace,
 * evaluated on that glyph's own clock. Identity when none are declared.
 *
 * Composes with placement rather than replacing it — `render.ts`'s
 * `glyphTransform` says where the glyph sits, this says what motion adds.
 */
export function glyphTransform(
  cfg: VectorTypeConfig,
  t: number,
  index: number,
  count: number,
): VtGlyphTransform {
  const tracks = usableTracks(cfg)
  const out: VtGlyphTransform = { ...IDENTITY_GLYPH_TRANSFORM }
  if (!tracks.length) return out
  const gt = glyphTime(cfg, t, index, count)
  const duration = resolveDuration(cfg)
  for (const track of tracks) {
    const field = GLYPH_FIELD[track.path.trim()]
    if (!field) continue
    out[field] = trackValue(track, gt, duration)
  }
  return out
}
