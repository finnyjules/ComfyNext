// Motion: evaluate animation tracks at a given time and produce a config whose
// animated params are overridden for that frame. The renderer then draws the
// frame normally — preview and bake share this path, so they always match.

import { cloneConfig, type EasingKind, type GradientConfig, type MotionTrack } from './types'
import { visibleGradientControls } from './controls'
import { getByPath, setByPath } from '~/lib/studio/path'

export interface AnimatableTarget { path: string; label: string; min: number; max: number }

/**
 * Motion targets derived from GRADIENT_CONTROLS rather than hand-listed.
 * Layer-relative keys (`layer.shape.count`) expand to one absolute path per
 * layer (`layers.0.shape.count`, ...), mirroring how ShaderStudioSurface builds
 * `animatablePaths` from its effect manifest.
 */
export function animatableTargets(cfg: GradientConfig): AnimatableTarget[] {
  const out: AnimatableTarget[] = []
  for (const c of visibleGradientControls(cfg)) {
    if (c.kind !== 'slider') continue
    const flag = (c as any).animatable
    if (flag === false) continue
    const range = flag && typeof flag === 'object' ? flag : { min: c.min, max: c.max }
    if (c.key.startsWith('layer.')) {
      const rest = c.key.slice('layer.'.length)
      cfg.layers.forEach((_l, i) => {
        out.push({ path: `layers.${i}.${rest}`, label: `Layer ${i + 1} · ${c.label}`, ...range })
      })
    } else {
      out.push({ path: c.key, label: c.label, ...range })
    }
  }
  return out
}

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
    // Legacy {layer, param} tracks reach this function un-migrated: ensureConfigDefaults
    // only runs on the editor-open path, while the node card, the headless bake and the
    // studio frame source all render straight from the saved blob. Resolving the legacy
    // shape here keeps saved animations working on every path.
    const path = track.path ?? (
      typeof track.layer === 'number' && typeof track.param === 'string'
        ? `layers.${track.layer}.shape.${track.param}`
        : undefined
    )
    if (!path) continue
    // Guard on the PARENT container existing, not the leaf — some animatable
    // params (e.g. flow.swirl) are optional and not backfilled by
    // ensureConfigDefaults, so a valid target may genuinely have no leaf yet.
    // We still must not fabricate structure the renderer would read as real
    // config, so an absent/non-object parent (e.g. `layers.5.shape.count` on
    // a shorter config, or a bogus path) is skipped.
    const lastDot = path.lastIndexOf('.')
    const parentPath = lastDot === -1 ? '' : path.slice(0, lastDot)
    const parent = parentPath ? getByPath(out, parentPath) : out
    if (typeof parent !== 'object' || parent === null) continue
    setByPath(out, path, trackValue(track, t, cfg.motion.duration))
  }
  return out
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const LAYER_RE = /^layers\.(\d+)\./

const layerIndexOf = (path: string | undefined): number | null => {
  const m = LAYER_RE.exec(path ?? '')
  return m ? Number(m[1]) : null
}

const withLayerIndex = (path: string, i: number): string => path.replace(LAYER_RE, `layers.${i}.`)

/** Return tracks with `path`'s `layers.N.` segment rewritten to follow a layer moved from `from` to `to`. */
export function remapTracksOnReorder(tracks: MotionTrack[], from: number, to: number): MotionTrack[] {
  return tracks.map((tr) => {
    const i = layerIndexOf(tr.path)
    if (i === null) return tr
    let next = i
    if (i === from) next = to
    else if (from < i && i <= to) next = i - 1
    else if (to <= i && i < from) next = i + 1
    return next === i ? tr : { ...tr, path: withLayerIndex(tr.path!, next) }
  })
}

/** Return tracks with those on `removed` dropped and higher `layers.N.` indices decremented. */
export function dropTracksForLayer(tracks: MotionTrack[], removed: number): MotionTrack[] {
  const out: MotionTrack[] = []
  for (const tr of tracks) {
    const i = layerIndexOf(tr.path)
    if (i === null) { out.push(tr); continue }
    if (i === removed) continue
    out.push(i > removed ? { ...tr, path: withLayerIndex(tr.path!, i - 1) } : tr)
  }
  return out
}

/** Shift track paths up one layer when a new layer is inserted at `at`. */
export function remapTracksOnInsert(tracks: MotionTrack[], at: number): MotionTrack[] {
  return tracks.map((tr) => {
    const i = layerIndexOf(tr.path)
    if (i === null || i < at) return tr
    return { ...tr, path: withLayerIndex(tr.path!, i + 1) }
  })
}
