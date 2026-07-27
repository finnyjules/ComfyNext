// Motion: evaluate animation tracks at a given time and produce a config whose
// animated params are overridden for that frame. The renderer then draws the
// frame normally — preview and bake share this path, so they always match.

import { cloneConfig, type GradientConfig, type MotionTrack } from './types'
import { visibleGradientControls } from './controls'
import { layerLabels } from './layerLabel'
import { getByPath, setByPath } from '~/lib/studio/path'
import { trackValue } from '~/lib/studio/track'

// The easing engine moved to ~/lib/studio/track so a second stateless studio
// (Vector Type) could reuse it without importing this module — and through it
// ./types, which value-imports the mesh generator. Re-exported here because
// `trackValue` was this module's published surface first.
export { trackValue } from '~/lib/studio/track'

export interface AnimatableTarget { path: string; label: string; min: number; max: number }

/**
 * Motion targets derived from GRADIENT_CONTROLS rather than hand-listed.
 * Layer-relative keys (`layer.shape.count`) expand to one absolute path per
 * layer (`layers.0.shape.count`, ...), mirroring how ShaderStudioSurface builds
 * `animatablePaths` from its effect manifest.
 */
export function animatableTargets(cfg: GradientConfig): AnimatableTarget[] {
  const out: AnimatableTarget[] = []
  // Name layers by what they ARE ("Wave · Count"), not where they sit. A positional
  // name renumbers on reorder, which made a track that had correctly followed its
  // layer look like it had jumped to a different one.
  const names = layerLabels(cfg)
  for (const c of visibleGradientControls(cfg)) {
    if (c.kind !== 'slider') continue
    const flag = (c as any).animatable
    if (flag === false) continue
    const range = flag && typeof flag === 'object' ? flag : { min: c.min, max: c.max }
    if (c.key.startsWith('layer.')) {
      const rest = c.key.slice('layer.'.length)
      cfg.layers.forEach((_l, i) => {
        out.push({ path: `layers.${i}.${rest}`, label: `${names[i] ?? `Layer ${i + 1}`} · ${c.label}`, ...range })
      })
    } else {
      out.push({ path: c.key, label: c.label, ...range })
    }
  }
  return out
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
