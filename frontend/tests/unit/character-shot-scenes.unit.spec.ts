import { describe, it, expect } from 'vitest'
import { CHARACTER_SHOT_SCENES, CHARACTER_SHEET_CANONICAL, type CharacterShotScene, pickScenes, aspectForFraming, syntheticCount } from '~/data/character-shot-scenes'

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

describe('CHARACTER_SHEET_CANONICAL', () => {
  it('every canonical sheet prompt carries a solo constraint (guards against Flux subject duplication)', () => {
    for (const s of CHARACTER_SHEET_CANONICAL) {
      expect(s.prompt).toMatch(/\bsolo\b/)
    }
  })
})

const tierCounts = (scenes: { framing: string }[]) => ({
  closeup: scenes.filter((s) => s.framing === 'closeup').length,
  medium: scenes.filter((s) => s.framing === 'medium').length,
  full: scenes.filter((s) => s.framing === 'full').length,
})

describe('pickScenes', () => {
  it('returns exactly `count` scenes', () => {
    for (const c of [4, 8, 12, 16, 24]) {
      expect(pickScenes(c)).toHaveLength(c)
    }
  })

  it('hits the per-tier quotas (close co-plural, full >= ~33%, medium >= ~20%)', () => {
    for (const c of [8, 12, 16, 24]) {
      const t = tierCounts(pickScenes(c))
      expect(t.closeup).toBeGreaterThanOrEqual(t.full) // close-ups never fewer than full
      expect(t.closeup).toBeGreaterThanOrEqual(t.medium)
      expect(t.full).toBeGreaterThanOrEqual(Math.floor(c * 0.3))
      expect(t.medium).toBeGreaterThanOrEqual(Math.floor(c * 0.2))
    }
  })

  it('always includes at least one full-body scene for any positive count', () => {
    for (const c of [1, 2, 3, 4, 16]) {
      expect(pickScenes(c).some((s) => s.framing === 'full')).toBe(true)
    }
  })

  it('spreads selection within a tier rather than taking the first N', () => {
    const scenes = pickScenes(24)
    const close = scenes.filter((s) => s.framing === 'closeup')
    expect(new Set(close.map((s) => s.prompt)).size).toBe(close.length)
    const full = scenes.filter((s) => s.framing === 'full')
    expect(new Set(full.map((s) => s.prompt)).size).toBe(full.length)
    const medium = scenes.filter((s) => s.framing === 'medium')
    expect(new Set(medium.map((s) => s.prompt)).size).toBe(medium.length)
  })

  it('produces the documented 24-shot tier split (10 closeup / 8 full / 6 medium)', () => {
    const t = tierCounts(pickScenes(24))
    expect(t).toEqual({ closeup: 10, full: 8, medium: 6 })
  })

  it('returns an empty array for count <= 0', () => {
    expect(pickScenes(0)).toEqual([])
    expect(pickScenes(-3)).toEqual([])
  })
})

describe('aspectForFraming', () => {
  it('uses portrait 3:4 for full-body so a standing body is not squashed', () => {
    expect(aspectForFraming('full', 0)).toBe('3:4')
    expect(aspectForFraming('full', 5)).toBe('3:4')
  })
  it('cycles the configured aspects for non-full framings', () => {
    expect(aspectForFraming('closeup', 0)).toBe('1:1')
    expect(aspectForFraming('closeup', 1)).toBe('3:4')
    expect(aspectForFraming('medium', 2)).toBe('4:3')
    expect(aspectForFraming('closeup', 3)).toBe('1:1') // wraps
  })
})

describe('syntheticCount', () => {
  it('tops up to the target after counting real included photos', () => {
    expect(syntheticCount(16, 0)).toBe(16)
    expect(syntheticCount(16, 3)).toBe(13)
  })
  it('never goes negative when real photos meet or exceed the target', () => {
    expect(syntheticCount(16, 16)).toBe(0)
    expect(syntheticCount(16, 20)).toBe(0)
  })
})
