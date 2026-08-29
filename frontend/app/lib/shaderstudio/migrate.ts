// frontend/app/lib/shaderstudio/migrate.ts
// Normalizes a persisted shader config to the current (v2) `effects[]` shape.
// Wired into the Surface/Node load path (Task 6): the legacy single `effect`
// field is folded into `effects[0]` and then dropped.

import type { ShaderStudioConfig, StudioEffect } from './types'
import { newLayerId } from './types'

/** Normalize a persisted shader config to the current (v2) effects[] shape. */
export function migrateShaderConfig(raw: any): ShaderStudioConfig {
  const cfg = { ...raw }
  if (!Array.isArray(cfg.effects)) {
    const legacy = cfg.effect
    const eff: StudioEffect = legacy
      ? { layerId: newLayerId(), id: legacy.id ?? '', params: legacy.params ?? {}, enabled: legacy.enabled ?? true,
          blend: 'normal', opacity: 1, customChars: legacy.customChars }
      : { layerId: newLayerId(), id: '', params: {}, enabled: true, blend: 'normal', opacity: 1 }
    cfg.effects = [eff]
  }
  // Readers now use `effects[]` exclusively (Task 6 cutover); drop the legacy field.
  delete cfg.effect
  const wasVersion = Number(cfg.version) || 0
  // Motion tracks recorded before the effects[] cutover point at the old single-
  // effect path (`effect.params.*`); rewrite them at the wrapped layer's new
  // address (`effects.0.params.*`) so pre-existing animations keep working.
  for (const tr of cfg.motion?.tracks ?? []) {
    if (typeof tr.path === 'string' && tr.path.startsWith('effect.params.')) tr.path = tr.path.replace('effect.params.', 'effects.0.params.')
  }
  if (wasVersion < 3) migrateSpectrumMap(cfg)
  if (wasVersion < 4) migrateTexturedGlass(cfg)
  cfg.version = 4
  return cfg as ShaderStudioConfig
}

/**
 * `gradient_map` used to be a cosine rainbow with Hue/Spread/Contrast — it was
 * named after Photoshop's gradient map but could only ever produce a rainbow,
 * because the catalog had no colour param type. It is now a real gradient map,
 * and the old rainbow lives on as `spectrum_map` with the identical shader and
 * uniforms.
 *
 * Identified by the UNIFORMS, not by a version bump: `u_hue`/`u_spread` exist on
 * the old effect and on neither the new `gradient_map` (`u_ramp`/`u_contrast`/
 * `u_mix`) nor anything else that could be sitting at this id. A saved layer
 * carrying them is unambiguously pre-change, so it moves to `spectrum_map` and
 * keeps rendering exactly what it rendered before. A layer with no params at all
 * was on defaults, which for the old effect was the plain rainbow — also moved,
 * for the same reason.
 *
 * Motion tracks addressed at `effects.<i>.params.u_hue` (etc.) keep working
 * untouched: the path names the layer index and the uniform, and both survive.
 *
 * GATED ON `version < 3`, not run unconditionally. A layer with empty params is
 * ambiguous by inspection alone — it is either an old layer sitting on the
 * rainbow's defaults or a NEW `gradient_map` layer sitting on the real ramp's
 * defaults — and those must migrate in opposite directions. The stored version
 * is the only thing that actually distinguishes them, so without the gate this
 * would keep converting freshly-created gradient maps into rainbows forever.
 */
function migrateSpectrumMap(cfg: any): void {
  for (const eff of cfg.effects ?? []) {
    if (eff?.id !== 'gradient_map') continue
    const p = eff.params ?? {}
    const isOld = 'u_hue' in p || 'u_spread' in p || Object.keys(p).length === 0
    // A `u_ramp` key means it was already saved against the NEW gradient_map.
    if (isOld && !('u_ramp' in p) && !('u_mix' in p)) eff.id = 'spectrum_map'
  }
}

/**
 * `blinds` used to be an analytic half-cylinder: refraction was a closed-form
 * bend across the flute, and the ribs were PAINTED — `u_depth` darkened the seams
 * and `u_shadeWidth` set how wide the bright crest stayed. It is now a height
 * field, so the shading is LIT off the surface normal instead: `u_relief` sets
 * how steep the surface reads and `u_sheen` how hard it glints.
 *
 * The two painted-rib uniforms have no counterpart in a lit model, so they are
 * dropped. Everything else keeps its uniform NAME and only changes label, which
 * is what lets saved layers and their motion tracks survive: tracks address
 * uniforms by name (`effects.0.params.u_chromatic`), so a rename would silently
 * break every recorded animation. `u_mode` likewise extends from a 2-value enum
 * to a 9-value one with 0 (reeded) and 1 (concentric) unchanged, so no saved
 * pattern choice moves.
 *
 * GATED ON `version < 4`, following `migrateSpectrumMap`. A layer with neither
 * retired uniform is ambiguous by inspection — it is either an old layer that sat
 * on defaults or a new one — and only the stored version separates them. Without
 * the gate this would keep re-seeding `u_relief`/`u_sheen` over a user's own
 * values every time a config was loaded.
 */
function migrateTexturedGlass(cfg: any): void {
  const RETIRED = ['u_depth', 'u_shadeWidth']
  for (const eff of cfg.effects ?? []) {
    if (eff?.id !== 'blinds') continue
    const p = eff.params ?? (eff.params = {})
    for (const u of RETIRED) delete p[u]
    // Seed the lit-shading pair at the calibrated defaults so an old layer reads
    // as the same material rather than as flat glass.
    if (!('u_relief' in p)) p.u_relief = 1.0
    if (!('u_sheen' in p)) p.u_sheen = 0.3
  }
  // Animations pointed at the painted-rib uniforms now address nothing. Drop
  // those tracks rather than leaving them to write into a dead key.
  const tracks = cfg.motion?.tracks
  if (Array.isArray(tracks)) {
    const blinds = new Set(
      (cfg.effects ?? []).flatMap((e: any, i: number) => (e?.id === 'blinds' ? [i] : [])),
    )
    cfg.motion.tracks = tracks.filter((tr: any) => {
      const m = /^effects\.(\d+)\.params\.(u_\w+)$/.exec(String(tr?.path ?? ''))
      return !(m && blinds.has(Number(m[1])) && RETIRED.includes(m[2]!))
    })
  }
}
