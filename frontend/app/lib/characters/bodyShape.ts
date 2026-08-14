/**
 * Pure body-shape helpers for the Body editor (Task 5 of the
 * body-reference-builder plan). No three.js, no DOM — safe to unit-test and
 * safe to import from the store. `influencesFor` is the one bridge to the
 * GLB stage: `public/models/body-reference.glb`'s 8 morph targets are named
 * and ordered exactly per BODY_SLIDERS (verified by
 * tests/unit/body-model-asset.unit.spec.ts's `targetNames` check), so the
 * array this returns can be assigned directly to a mesh's
 * `morphTargetInfluences`.
 */
import type { BodySliderId } from '#shared/characters/types'
import { BODY_SLIDERS } from '#shared/characters/types'

export type BodyShape = Partial<Record<BodySliderId, number>>

export interface BodyPreset {
  id: string
  label: string
  shape: Record<BodySliderId, number>
}

/** All sliders at 0.5 — the neutral, average build; also bodyPhrase's dead zone. */
export function defaultBodyShape(): Record<BodySliderId, number> {
  const shape = {} as Record<BodySliderId, number>
  for (const id of BODY_SLIDERS) shape[id] = 0.5
  return shape
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * BODY_SLIDERS order, clamped to [0, 1]; a slider missing from `shape`
 * (sparse, per CharacterRecord.bodyShape) defaults to 0.5 — same neutral
 * value as an untouched slider. Directly assignable to a mesh's
 * `morphTargetInfluences`.
 */
export function influencesFor(shape: BodyShape | null | undefined): number[] {
  return BODY_SLIDERS.map((id) => {
    const v = shape?.[id]
    return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : 0.5
  })
}

function preset(id: string, label: string, overrides: BodyShape): BodyPreset {
  return { id, label, shape: { ...defaultBodyShape(), ...overrides } }
}

/**
 * Four starting points, tuned on the real figure (`/dev/body-editor`) rather
 * than guessed — see the shape of each override below for what reads
 * visually distinct on the mesh. Average is the identity (all 0.5, matches
 * defaultBodyShape) so picking it is always a safe, honest no-op.
 */
export const BODY_PRESETS: BodyPreset[] = [
  preset('slim', 'Slim', {
    build: 0.15, muscle: 0.35, waist: 0.25, hips: 0.35, chest: 0.35, shoulders: 0.35,
  }),
  preset('average', 'Average', {}),
  preset('athletic', 'Athletic', {
    build: 0.55, muscle: 0.8, shoulders: 0.65, waist: 0.4, hips: 0.5, chest: 0.55,
  }),
  preset('broad', 'Broad', {
    frame: 0.7, build: 0.7, muscle: 0.6, shoulders: 0.8, chest: 0.6, waist: 0.65, hips: 0.6,
  }),
]
