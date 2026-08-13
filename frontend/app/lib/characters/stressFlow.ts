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

// ── Generate a reference photo from the look's cover (drawer tile) ────────
// Same call pattern as the stress flow above, but a single on-demand shot
// instead of a 10-tile grid, and anchored to the look's COVER (not a baked
// sheet) — this is meant to run before a sheet exists, to grow the photo
// pool a sheet would build from.
export const REF_PHOTO_SUFFIX = ', the exact same person as the reference'

export type RefPhotoPose = 'portrait' | 'profile' | 'full-body'

interface RefPhotoPoseSpec {
  id: RefPhotoPose
  label: string
  prompt: string
  aspectRatio: string
}

/** The 3 choices offered on the drawer tile's menu — 'portrait' is the default. */
export const REF_PHOTO_POSES: RefPhotoPoseSpec[] = [
  {
    id: 'portrait',
    label: 'Clean portrait',
    prompt: 'close-up portrait, facing camera directly, neutral expression, soft even studio light, plain neutral background',
    aspectRatio: '1:1',
  },
  {
    id: 'profile',
    label: 'Profile',
    prompt: 'profile view close-up, looking to the side, soft even light, plain background',
    aspectRatio: '1:1',
  },
  {
    id: 'full-body',
    label: 'Full body',
    prompt: 'full-body shot standing naturally, arms relaxed, soft daylight, plain seamless background',
    aspectRatio: '3:4',
  },
]

/** Assemble the POST body for a drawer-tile "generate a reference photo" call. */
export function refPhotoRequest(pose: RefPhotoPose, coverDataUrl: string): StressTileRequest {
  const spec = REF_PHOTO_POSES.find(p => p.id === pose) ?? REF_PHOTO_POSES[0]!
  return {
    referenceImageDataUrl: coverDataUrl,
    prompt: spec.prompt + REF_PHOTO_SUFFIX,
    aspectRatio: spec.aspectRatio,
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
