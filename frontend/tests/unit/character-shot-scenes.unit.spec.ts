import { describe, it, expect } from 'vitest'
import { CHARACTER_SHOT_SCENES, type CharacterShotScene } from '~/data/character-shot-scenes'

const byTier = (t: CharacterShotScene['framing']) =>
  CHARACTER_SHOT_SCENES.filter((s) => s.framing === t)

describe('CHARACTER_SHOT_SCENES', () => {
  it('every entry has a prompt and a valid framing tier', () => {
    for (const s of CHARACTER_SHOT_SCENES) {
      expect(typeof s.prompt).toBe('string')
      expect(s.prompt.length).toBeGreaterThan(0)
      expect(['closeup', 'medium', 'full']).toContain(s.framing)
    }
  })

  it('has enough scenes per tier to fill a 24-shot run without repeats', () => {
    // 24-shot quota: 10 closeup, 8 full, 6 medium (see pickScenes).
    expect(byTier('closeup').length).toBeGreaterThanOrEqual(10)
    expect(byTier('full').length).toBeGreaterThanOrEqual(8)
    expect(byTier('medium').length).toBeGreaterThanOrEqual(6)
  })
})
