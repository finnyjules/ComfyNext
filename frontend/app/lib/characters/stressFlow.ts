/**
 * Pure payload assembly for the stress-test flow (Task 14): turning a stress
 * tile into the /api/cloud-train/character-shot request body, and turning a
 * judged tile set into the patchState payloads for the draft→testing
 * transition and the final lock. Kept separate from stress.ts (tile
 * lifecycle: freshTiles/stressOutcome/canLock) so each file stays a small,
 * independently-testable unit.
 */
import { aspectForFraming } from '~/data/character-shot-scenes'
import type { CharacterShotScene } from '~/data/character-shot-scenes'
import type { CharacterState, StressResult } from '#shared/characters/types'

/**
 * Appended to every stress-scene prompt so the model anchors identity to the
 * reference sheet image, not just the scene's pose/lighting description —
 * the scene prompts themselves are deliberately face-agnostic (see
 * character-shot-scenes.ts).
 */
export const STRESS_PROMPT_SUFFIX = ', the exact same person as the reference sheet'

export interface StressTileRequest {
  referenceImageDataUrl: string
  prompt: string
  aspectRatio: string
}

/**
 * Assemble the POST body for one stress tile's character-shot call. The
 * sheet data URL is fetched ONCE by the caller and reused across all 10
 * tiles (money guard — no redundant re-fetches of the same image).
 */
export function buildStressTileRequest(
  sheetDataUrl: string, scene: CharacterShotScene, idx: number,
): StressTileRequest {
  return {
    referenceImageDataUrl: sheetDataUrl,
    prompt: scene.prompt + STRESS_PROMPT_SUFFIX,
    aspectRatio: aspectForFraming(scene.framing, idx),
  }
}

/** Patch sent the moment the FIRST tile lands: draft → testing. */
export function buildTestingPatch(): Partial<CharacterState> {
  return { status: 'testing' }
}

/**
 * Patch sent on Lock: status → locked, carrying the judged outcome with the
 * caller-stamped timestamp. Does not mutate the passed-in outcome.
 */
export function buildLockPatch(outcome: StressResult, at: string): Partial<CharacterState> {
  return { status: 'locked', stressResult: { ...outcome, at } }
}
