/**
 * Agent-facing gradient STYLE presets. The in-product agent (canvas tuner) picks a
 * preset for the overall look — a guaranteed-good base config — then fine-tunes
 * params (colours, blur, grain…) on top. This sidesteps the layout-gated control
 * problem: the model never needs the liquid-only knobs to CREATE a marble, because
 * the marble preset already bakes in good depth/veins/foldScale.
 *
 * Names map to the studio's own preset builders (the same ones behind the Marble/
 * Oil/… buttons), so an agent-picked preset looks identical to a hand-picked one.
 * "aurora" / "frosted" are deliberately NOT presets — they're prompt recipes
 * (mesh + palette, any preset + focus.blur) the model composes from these.
 */
import { liquidConfig, liquidPresetConfig, meshConfig, rippleConfig, stackConfig, stripeConfig } from './randomize'
import { AUTHORED_PRESETS } from './presetConfigs'
import { makeRng, randomSeed } from './rng'
import { cloneConfig, ensureConfigDefaults, type GradientConfig } from './types'

export type GradientPresetName =
  | 'marble' | 'oil' | 'ink' | 'lava' | 'satin'  // liquid surface looks
  | 'liquid' | 'ripple' | 'stack' | 'mesh' | 'linear' // layout archetypes

/** Algorithmic fallback builders — used only when the user hasn't authored that
 *  preset yet (AUTHORED_PRESETS wins). */
const BUILDERS: Record<GradientPresetName, (seed: string) => GradientConfig> = {
  marble: s => liquidPresetConfig('marble', s),
  oil: s => liquidPresetConfig('oil', s),
  ink: s => liquidPresetConfig('ink', s),
  lava: s => liquidPresetConfig('lava', s),
  satin: s => liquidPresetConfig('satin', s),
  liquid: s => liquidConfig(s),
  ripple: s => rippleConfig(s),
  stack: s => stackConfig(s),
  mesh: s => meshConfig(s),
  linear: s => stripeConfig(s),
}

/** Offered preset names = the fallback builders ∪ any user-authored-only styles
 *  (e.g. aurora/frosted the user builds that have no algorithmic builder). */
export const GRADIENT_PRESET_NAMES: string[] = [...new Set([...Object.keys(BUILDERS), ...Object.keys(AUTHORED_PRESETS)])]

/** Build a preset's base config (defaults backfilled), or null for an unknown name.
 *  A user-authored config wins over the algorithmic builder; its seed is refreshed
 *  so the noise varies run-to-run while the look-defining params stay the user's. */
export function buildGradientPreset(name: string, seed: string = randomSeed()): GradientConfig | null {
  const authored = AUTHORED_PRESETS[name]
  const base = authored ? { ...cloneConfig(authored), seed } : BUILDERS[name as GradientPresetName]?.(seed)
  if (!base) return null
  const cfg = ensureConfigDefaults(base)
  // Vary ORIENTATION per seed so re-seeded presets don't all flow/light the same way.
  // Angle is orientation-only — keeps the vibe, adds variety. Salted so it's
  // independent of the noise/grain seeding.
  const rng = makeRng(seed, 'orient')
  if (cfg.flow) cfg.flow.angle = Math.round(rng.range(0, 360))
  if (cfg.relief.light) cfg.relief.light.azimuth = Math.round(rng.range(0, 360))
  return cfg
}
