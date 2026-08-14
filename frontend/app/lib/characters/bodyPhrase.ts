/**
 * Compiles a character's bodyShape sliders (0..1 each) into a graded prose
 * fragment for prompts. Pure — imports only the shared types. Proven by a
 * 4-round paid probe: image body refs don't steer generation, but graded
 * Wired into prompts since B3/fix-wave: rides SheetSource.bodyPhrase into panel prompts
 * and joins the cast clause via stateDescriptors.
 * task; this module is the mechanism only.
 *
 * Band semantics (per slider, most-extreme band checked first so containing
 * bands don't shadow it): the brief's `<0.15` / `<0.4` / `>0.6` / `>0.85`
 * notation is read LITERALLY as strict less-than / greater-than. So:
 *   - exactly 0.15 or 0.4 does NOT satisfy `< 0.15` / `< 0.4` — it falls
 *     through to the next (less extreme, or neutral) band.
 *   - exactly 0.6 or 0.85 does NOT satisfy `> 0.6` / `> 0.85` — same.
 * The result is a clean partition: [0, 0.15) / [0.15, 0.4) / [0.4, 0.6]
 * (dead zone, emits nothing) / (0.6, 0.85] / (0.85, 1]. For sliders with no
 * band covering a region (e.g. muscle has nothing in [0.15, 0.4)), that
 * region silently emits nothing too — same as the dead zone.
 */
import type { BodySliderId } from '#shared/characters/types'
import { BODY_SLIDERS } from '#shared/characters/types'

interface Band { test: (v: number) => boolean, text: string }

/** Order within each list matters: most-extreme band first, so it wins over a containing band. */
const BANDS: Record<BodySliderId, Band[]> = {
  frame: [
    { test: v => v > 0.6, text: 'a masculine frame' },
    { test: v => v < 0.4, text: 'a feminine frame' },
  ],
  height: [
    { test: v => v < 0.15, text: 'very short in stature' },
    { test: v => v < 0.4, text: 'short in stature' },
    { test: v => v > 0.85, text: 'very tall' },
    { test: v => v > 0.6, text: 'tall' },
  ],
  build: [
    { test: v => v < 0.15, text: 'a very slim, slight build' },
    { test: v => v < 0.4, text: 'a slim build' },
    { test: v => v > 0.85, text: 'a very heavy, plus-size build with a full figure' },
    { test: v => v > 0.6, text: 'a noticeably heavyset build' },
  ],
  muscle: [
    { test: v => v > 0.85, text: 'a strongly muscular physique' },
    { test: v => v > 0.6, text: 'an athletic, toned physique' },
    { test: v => v < 0.15, text: 'a soft, undefined physique' },
  ],
  shoulders: [
    { test: v => v > 0.6, text: 'broad shoulders' },
    { test: v => v < 0.4, text: 'narrow shoulders' },
  ],
  chest: [
    { test: v => v > 0.6, text: 'a full chest' },
    { test: v => v < 0.4, text: 'a flat chest' },
  ],
  waist: [
    { test: v => v > 0.6, text: 'a thick waist' },
    { test: v => v < 0.4, text: 'a narrow waist' },
  ],
  hips: [
    { test: v => v > 0.6, text: 'wide hips' },
    { test: v => v < 0.4, text: 'narrow hips' },
  ],
}

/** Fragment order = BODY_SLIDERS order; non-empty fragments joined with ', '. */
export function bodyPhrase(shape: Partial<Record<BodySliderId, number>> | null | undefined): string {
  if (!shape) return ''
  const fragments: string[] = []
  for (const id of BODY_SLIDERS) {
    const v = shape[id]
    if (typeof v !== 'number' || Number.isNaN(v)) continue
    const band = BANDS[id].find(b => b.test(v))
    if (band) fragments.push(band.text)
  }
  return fragments.join(', ')
}
