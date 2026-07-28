import { describe, it, expect } from 'vitest'
import { shapeReliefPrompt } from '~~/server/utils/scene3dRelief'

describe('scene3d relief generation helpers', () => {
  it('biases the prompt toward a flat, evenly lit material sample', () => {
    const out = shapeReliefPrompt('hammered copper')
    expect(out).toContain('hammered copper')
    expect(out.length).toBeGreaterThan('hammered copper'.length)
  })

  it('returns empty for an empty prompt', () => {
    expect(shapeReliefPrompt('   ')).toBe('')
  })
})
