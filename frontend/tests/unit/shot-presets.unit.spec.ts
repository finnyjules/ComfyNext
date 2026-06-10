import { describe, it, expect } from 'vitest'
import { SHOT_PRESETS, SHOT_PRESETS_BY_ID, SHOT_CATEGORY_LABELS } from '../../app/data/shot-presets'

describe('shot-presets catalog', () => {
  it('has 28 unique ids', () => {
    const ids = SHOT_PRESETS.map(p => p.id)
    expect(ids).toHaveLength(28)
    expect(new Set(ids).size).toBe(28)
  })

  it('every entry is complete', () => {
    for (const p of SHOT_PRESETS) {
      expect(p.label.trim()).toBeTruthy()
      expect(p.recipe.trim()).toBeTruthy()
      expect(p.pitch.trim()).toBeTruthy()
      expect(Object.keys(SHOT_CATEGORY_LABELS)).toContain(p.category)
      expect(SHOT_PRESETS_BY_ID[p.id]).toBe(p)
    }
  })

  it('ids match the backend catalog convention (kebab-case)', () => {
    for (const p of SHOT_PRESETS) expect(p.id).toMatch(/^[a-z0-9-]+$/)
  })
})
