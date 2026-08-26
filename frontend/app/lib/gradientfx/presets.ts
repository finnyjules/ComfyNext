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
import { defaultConfig, liquidConfig, liquidPresetConfig, meshConfig, rippleConfig, stackConfig, stripeConfig } from './randomize'
import { AUTHORED_PRESETS } from './presetConfigs'
import { makeRng, randomSeed } from './rng'
import { cloneConfig, ensureConfigDefaults, type GradientConfig } from './types'

export type GradientPresetName =
  | 'marble' | 'oil' | 'ink' | 'lava' | 'satin'  // liquid surface looks
  | 'liquid' | 'ripple' | 'stack' | 'mesh' | 'linear' // layout archetypes
  | 'dawn' | 'halo' | 'spectrum' // simple-primitive authored presets

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
  dawn: s => defaultConfig(s),
  halo: s => { const c = defaultConfig(s); c.canvas.layout = 'radialRamp'; return c },
  spectrum: s => { const c = defaultConfig(s); c.canvas.layout = 'conic'; c.layers[0]!.ramp = { angle: 0, radius: 1, shape: 'circle', sweep: 360, closeLoop: true }; return c },
}

/** Offered preset names = the fallback builders ∪ any user-authored-only styles
 *  (e.g. aurora/frosted the user builds that have no algorithmic builder). */
export const GRADIENT_PRESET_NAMES: string[] = [...new Set([...Object.keys(BUILDERS), ...Object.keys(AUTHORED_PRESETS)])]

/**
 * Build a preset's base config (defaults backfilled), or null for an unknown name.
 * A user-authored config wins over the algorithmic builder; its seed is refreshed
 * so the NOISE varies run-to-run while the look-defining params stay the user's.
 *
 * ## Orientation belongs to whoever chose it
 *
 * An ALGORITHMIC preset's flow angle and light azimuth were picked by a random
 * number in the first place, so re-rolling them per seed adds welcome variety
 * and costs nothing — two marbles that flow the same way would look like a
 * repeat.
 *
 * An AUTHORED preset's were picked by a person. `sunset` sets `flow.angle` 269
 * against a vertical ramp because a sunset is a HORIZON; `dawn` sets 90 for the
 * same reason. Rolling those produced exactly what the owner reported — right
 * colours, sideways sun — and contradicted this function's own promise that an
 * authored preset's look-defining params stay the author's. For a preset whose
 * subject IS a direction, the angle is as look-defining as the colours.
 *
 * So the roll runs on builder output only. Both callers benefit: the canvas
 * tuner's `applyPreset`, and the in-studio takes macro, which rides this same
 * function.
 */
export function buildGradientPreset(name: string, seed: string = randomSeed()): GradientConfig | null {
  const authored = AUTHORED_PRESETS[name]
  const base = authored ? { ...cloneConfig(authored), seed } : BUILDERS[name as GradientPresetName]?.(seed)
  if (!base) return null
  const cfg = ensureConfigDefaults(base)
  if (!authored) {
    // Salted so orientation is independent of the noise/grain seeding.
    const rng = makeRng(seed, 'orient')
    if (cfg.flow) cfg.flow.angle = Math.round(rng.range(0, 360))
    if (cfg.relief.light) cfg.relief.light.azimuth = Math.round(rng.range(0, 360))
  }
  return cfg
}
