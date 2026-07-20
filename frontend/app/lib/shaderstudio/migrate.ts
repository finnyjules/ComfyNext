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
  cfg.version = 2
  // Motion tracks recorded before the effects[] cutover point at the old single-
  // effect path (`effect.params.*`); rewrite them at the wrapped layer's new
  // address (`effects.0.params.*`) so pre-existing animations keep working.
  for (const tr of cfg.motion?.tracks ?? []) {
    if (typeof tr.path === 'string' && tr.path.startsWith('effect.params.')) tr.path = tr.path.replace('effect.params.', 'effects.0.params.')
  }
  return cfg as ShaderStudioConfig
}
