// frontend/app/lib/shotdirector/profiles.ts
// Per-model capability declarations. A profile says what a video model can
// honor and how to assemble its Replicate input object from a ShotSheet +
// the compiled prompt string. Phase 1 fully implements Seedance and ships a
// seam-proving stub; other real models land in a later phase.

import type { RefKind, ShotSheet } from './types'

export type ModelInput = Record<string, unknown>

export interface ModelProfile {
  id: string
  label: string
  maxRefImages: number
  maxRefVideos: number
  maxRefAudios: number
  supportsFirstLastFrame: boolean
  supportsGenerateAudio: boolean
  wordBudgetWarn: number
  wordBudgetHard: number
  /** in-prompt reference tag, e.g. [Image1]. */
  refTag(kind: RefKind, slot: number): string
  /** assemble the model's Replicate input from the sheet + compiled prompt. */
  buildInput(sheet: ShotSheet, prompt: string): ModelInput
}

function bracketTag(kind: RefKind, slot: number): string {
  const label = kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Audio'
  return `[${label}${slot}]`
}

function atTag(kind: RefKind, slot: number): string {
  const label = kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Audio'
  return `@${label}${slot}`
}

function srcsByKind(sheet: ShotSheet, kind: RefKind): string[] {
  return sheet.references
    .filter(r => r.kind === kind)
    .sort((a, b) => a.slot - b.slot)
    .map(r => r.src)
}

export const SEEDANCE_PROFILE: ModelProfile = {
  id: 'seedance-2.0',
  label: 'Seedance 2.0',
  maxRefImages: 9,
  maxRefVideos: 3,
  maxRefAudios: 3,
  supportsFirstLastFrame: true,
  supportsGenerateAudio: true,
  wordBudgetWarn: 100,
  wordBudgetHard: 600,
  refTag: atTag,
  buildInput(sheet, prompt) {
    const input: ModelInput = {
      prompt,
      duration: sheet.format.durationS,
      resolution: sheet.format.resolution,
    }
    if (sheet.mode === 'reference') {
      input.aspect_ratio = sheet.format.aspectRatio
      const images = srcsByKind(sheet, 'image')
      const videos = srcsByKind(sheet, 'video')
      const audios = srcsByKind(sheet, 'audio')
      if (images.length) input.image_urls = images
      if (videos.length) input.video_urls = videos
      if (audios.length) input.audio_urls = audios
    } else {
      if (sheet.firstFrame) input.image_url = sheet.firstFrame
      if (sheet.lastFrame) input.end_image_url = sheet.lastFrame
    }
    input.generate_audio = sheet.audio.generate
    // fal Seedance has no seed input — omit it.
    return input
  },
}

// Seam-proving stub: a hypothetical model with a smaller reference surface and
// no video/audio refs. Real per-model profiles (Veo/Kling/Wan) land in a later
// phase; this exists so the compiler + rules are exercised across differing
// capabilities in Phase 1.
export const SEEDANCE_STUB_OTHER: ModelProfile = {
  id: 'stub-basic',
  label: 'Basic (stub)',
  maxRefImages: 3,
  maxRefVideos: 0,
  maxRefAudios: 0,
  supportsFirstLastFrame: false,
  supportsGenerateAudio: false,
  wordBudgetWarn: 100,
  wordBudgetHard: 600,
  refTag: bracketTag,
  buildInput(sheet, prompt) {
    return {
      prompt,
      aspect_ratio: sheet.format.aspectRatio,
      duration: sheet.format.durationS,
    }
  },
}

export const SHOT_PROFILES_BY_ID: Record<string, ModelProfile> = {
  [SEEDANCE_PROFILE.id]: SEEDANCE_PROFILE,
  [SEEDANCE_STUB_OTHER.id]: SEEDANCE_STUB_OTHER,
}

export function getProfile(id: string): ModelProfile {
  return SHOT_PROFILES_BY_ID[id] ?? SEEDANCE_PROFILE
}
