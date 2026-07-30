/**
 * Shared motion-track evaluation for studio configs.
 *
 * One easing engine, one progress model. Extracted from `gradientfx/motion.ts`
 * (which still re-exports `trackValue`, so its callers are unchanged) so a
 * second stateless studio can reuse it without importing Gradient's *renderer*
 * — `gradientfx/motion` pulls in `gradientfx/types`, which value-imports
 * `defaultMesh`, which would drag mesh generation into every node card that
 * only wanted an easing curve.
 *
 * This module is deliberately config-agnostic: it knows about a track's TIMING,
 * nothing about what the track points at. Path resolution lives in ./path.ts and
 * the per-studio `applyMotion`.
 */

/** The three curves every studio's timeline offers. */
export type TrackEasing = 'linear' | 'pingpong' | 'easeinout'

/**
 * The timing fields `trackValue` actually reads. Structural on purpose: both
 * `gradientfx`'s `MotionTrack` and `vectortype`'s `VtMotionTrack` are assignable
 * to it, so neither has to depend on the other's config module.
 */
export interface TrackTiming {
  from: number
  to: number
  easing: TrackEasing
  /** Cycles within the clip; >= 1. */
  loops: number
  /** Hold at extremes, 0..0.5. */
  hold: number
  /** Phase offset into the cycle, 0..1. */
  cycleOffset: number
  /** Start delay, seconds. */
  delay: number
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function ease(p: number, kind: TrackEasing): number {
  const t = clamp01(p)
  switch (kind) {
    case 'pingpong': return 1 - Math.abs(1 - 2 * t) // 0→1→0
    case 'easeinout': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    default: return t
  }
}

/**
 * The EASED PROGRESS of a track at time `t`, 0..1 — everything `trackValue`
 * knows about timing, with nothing said about what is being interpolated.
 *
 * Split out so a track can drive something that is not a number. `from`/`to` are
 * numbers and always will be (`TrackTiming` is the shape three studios' configs
 * are structurally assignable to, and widening it would be a breaking change to
 * all of them), so a COLOUR track cannot express its endpoints there — it stores
 * its own pair and asks this for the 0..1 to mix at. See
 * `lib/vectortype/motion.ts`'s `trackColor`.
 *
 * ADDITIVE, deliberately: `trackValue` below is now one line of arithmetic over
 * this function and returns the same numbers, so its downstream consumers —
 * Gradient Studio (`gradientfx/motion.ts`) and Scene3D (`scene3d/motion/apply.ts`),
 * plus Vector Type's own blink / scatter / preset evaluators — are untouched.
 * (Shader Studio is NOT downstream: `shaderstudio/motion.ts` still carries its own
 * copy of this arithmetic. Worth knowing before "the shared engine" is assumed to
 * mean all four.) The one behavioural nuance: a not-yet-started track used to
 * return `track.from` and now returns `from + (to − from)·0`, which differs only
 * in the sign of zero.
 *
 * This function reads NEITHER `from` NOR `to`, including on the not-yet-started
 * branch, so a track with no meaningful numeric range still gets correct timing.
 *
 * Honors loops, delay, cycle offset, and hold-at-extremes.
 */
export function trackProgress(track: TrackTiming, t: number, duration: number): number {
  const d = Math.max(0.001, duration)
  const local = (t - (track.delay || 0)) / d
  if (local < 0) return 0
  const loops = Math.max(1, track.loops || 1)
  const phase = local * loops + (track.cycleOffset || 0)
  // A single non-pingpong play holds at its end value; looping / pingpong wrap so
  // the clip is seamless (frame 0 == frame N).
  let cyc: number
  if (loops <= 1 && track.easing !== 'pingpong') {
    cyc = clamp01(phase)
  } else {
    cyc = phase % 1
    if (cyc < 0) cyc += 1
  }
  // Hold at extremes: clamp the active window, pinning the ends.
  const hold = clamp01(track.hold || 0)
  if (hold > 0) {
    const active = 1 - 2 * hold
    cyc = active <= 0 ? 0 : clamp01((cyc - hold) / active)
  }
  return ease(cyc, track.easing)
}

/**
 * Normalized progress (0..1) of a track at time `t` seconds within a clip of
 * `duration` seconds, mapped onto the track's `from`..`to`. Honors loops, delay,
 * cycle offset, and hold-at-extremes.
 */
export function trackValue(track: TrackTiming, t: number, duration: number): number {
  return track.from + (track.to - track.from) * trackProgress(track, t, duration)
}
