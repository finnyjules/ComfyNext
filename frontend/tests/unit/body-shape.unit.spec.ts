import { describe, it, expect } from 'vitest'
import { BODY_SLIDERS } from '#shared/characters/types'
import { BODY_PRESETS, defaultBodyShape, influencesFor } from '~/lib/characters/bodyShape'

describe('defaultBodyShape', () => {
  it('every slider is 0.5', () => {
    const shape = defaultBodyShape()
    for (const id of BODY_SLIDERS) expect(shape[id]).toBe(0.5)
  })
  it('has exactly the 8 BODY_SLIDERS keys', () => {
    expect(Object.keys(defaultBodyShape()).sort()).toEqual([...BODY_SLIDERS].sort())
  })
})

describe('influencesFor — order, defaults, clamps', () => {
  it('returns BODY_SLIDERS.length values in BODY_SLIDERS order', () => {
    const out = influencesFor(defaultBodyShape())
    expect(out).toHaveLength(BODY_SLIDERS.length)
    expect(out).toEqual(BODY_SLIDERS.map(() => 0.5))
  })

  it('reflects each slider at the position matching BODY_SLIDERS order', () => {
    const shape = { frame: 0.1, hips: 0.9 }
    const out = influencesFor(shape)
    expect(out[BODY_SLIDERS.indexOf('frame')]).toBe(0.1)
    expect(out[BODY_SLIDERS.indexOf('hips')]).toBe(0.9)
    // untouched sliders default to 0.5
    expect(out[BODY_SLIDERS.indexOf('height')]).toBe(0.5)
  })

  it('missing/sparse shape → every slider 0.5', () => {
    expect(influencesFor({})).toEqual(BODY_SLIDERS.map(() => 0.5))
  })

  it('null/undefined shape → every slider 0.5', () => {
    expect(influencesFor(null)).toEqual(BODY_SLIDERS.map(() => 0.5))
    expect(influencesFor(undefined)).toEqual(BODY_SLIDERS.map(() => 0.5))
  })

  it('clamps below 0 up to 0', () => {
    const out = influencesFor({ build: -0.4 })
    expect(out[BODY_SLIDERS.indexOf('build')]).toBe(0)
  })

  it('clamps above 1 down to 1', () => {
    const out = influencesFor({ build: 1.7 })
    expect(out[BODY_SLIDERS.indexOf('build')]).toBe(1)
  })

  it('clamps NaN-free but non-finite-safe: exact boundary values pass through unclamped', () => {
    const out = influencesFor({ build: 0, muscle: 1 })
    expect(out[BODY_SLIDERS.indexOf('build')]).toBe(0)
    expect(out[BODY_SLIDERS.indexOf('muscle')]).toBe(1)
  })
})

describe('BODY_PRESETS', () => {
  const ids = BODY_PRESETS.map(p => p.id)

  it('has exactly 4 presets: Slim / Average / Athletic / Broad', () => {
    expect(BODY_PRESETS).toHaveLength(4)
    expect(ids).toEqual(['slim', 'average', 'athletic', 'broad'])
  })

  it('preset ids are unique', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('Average is all-0.5', () => {
    const average = BODY_PRESETS.find(p => p.id === 'average')!
    for (const id of BODY_SLIDERS) expect(average.shape[id]).toBe(0.5)
  })

  it('every preset value is within [0, 1]', () => {
    for (const preset of BODY_PRESETS) {
      for (const id of BODY_SLIDERS) {
        const v = preset.shape[id]
        expect(typeof v).toBe('number')
        expect(v as number).toBeGreaterThanOrEqual(0)
        expect(v as number).toBeLessThanOrEqual(1)
      }
    }
  })

  it('every preset has a label', () => {
    for (const preset of BODY_PRESETS) expect(preset.label.length).toBeGreaterThan(0)
  })

  it('Slim, Athletic, Broad each differ from Average on at least one slider (they are not decorative)', () => {
    const average = BODY_PRESETS.find(p => p.id === 'average')!
    for (const preset of BODY_PRESETS.filter(p => p.id !== 'average')) {
      const differs = BODY_SLIDERS.some(id => preset.shape[id] !== average.shape[id])
      expect(differs, `${preset.id} should differ from Average`).toBe(true)
    }
  })
})
