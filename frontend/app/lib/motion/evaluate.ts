// frontend/app/lib/motion/evaluate.ts
/**
 * Pure time-evaluation of layer animations. No DOM, no GSAP, no randomness —
 * same (animation, t) in, same state out, which is what makes preview, bake,
 * and golden tests agree.
 *
 * Spatial units: UnitState dx/dy are in UNIT-BOX HEIGHTS (1 = the height of
 * the animated unit's own box — a char cell for text units, the layer bbox
 * for whole-layer animation). The painter multiplies into px. This keeps
 * preset "distances" proportional at any canvas size, mirroring how the GSAP
 * presets' px offsets relate to their preview font size.
 */
import type { LayerAnimation, LayerAnimSpec, LayerKeyframe, FrameMotion } from './types'
import { resolveEase, easeInOutQuad, linear } from './easing'

export interface UnitState {
  dx: number; dy: number          // unit-box heights
  scale: number                   // multiplicative
  rotation: number                // degrees, additive
  opacity: number                 // 0..1 multiplicative
  /** Clip the unit's box: fraction hidden from one side (mask presets). */
  clip?: { side: 'top' | 'bottom' | 'left' | 'right'; amount: number }
}

export interface LayerMotionState {
  visible: boolean
  /** Whole-layer transform from keyframes (canvas-normalized dx, dy). */
  layer: UnitState
  /** Per-unit states (chars for text; single entry for other kinds). */
  units?: UnitState[]
}

export const IDENTITY_UNIT: UnitState = Object.freeze({ dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 })
const HIDDEN: LayerMotionState = Object.freeze({ visible: false, layer: IDENTITY_UNIT })

// Deterministic per-unit pseudo-random in [0,1) (replaces Math.random()).
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

export function layerWindow(
  anim: Pick<LayerAnimation, 'offset' | 'duration'>,
  motion: FrameMotion,
): { start: number; end: number } {
  const start = Math.max(0, anim.offset)
  const end = anim.duration == null
    ? motion.duration
    : Math.min(motion.duration, start + Math.max(0, anim.duration))
  return { start, end }
}

// ── Per-preset unit evaluation ───────────────────────────────────────────────
// IN: e is the eased progress 0→1 (0 = fully out, 1 = at rest).
// OUT: e is the eased progress 0→1 (0 = at rest, 1 = fully gone).
// LOOP: fn(phase, i) with phase = ((tIn - i·stagger) / duration) mod 1.

type UnitEval = (e: number, i: number, n: number) => UnitState
const u = (p: Partial<UnitState>): UnitState => ({ ...IDENTITY_UNIT, ...p })

const IN_EVAL: Record<string, { fn: UnitEval; ease: string }> = {
  'appear':       { ease: 'none',            fn: e => u({ opacity: e > 0 ? 1 : 0 }) },
  'fade-in':      { ease: 'power2.out',      fn: e => u({ opacity: e }) },
  'slide-up':     { ease: 'power2.out',      fn: e => u({ dy: (1 - e) * 0.5, opacity: e }) },
  'slide-down':   { ease: 'power2.out',      fn: e => u({ dy: -(1 - e) * 0.5, opacity: e }) },
  'slide-left':   { ease: 'power2.out',      fn: e => u({ dx: (1 - e) * 0.5, opacity: e }) },
  'slide-right':  { ease: 'power2.out',      fn: e => u({ dx: -(1 - e) * 0.5, opacity: e }) },
  'mask-up':      { ease: 'power3.out',      fn: e => u({ dy: (1 - e) * 0.25, clip: { side: 'top', amount: 1 - e } }) },
  'mask-down':    { ease: 'power3.out',      fn: e => u({ dy: -(1 - e) * 0.25, clip: { side: 'bottom', amount: 1 - e } }) },
  'grow-in':      { ease: 'back.out(1.7)',   fn: e => u({ scale: Math.max(0.001, e), opacity: Math.min(1, e * 2) }) },
  'shrink-in':    { ease: 'power3.out',      fn: e => u({ scale: 2.5 - 1.5 * e, opacity: e }) },
  'spin-in':      { ease: 'back.out(1.4)',   fn: e => u({ rotation: (1 - e) * 180, scale: Math.max(0.001, e), opacity: e }) },
  'elastic-drop': { ease: 'elastic.out(1, 0.3)', fn: e => u({ dy: -(1 - e) * 1.0, opacity: 1 }) },
  'typewriter':   { ease: 'none',            fn: e => u({ opacity: e > 0.01 ? 1 : 0 }) },
  'glitch-in':    { ease: 'steps(6)',        fn: (e, i) => u({
    dx: (seeded(i, 1) - 0.5) * 0.75 * (1 - e),
    dy: (seeded(i, 2) - 0.5) * 0.4 * (1 - e),
    opacity: e > 0 ? 1 : 0,
  }) },
}

