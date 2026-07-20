// Motion: evaluate animation tracks at a given time and produce a config whose
// animated params are overridden for that frame. The renderer then draws the
// frame normally — preview and bake share this path, so they always match.

import { cloneConfig, type EasingKind, type GradientConfig, type MotionTrack } from './types'

/** Animatable per-layer shape params (label → ShapeConfig key). */
export const ANIMATABLE: { key: string; label: string; min: number; max: number }[] = [
  { key: 'phase', label: 'Wave phase', min: 0, max: 1 },
  { key: 'scrub', label: 'Scrub / rotate', min: 0, max: 1 },
  { key: 'peaks', label: 'Peaks', min: 1, max: 12 },
  { key: 'count', label: 'Count', min: 2, max: 64 },
  { key: 'minDepth', label: 'Min depth', min: 0, max: 1 },
  { key: 'curveExp', label: 'Curve exponent', min: 0.2, max: 3 },
  { key: 'jitter', label: 'Jitter', min: 0, max: 1 },
  { key: 'sweep', label: 'Sweep', min: 0, max: 360 },
  { key: 'gap', label: 'Gap', min: 0, max: 1 },
  { key: 'rounding', label: 'Rounding', min: 0, max: 1 },
  { key: 'valley', label: 'Valley position', min: 0, max: 1 },
]

function ease(p: number, kind: EasingKind): number {
  const t = clamp01(p)
  switch (kind) {
    case 'pingpong': return 1 - Math.abs(1 - 2 * t) // 0→1→0
    case 'easeinout': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    default: return t
  }
}

/**
 * Normalized progress (0..1) of a track at time `t` seconds within a clip of
 * `duration` seconds. Honors loops, delay, cycle offset, and hold-at-extremes.
 */
export function trackValue(track: MotionTrack, t: number, duration: number): number {
  const d = Math.max(0.001, duration)
  const local = (t - (track.delay || 0)) / d
  if (local < 0) return track.from
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
  const e = ease(cyc, track.easing)
  return track.from + (track.to - track.from) * e
}

/** Build a frame-specific config: clone `cfg` and apply each track's value. */
export function applyMotion(cfg: GradientConfig, t: number): GradientConfig {
  if (!cfg.motion?.tracks?.length) return cfg
  const out = cloneConfig(cfg)
  for (const track of cfg.motion.tracks) {
    const layer = out.layers[track.layer]
    if (!layer) continue
    const v = trackValue(track, t, cfg.motion.duration)
    ;(layer.shape as unknown as Record<string, number>)[track.param] = v
  }
  return out
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Mutate tracks so `track.layer` follows a layer moved from index `from` to `to`. */
export function remapTracksOnReorder(tracks: MotionTrack[], from: number, to: number): void {
  const move = (l: number): number => {
    if (l === from) return to
    if (from < to && l > from && l <= to) return l - 1
    if (from > to && l >= to && l < from) return l + 1
    return l
  }
  for (const t of tracks) t.layer = move(t.layer)
}

/** Return tracks with those on `removed` dropped and higher indices decremented. */
export function dropTracksForLayer(tracks: MotionTrack[], removed: number): MotionTrack[] {
  return tracks.filter(t => t.layer !== removed).map(t => ({ ...t, layer: t.layer > removed ? t.layer - 1 : t.layer }))
}
