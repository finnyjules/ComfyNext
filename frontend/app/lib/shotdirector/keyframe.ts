// frontend/app/lib/shotdirector/keyframe.ts
// Builds the prompt for a still "keyframe" preview — a photoreal frame that
// approximates what Seedance will produce, generated from the SAME references
// (cast cover + location plate) and the same shot intent. Deliberately a STILL
// instruction: camera move and pacing are dropped (a frame can't show motion,
// and motion words confuse the image model). Pure and deterministic.
import { SHOT_TYPE_PHRASE, type ShotSheet } from './types'

/** Estimated cost of one keyframe preview (nano-banana-pro). Confirm vs billing. */
export const KEYFRAME_COST_USD = 0.05

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s
}

export interface KeyframeRefs {
  /** a person/cast reference image is provided (first in the image list). */
  hasPerson: boolean
  /** a location plate is provided (after the person, if any). */
  hasLocation: boolean
}

export function buildKeyframePrompt(sheet: ShotSheet, refs: KeyframeRefs): string {
  const parts: string[] = ['Photorealistic cinematic film still.']

  // Composition sentence matches the image order the caller sends.
  if (refs.hasPerson && refs.hasLocation) {
    parts.push('Place the person from the first image into the location in the second image.')
  } else if (refs.hasPerson) {
    parts.push('Feature the person from the first image.')
  } else if (refs.hasLocation) {
    parts.push('Set in the location from the first image.')
  }

  const who = [sheet.subject.trim(), sheet.action.trim().replace(/\.$/, '')].filter(Boolean).join(' ')
  if (who) parts.push(`${capitalize(who)}.`)

  const env = sheet.environment.trim()
  if (env) parts.push(`In ${env}.`)

  // Framing only — NO camera move / pacing.
  parts.push(`${SHOT_TYPE_PHRASE[sheet.camera.shotType]}.`)

  const look = [sheet.lighting.trim(), sheet.style.trim()].filter(Boolean)
  if (look.length) parts.push(`${look.join('; ')}.`)

  return parts.join(' ')
}
