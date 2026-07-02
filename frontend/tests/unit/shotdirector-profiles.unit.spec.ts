import { describe, it, expect } from 'vitest'
import { createDefaultShotSheet, type Ref, type ShotSheet } from '../../app/lib/shotdirector/types'
import { SEEDANCE_PROFILE, getProfile } from '../../app/lib/shotdirector/profiles'

const img = (slot: number): Ref => ({ kind: 'image', slot, src: `img${slot}`, role: 'identity-lock' })
const vid = (slot: number): Ref => ({ kind: 'video', slot, src: `vid${slot}`, role: 'camera-copy' })
const aud = (slot: number): Ref => ({ kind: 'audio', slot, src: `aud${slot}`, role: 'mood' })

describe('SEEDANCE_PROFILE', () => {
  it('declares the real Replicate capacities and word budget', () => {
    expect(SEEDANCE_PROFILE.maxRefImages).toBe(9)
    expect(SEEDANCE_PROFILE.maxRefVideos).toBe(3)
    expect(SEEDANCE_PROFILE.maxRefAudios).toBe(3)
    expect(SEEDANCE_PROFILE.wordBudgetWarn).toBe(100)
    expect(SEEDANCE_PROFILE.wordBudgetHard).toBe(600)
  })

  it('tags references with @ grammar (fal)', () => {
    expect(SEEDANCE_PROFILE.refTag('image', 1)).toBe('@Image1')
    expect(SEEDANCE_PROFILE.refTag('video', 2)).toBe('@Video2')
    expect(SEEDANCE_PROFILE.refTag('audio', 3)).toBe('@Audio3')
  })

  it('buildInput maps reference-mode arrays sorted by slot and sets format', () => {
    const s = createDefaultShotSheet()
    s.format = { aspectRatio: '9:16', durationS: 10, resolution: '720p', seed: 42 }
    s.references = [img(2), img(1), vid(1), aud(1)]
    const input = SEEDANCE_PROFILE.buildInput(s, 'PROMPT')
    expect(input).toEqual({
      prompt: 'PROMPT',
      duration: 10,
      resolution: '720p',
      aspect_ratio: '9:16',
      image_urls: ['img1', 'img2'],
      video_urls: ['vid1'],
      audio_urls: ['aud1'],
      generate_audio: true,
    })
  })

  it('buildInput maps first/last-frame mode and omits aspect_ratio + refs', () => {
    const s = createDefaultShotSheet()
    s.mode = 'firstLastFrame'
    s.firstFrame = 'FIRST'
    s.lastFrame = 'LAST'
    s.audio.generate = false
    const input = SEEDANCE_PROFILE.buildInput(s, 'PROMPT')
    expect(input).toEqual({
      prompt: 'PROMPT',
      duration: 5,
      resolution: '1080p',
      image_url: 'FIRST',
      end_image_url: 'LAST',
      generate_audio: false,
    })
  })

  it('getProfile falls back to Seedance for unknown ids', () => {
    expect(getProfile('does-not-exist').id).toBe('seedance-2.0')
    expect(getProfile('seedance-2.0')).toBe(SEEDANCE_PROFILE)
  })
})

describe('SEEDANCE_PROFILE fal shape', () => {
  it('tags references with @Image (fal), not [Image]', () => {
    expect(SEEDANCE_PROFILE.refTag('image', 1)).toBe('@Image1')
    expect(SEEDANCE_PROFILE.refTag('video', 2)).toBe('@Video2')
    expect(SEEDANCE_PROFILE.refTag('audio', 3)).toBe('@Audio3')
  })

  it('emits fal image_urls and no seed in reference mode', () => {
    const sheet = {
      mode: 'reference',
      references: [
        { kind: 'image', slot: 1, src: 'https://x/a.png', role: 'identity' },
        { kind: 'image', slot: 2, src: 'https://x/b.png', role: 'identity' },
      ],
      audio: { generate: true, dialogue: [] },
      format: { aspectRatio: '16:9', durationS: 5, resolution: '720p', seed: 42 },
    } as unknown as ShotSheet
    const input = SEEDANCE_PROFILE.buildInput(sheet, 'p')
    expect(input.image_urls).toEqual(['https://x/a.png', 'https://x/b.png'])
    expect(input.reference_images).toBeUndefined()
    expect(input.seed).toBeUndefined()
    expect(input.generate_audio).toBe(true)
  })

  it('emits image_url/end_image_url in firstLastFrame mode', () => {
    const sheet = {
      mode: 'firstLastFrame',
      references: [],
      firstFrame: 'https://x/first.png',
      lastFrame: 'https://x/last.png',
      audio: { generate: false, dialogue: [] },
      format: { aspectRatio: '16:9', durationS: 5, resolution: '720p', seed: 0 },
    } as unknown as ShotSheet
    const input = SEEDANCE_PROFILE.buildInput(sheet, 'p')
    expect(input.image_url).toBe('https://x/first.png')
    expect(input.end_image_url).toBe('https://x/last.png')
    expect(input.image).toBeUndefined()
  })
})
