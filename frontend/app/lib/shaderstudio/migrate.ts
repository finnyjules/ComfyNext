// frontend/app/lib/shaderstudio/migrate.ts
// Normalizes a persisted shader config to the current (v2) `effects[]` shape.
// NOT yet wired into the Surface/Node load path — Task 6 wires it in together
// with switching readers from `.effect` to `.effects`.

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
  // NOTE: `effect` is intentionally NOT deleted here — readers still use it until
  // Task 6 switches them. Task 6 adds `delete cfg.effect` and removes the field.
  cfg.version = 2
  return cfg as ShaderStudioConfig
}