const OUT_EVAL: Record<string, { fn: UnitEval; ease: string }> = {
  'disappear':       { ease: 'none',          fn: e => u({ opacity: e > 0 ? 0 : 1 }) },
  'fade-out':        { ease: 'power2.in',     fn: e => u({ opacity: 1 - e }) },
  'slide-out-up':    { ease: 'power2.in',     fn: e => u({ dy: -e * 0.5, opacity: 1 - e }) },
  'slide-out-down':  { ease: 'power2.in',     fn: e => u({ dy: e * 0.5, opacity: 1 - e }) },
  'slide-out-left':  { ease: 'power2.in',     fn: e => u({ dx: -e * 0.5, opacity: 1 - e }) },
  'slide-out-right': { ease: 'power2.in',     fn: e => u({ dx: e * 0.5, opacity: 1 - e }) },
  'mask-out-up':     { ease: 'power3.in',     fn: e => u({ dy: -e * 0.25, clip: { side: 'bottom', amount: e } }) },
  'mask-out-down':   { ease: 'power3.in',     fn: e => u({ dy: e * 0.25, clip: { side: 'top', amount: e } }) },
  'shrink-out':      { ease: 'back.in(1.7)',  fn: e => u({ scale: Math.max(0.001, 1 - e), opacity: 1 - e }) },
  'grow-out':        { ease: 'power3.in',     fn: e => u({ scale: 1 + 1.5 * e, opacity: 1 - e }) },
  'spin-out':        { ease: 'power3.in',     fn: e => u({ rotation: e * 180, scale: Math.max(0.001, 1 - e), opacity: 1 - e }) },
  'elastic-launch':  { ease: 'back.in(2)',    fn: e => u({ dy: -e * 1.0, opacity: 1 - e }) },
  'typewriter-out':  { ease: 'none',          fn: (_e, _i, _n) => u({ opacity: _e > 0.01 ? 0 : 1 }) },
  'glitch-out':      { ease: 'steps(6)',      fn: (e, i) => u({
    dx: (seeded(i, 3) - 0.5) * 0.75 * e,
    dy: (seeded(i, 4) - 0.5) * 0.4 * e,
    opacity: 1 - e,
  }) },
}

// Loop: fn(phase 0..1, i) — periodic by construction (sin/cos of 2π·phase).
type LoopEval = (phase: number, i: number, n: number) => UnitState
const TWO_PI = Math.PI * 2
const LOOP_EVAL: Record<string, LoopEval> = {
  'wave':      (p) => u({ dy: -0.25 * Math.sin(p * TWO_PI) }),
  'float':     (p) => u({ dy: -0.1 * Math.sin(p * TWO_PI), dx: 0.04 * Math.sin(p * TWO_PI + 1) }),
  'sway':      (p) => u({ rotation: 8 * Math.sin(p * TWO_PI) }),
  'breathe':   (p) => u({ scale: 1 + 0.06 * Math.sin(p * TWO_PI) }),
  'throb':     (p) => u({ scale: 1 + 0.2 * Math.max(0, Math.sin(p * TWO_PI)) }),
  'spin-loop': (p) => u({ rotation: p * 360 }),
  'rock':      (p) => u({ rotation: 12 * Math.sin(p * TWO_PI) }),
  'glitch-loop': (p, i) => {
    const tick = Math.floor(p * 12)
    return u({ dx: (seeded(i * 131 + tick, 5) - 0.5) * 0.12, dy: (seeded(i * 131 + tick, 6) - 0.5) * 0.06 })
  },
  'marquee':   (p) => u({ dx: (1 - 2 * p) * 2 }), // +2 → −2 unit-box sweep, painter scales by layer width
}

export const SUPPORTED_IN_IDS = Object.keys(IN_EVAL)
export const SUPPORTED_OUT_IDS = Object.keys(OUT_EVAL)
export const SUPPORTED_LOOP_IDS = Object.keys(LOOP_EVAL)

// ── Stagger window: unit i animates inside [i·stagger, i·stagger + unitDur] ──
const MIN_UNIT_DUR = 0.05

/** Stagger compressed so every unit completes within the phase duration:
 *  the last unit's window must start no later than duration - MIN_UNIT_DUR. */
function effectiveStagger(spec: LayerAnimSpec, n: number): number {
  const raw = Math.max(0, spec.stagger ?? 0.04)          // negative stagger unsupported (M2)
  if (n <= 1) return 0
  return Math.min(raw, Math.max(0, spec.duration - MIN_UNIT_DUR) / (n - 1))
}

