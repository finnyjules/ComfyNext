import type { Rng } from './rng'

/** A degree of freedom a staging/surface exposes to Shuffle. `pick` is the
 *  discrete domain the value is chosen from. */
export interface KnobSpec { id: string; pick: readonly unknown[] }

/** Resolve each knob to one value. An override wins (used to hold a knob across
 *  a re-roll); otherwise a value is drawn from the seeded rng. */
export function resolveKnobs(
  specs: readonly KnobSpec[], rng: Rng, overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    out[spec.id] = spec.id in overrides ? overrides[spec.id] : rng.pick(spec.pick)
  }
  return out
}
