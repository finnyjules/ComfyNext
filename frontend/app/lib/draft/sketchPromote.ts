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

/** Sketch-PAD-card promote (spec 2026-07-10-copy-assistant-declunk-design.md,
 *  Task 9): the pad is transient and has no persistent source node to resolve
 *  a take from, so promote builds straight from the CARD's own provenance
 *  properties (`sketchPrompt`/`sketchSeed`, stamped by `materializeSketchCardsAt`)
 *  instead of `sketchPromoteOverridesFor`'s take-based lookup. Same return
 *  shape and the same rule: `model` is never copied. */
export function sketchPromoteOverridesFromProps(props: {
  sketchPrompt?: string
  sketchSeed?: number
  aspect_ratio?: string
}): {
  widgetOverrides: Record<string, unknown>
  propertyOverrides: Record<string, unknown>
} | null {
  const prompt = props.sketchPrompt?.trim()
  if (!prompt) return null
  const widgetOverrides: Record<string, unknown> = { prompt }
  if (props.aspect_ratio) widgetOverrides.aspect_ratio = props.aspect_ratio
  const propertyOverrides: Record<string, unknown> = {}
  if (typeof props.sketchSeed === 'number') {
    widgetOverrides.seed = props.sketchSeed
    propertyOverrides.seedLocks = { seed: true }
  }
  return { widgetOverrides, propertyOverrides }
}
