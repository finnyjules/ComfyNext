// Motion: evaluate animation tracks at a given time and produce a config whose
// animated params are overridden for that frame. The renderer then draws the
// frame normally — preview and bake share this path, so they always match.

import { cloneConfig, resolveTrackPath, type GradientConfig, type MotionTrack } from './types'
import { visibleGradientControls } from './controls'
import { layerLabels } from './layerLabel'
import { getByPath, setByPath } from '~/lib/studio/path'
import { makeListRemap } from '~/lib/studio/listRemap'
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
    } else if (c.key.startsWith('post.')) {
      // Post params reuse generic labels across effects ("Amount", "Radius" —
      // see manifest.ts: chroma/blur/grain/vignette all have an "Amount"), so
      // without the effect name a motion track dropdown would show several
      // indistinguishable "Amount" entries. Same "X · Y" disambiguation as the
      // per-layer case above, keyed off the control's own section (c.group is
      // the effect's label — see postControls()).
      out.push({ path: c.key, label: `${c.group} · ${c.label}`, ...range })
    } else {
      out.push({ path: c.key, label: c.label, ...range })
    }
  }
  return out
}

/**
 * Return `cfg` with `motion.duration` replaced by the governing clock.
 *
 * `applyMotion` divides by `cfg.motion.duration` internally (below), and
 * renderer.ts's flow-churn loop phase keys off the same field. Feeding either
 * of them absolute seconds derived from a DIFFERENT clock — an embed export's
 * own duration, say — would run every track (and the churn loop) at the wrong
 * rate: a 6s export duration against a 4s config completes 1.5 ramps instead
 * of the one loop the export is supposed to close. Always route a config
 * through this before rendering it against a time value that came from a
 * clock other than its own `motion.duration`.
 *
 * Mirrors `~/lib/shaderstudio/motion.ts`'s `motionConfigFor` exactly — the
 * gradient embed adapter (`~/lib/embed/surfaces/gradient.ts`) needs this same
 * guard, and this module stays Vue-free (unlike ./frameSource.ts) so it is
 * safe for the embed bundle to import.
 */
export function motionConfigFor<T extends { motion: { duration: number } }>(cfg: T, duration: number): T {
  return { ...cfg, motion: { ...cfg.motion, duration } }
}

/** Build a frame-specific config: clone `cfg` and apply each track's value. */
export function applyMotion(cfg: GradientConfig, t: number): GradientConfig {
  if (!cfg.motion?.tracks?.length) return cfg
  const out = cloneConfig(cfg)
  for (const track of cfg.motion.tracks) {
    // Legacy tracks ({layer, param}, and pre-post-stack `relief.grain`) reach this
    // function un-migrated: ensureConfigDefaults only runs on the editor-open path,
    // while the node card, the headless bake and the studio frame source all render
    // straight from the saved blob. Resolving them through the SAME function the
    // migration uses keeps saved animations working on every path, and keeps a
    // migrated document from having its retired fields re-created frame by frame —
    // see resolveTrackPath's doc.
    const path = resolveTrackPath(track, cfg)
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

// The three remap functions below moved to ~/lib/studio/listRemap so Shader
// Studio — which had copy-pasted all three inline — and the Vector Type
// appearance stack could share one tested implementation. Re-exported here
// under their original names because this module was their published surface
// first; Gradient's call sites and spec are unchanged.
const LAYER_REMAP = makeListRemap({ list: 'layers' })

/** Return tracks with `path`'s `layers.N.` segment rewritten to follow a layer moved from `from` to `to`. */
export function remapTracksOnReorder(tracks: MotionTrack[], from: number, to: number): MotionTrack[] {
  return LAYER_REMAP.onReorder(tracks, from, to)
}

/** Return tracks with those on `removed` dropped and higher `layers.N.` indices decremented. */
export function dropTracksForLayer(tracks: MotionTrack[], removed: number): MotionTrack[] {
  return LAYER_REMAP.onRemove(tracks, removed)
}

/** Shift track paths up one layer when a new layer is inserted at `at`. */
export function remapTracksOnInsert(tracks: MotionTrack[], at: number): MotionTrack[] {
  return LAYER_REMAP.onInsert(tracks, at)
}
