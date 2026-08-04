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
  cfg.version = 3
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
