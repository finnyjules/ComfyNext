// frontend/app/lib/shaderstudio/motion.ts
// Evaluate animation tracks at time t (seconds) and produce a frame-specific
// config. Preview and bake share this path, so they always match. The track math
// mirrors gradientfx/motion.ts; the difference is path-based targeting so any
// numeric leaf (adjustment, focus point, effect param) can animate.

import { cloneConfig, type EasingKind, type MotionTrack, type ShaderStudioConfig } from './types'

/** Fixed-section animatable paths. Effect params are appended dynamically in the UI. */
export const ANIMATABLE: { path: string; label: string; min: number; max: number }[] = [
  { path: 'adjust.exposure', label: 'Exposure', min: -2, max: 2 },
  { path: 'adjust.brightness', label: 'Brightness', min: -1, max: 1 },
  { path: 'adjust.contrast', label: 'Contrast', min: -1, max: 1 },
  { path: 'adjust.saturation', label: 'Saturation', min: -1, max: 1 },
  { path: 'adjust.hue', label: 'Hue', min: -180, max: 180 },
  { path: 'adjust.temperature', label: 'Temperature', min: -1, max: 1 },
  { path: 'post.blur.focusX', label: 'Focus X', min: 0, max: 1 },
  { path: 'post.blur.focusY', label: 'Focus Y', min: 0, max: 1 },
  { path: 'post.blur.maxBlur', label: 'Max blur', min: 0, max: 40 },
  { path: 'post.chromatic.amount', label: 'Chromatic', min: 0, max: 1 },
  { path: 'post.bloom.intensity', label: 'Bloom', min: 0, max: 3 },
]

export function getByPath(obj: any, path: string): number {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

export function setByPath(obj: any, path: string, value: number): void {
  const keys = path.split('.')
  let o = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {}
    o = o[k]
  }
  o[keys[keys.length - 1]!] = value
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v }

function ease(p: number, kind: EasingKind): number {
  const t = clamp01(p)
  switch (kind) {
    case 'pingpong': return 1 - Math.abs(1 - 2 * t)
    case 'easeinout': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    default: return t
  }
}

export function trackValue(track: MotionTrack, t: number, duration: number): number {
  const d = Math.max(0.001, duration)
  const local = (t - (track.delay || 0)) / d
  if (local < 0) return track.from
  const loops = Math.max(1, track.loops || 1)
  const phase = local * loops + (track.cycleOffset || 0)
  let cyc: number
  if (loops <= 1 && track.easing !== 'pingpong') {
    cyc = clamp01(phase)
  } else {
    cyc = phase % 1
    if (cyc < 0) cyc += 1
  }
  const hold = clamp01(track.hold || 0)
  if (hold > 0) {
    const active = 1 - 2 * hold
    cyc = active <= 0 ? 0 : clamp01((cyc - hold) / active)
  }
  return track.from + (track.to - track.from) * ease(cyc, track.easing)
}

/** Clone `cfg` and apply each track's value at its path for time `t` (seconds). */
export function applyMotion(cfg: ShaderStudioConfig, t: number): ShaderStudioConfig {
  if (!cfg.motion?.tracks?.length) return cfg
  const out = cloneConfig(cfg)
  for (const track of cfg.motion.tracks) {
    setByPath(out, track.path, trackValue(track, t, cfg.motion.duration))
  }
  return out
}

/**
 * Return `cfg` with `motion.duration` replaced by the governing clock.
 *
 * `applyMotion` divides by `cfg.motion.duration` internally (above). Feeding it
 * absolute seconds derived from a DIFFERENT clock — an upstream source's — would
 * run every track at the wrong rate: a 6s upstream against a 4s config completes
 * 1.5 ramps instead of the one the spec requires. Always route config through
 * this before calling applyMotion with an upstream-derived time.
 *
 * Lives here (not resolve.ts) because this module stays Vue-free — the shader
 * embed adapter (`~/lib/embed/surfaces/shader.ts`) needs this exact function too,
 * and the embed build may never pull in Vue (resolve.ts transitively does, via
 * frameSource.ts's `ref`).
 */
export function motionConfigFor<T extends { motion: { duration: number } }>(cfg: T, duration: number): T {
  return { ...cfg, motion: { ...cfg.motion, duration } }
}
