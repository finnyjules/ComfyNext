/** Sketch promote — spawn the full generator beside a Sketch node, seeded from
 *  one of its takes (spec §Sketch Node, Task 3). Unlike draft-mode promote
 *  (`promote.ts`, which re-runs the SAME node in place), this never re-runs
 *  the sketch itself: it only computes the overrides for the NEW generator
 *  node that `sailor:spawnBeside` creates next to it.
 *
 *  Deliberately narrow: prompt/seed/aspect_ratio only. `model` is never
 *  copied — the spawned node uses the schema default (the finisher model),
 *  which is the whole point of promoting out of the cheap sketch tier. */
import type { Take } from '~/composables/useTakes'

export function sketchPromoteOverridesFor(take: Take): {
  widgetOverrides: Record<string, unknown>
  propertyOverrides: Record<string, unknown>
} | null {
  const p = take?.params ?? {}
  const widgetOverrides: Record<string, unknown> = {}
  if (typeof p.prompt === 'string' && p.prompt) widgetOverrides.prompt = p.prompt
  if (p.seed !== undefined) widgetOverrides.seed = p.seed
  if (p.aspect_ratio !== undefined) widgetOverrides.aspect_ratio = p.aspect_ratio

  if (!Object.keys(widgetOverrides).length) return null

  const propertyOverrides: Record<string, unknown> = p.seed !== undefined
    ? { seedLocks: { seed: true } }
    : {}

  return { widgetOverrides, propertyOverrides }
}
