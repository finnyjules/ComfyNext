import { describe, it, expect } from 'vitest'
import { SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'

describe('space type effect labels', () => {
  it('every effect has a non-empty label that is not the generic "Text"', () => {
    for (const e of SPACE_TYPE_EFFECTS) {
      expect(e.label, `effect ${e.id}`).toBeTruthy()
      expect(e.label.toLowerCase(), `effect ${e.id}`).not.toBe('text')
    }
  })
  it('labels are unique across effects', () => {
    const labels = SPACE_TYPE_EFFECTS.map(e => e.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
