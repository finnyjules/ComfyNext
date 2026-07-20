import type { ControlSpec } from '~/lib/spacetype/effect'
import type { EffectDef } from '~/lib/shaderfx/types'
import type { ShaderStudioConfig } from './types'

/**
 * The Shader studio's tune vocabulary for the in-product agent. Like Gradient,
 * the studio keeps everything on one nested `config` ref, so keys are DOTTED
 * paths resolved by makeConfigParams. Two rules keep the offer honest:
 *  - a stage's controls are only exposed when that stage is enabled (tune adjusts
 *    what's visible; the user toggles stages on/off);
 *  - the active effect's own float uniforms are surfaced dynamically under
 *    `effects.<activeEffect>.params.<uniform>` (enum uniforms are structural,
 *    so skipped).
 */
function slider(key: string, label: string, min: number, max: number, step: number, group: string, hint?: string): ControlSpec {
  return { key, label, kind: 'slider', min, max, step, default: 0, group, ...(hint ? { hint } : {}) }
}

/** `activeEffect` defaults to 0 for callers that only ever look at the base layer
 *  (e.g. the Collections bind-menu snapshot in `studioControls.ts`). */
export function shaderAgentControls(cfg: ShaderStudioConfig, effectDef: EffectDef | null, activeEffect = 0): ControlSpec[] {
  const out: ControlSpec[] = []

  // Active effect's float knobs (the heart of the stylize stage) — scoped to
  // whichever layer is selected in the aside StudioLayerStack.
  const active = cfg.effects[activeEffect]
  if (active?.enabled && effectDef) {
    for (const p of effectDef.params) {
      if (p.type !== 'float') continue // enum uniforms are structural, not a tune
      out.push(slider(`effects.${activeEffect}.params.${p.uniform}`, p.label, p.min ?? 0, p.max ?? 1, p.step ?? 0.01, 'Effect'))
    }
  }

  // Duotone
  if (cfg.duotone.enabled) {
    out.push({ key: 'duotone.ink', label: 'Ink', kind: 'color', default: '#1a1a2e', group: 'Duotone' })
    out.push({ key: 'duotone.paper', label: 'Paper', kind: 'color', default: '#f5f5f5', group: 'Duotone' })
  }

  // Gradient map (the ramp colours are set via the palette picker, not tuned)
  if (cfg.gradientMap?.enabled) {
    out.push(slider('gradientMap.mix', 'Gradient map mix', 0, 1, 0.01, 'Gradient map'))
  }

  // Adjustments
  if (cfg.adjust.enabled) {
    out.push(slider('adjust.exposure', 'Exposure', -2, 2, 0.01, 'Adjust'))
    out.push(slider('adjust.brightness', 'Brightness', -1, 1, 0.01, 'Adjust'))
    out.push(slider('adjust.contrast', 'Contrast', -1, 1, 0.01, 'Adjust'))
    out.push(slider('adjust.saturation', 'Saturation', -1, 1, 0.01, 'Adjust'))
    out.push(slider('adjust.hue', 'Hue', -180, 180, 0.01, 'Adjust'))
    out.push(slider('adjust.temperature', 'Temperature', -1, 1, 0.01, 'Adjust', 'Negative = cooler/blue, positive = warmer/orange'))
    out.push(slider('adjust.tint', 'Tint', -1, 1, 0.01, 'Adjust'))
  }

  // Post — lens blur
  if (cfg.post.blur.enabled) {
    out.push(slider('post.blur.range', 'Focus range', 0, 1, 0.01, 'Lens blur'))
    out.push(slider('post.blur.aperture', 'Aperture', 0, 1, 0.01, 'Lens blur'))
    out.push(slider('post.blur.maxBlur', 'Max blur', 0, 40, 1, 'Lens blur'))
  }

  // Post — chromatic aberration
  if (cfg.post.chromatic.enabled) {
    out.push(slider('post.chromatic.amount', 'Chromatic amount', 0, 1, 0.01, 'Chromatic'))
  }

  // Post — bloom
  if (cfg.post.bloom.enabled) {
    out.push(slider('post.bloom.threshold', 'Bloom threshold', 0, 1, 0.01, 'Bloom'))
    out.push(slider('post.bloom.intensity', 'Bloom intensity', 0, 3, 0.01, 'Bloom'))
    out.push(slider('post.bloom.radius', 'Bloom radius', 4, 200, 2, 'Bloom'))
  }

  return out
}
