import { describe, it, expect } from 'vitest'
import { buildKeyframePrompt, KEYFRAME_COST_USD } from '../../app/lib/shotdirector/keyframe'
import { createDefaultShotSheet } from '../../app/lib/shotdirector/types'

function sheet() {
  const s = createDefaultShotSheet()
  s.subject = 'A woman in a red coat'
  s.action = 'walks toward camera'
  s.environment = 'a rainy neon street'
  s.lighting = 'neon'
  s.style = 'cinematic, 35mm'
  s.camera = { shotType: 'medium', move: 'push-in', pacing: 'smooth' }
  return s
}

describe('buildKeyframePrompt', () => {
  it('composes person + location when both refs present', () => {
    const p = buildKeyframePrompt(sheet(), { hasPerson: true, hasLocation: true })
    expect(p).toContain('Place the person from the first image into the location in the second image.')
    expect(p).toContain('Medium shot.')
    expect(p).toContain('neon; cinematic, 35mm.')
  })

  it('references the first image for person-only and location-only', () => {
    expect(buildKeyframePrompt(sheet(), { hasPerson: true, hasLocation: false }))
      .toContain('Feature the person from the first image.')
    expect(buildKeyframePrompt(sheet(), { hasPerson: false, hasLocation: true }))
      .toContain('Set in the location from the first image.')
  })

  it('is a still — never emits camera move or pacing words', () => {
    const p = buildKeyframePrompt(sheet(), { hasPerson: true, hasLocation: true })
    expect(p).not.toMatch(/push-in|pull-out|pan|track|orbit|aerial|handheld|locked-off/)
    expect(p).not.toMatch(/smooth|slow|gradual|gentle/)
  })

  it('works with no refs (pure text) and no composition sentence', () => {
    const p = buildKeyframePrompt(sheet(), { hasPerson: false, hasLocation: false })
    expect(p).toContain('Photorealistic cinematic film still.')
    expect(p).not.toContain('image.')
    expect(p).toContain('A woman in a red coat walks toward camera.')
  })

  it('exposes a cost constant', () => {
    expect(KEYFRAME_COST_USD).toBeGreaterThan(0)
  })
})