function unitProgress(tPhase: number, spec: LayerAnimSpec, i: number, n: number): number {
  const stagger = effectiveStagger(spec, n)
  const span = (n - 1) * stagger
  const unitDur = Math.max(MIN_UNIT_DUR, spec.duration - span)
  const start = i * stagger
  return Math.max(0, Math.min(1, (tPhase - start) / unitDur))
}

function evalSpecUnits(
  spec: LayerAnimSpec,
  tPhase: number,
  n: number,
  table: Record<string, { fn: UnitEval; ease: string }>,
  fallback: { fn: UnitEval; ease: string },
): UnitState[] {
  const entry = table[spec.presetId] ?? fallback
  const ease = resolveEase(spec.ease ?? entry.ease)
  return Array.from({ length: n }, (_, i) => entry.fn(ease(unitProgress(tPhase, spec, i, n)), i, n))
}

export function evaluateKeyframes(kfs: LayerKeyframe[], t: number): UnitState {
  if (!kfs.length) return IDENTITY_UNIT
  const sorted = [...kfs].sort((a, b) => a.t - b.t)
  const fill = (k: LayerKeyframe): Required<Omit<LayerKeyframe, 'ease'>> => ({
    t: k.t, dx: k.dx ?? 0, dy: k.dy ?? 0, scale: k.scale ?? 1,
    rotation: k.rotation ?? 0, opacity: k.opacity ?? 1,
  })
  if (t <= sorted[0].t) { const k = fill(sorted[0]); return u({ dx: k.dx, dy: k.dy, scale: k.scale, rotation: k.rotation, opacity: k.opacity }) }
  const last = sorted[sorted.length - 1]
  if (t >= last.t) { const k = fill(last); return u({ dx: k.dx, dy: k.dy, scale: k.scale, rotation: k.rotation, opacity: k.opacity }) }
  let lo = sorted[0], hi = sorted[1]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].t >= t) { lo = sorted[i - 1]; hi = sorted[i]; break }
  }
  const a = fill(lo), b = fill(hi)
  const span = Math.max(1e-6, b.t - a.t)
  const easeFn = (lo.ease ?? 'easeInOut') === 'linear' ? linear : easeInOutQuad
  const p = easeFn((t - a.t) / span)
  const lerp = (x: number, y: number) => x + (y - x) * p
  return u({
    dx: lerp(a.dx, b.dx), dy: lerp(a.dy, b.dy), scale: lerp(a.scale, b.scale),
    rotation: lerp(a.rotation, b.rotation), opacity: lerp(a.opacity, b.opacity),
  })
}

/**
 * Evaluate a layer's animation at absolute frame-time `t` (seconds).
 * `n` = number of animatable units (char count for text; 1 otherwise).
 */
export function evaluateAnimation(
  anim: LayerAnimation,
  t: number,
  motion: FrameMotion,
  n: number,
): LayerMotionState {
  const { start, end } = layerWindow(anim, motion)
  if (t < start || t >= end) return HIDDEN
  const tIn = t - start
  const layer = anim.keyframes?.length ? evaluateKeyframes(anim.keyframes, tIn) : IDENTITY_UNIT

  const W = end - start
  const inDur = anim.in ? Math.max(0.01, anim.in.duration) : 0
  const outDur = anim.out ? Math.max(0.01, anim.out.duration) : 0
  // Out is anchored to the window end but never overlaps in: when the two
  // would collide, out starts where in ends and compresses into what's left.
  const outStart = Math.max(inDur, W - outDur)

  let units: UnitState[] | undefined
  if (anim.in && tIn < inDur) {
    units = evalSpecUnits(anim.in, tIn, n, IN_EVAL, IN_EVAL['fade-in'])
  } else if (anim.out && tIn >= outStart && W > inDur) {
    const effOut = { ...anim.out, duration: Math.max(0.01, W - outStart) }
    units = evalSpecUnits(effOut, tIn - outStart, n, OUT_EVAL, OUT_EVAL['fade-out'])
  } else if (anim.loop) {
    const cycle = Math.max(0.1, anim.loop.duration)
    const stagger = Math.max(0, anim.loop.stagger ?? 0.04)
    const loopFn = LOOP_EVAL[anim.loop.presetId]
    if (loopFn) {
      const loopT = tIn - inDur   // phase 0 at loop start ⇒ seamless in→loop handoff
      units = Array.from({ length: n }, (_, i) => {
        const phase = (((loopT - i * stagger) / cycle) % 1 + 1) % 1
        return loopFn(phase, i, n)
      })
    }
  }
  if (!units) units = Array.from({ length: n }, () => IDENTITY_UNIT)
  return { visible: true, layer, units }
}
