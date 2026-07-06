import { describe, it, expect } from 'vitest'
import { buildDressPrompt, DRESS_COST_USD } from '../../app/lib/wardrobe/dress'

describe('buildDressPrompt', () => {
  it('garment mode references the second image and preserves identity', () => {
    const p = buildDressPrompt({ mode: 'garment' })
    expect(p).toContain('garment shown in the second image')
    expect(p).toContain('Preserve their face, hair, body, and pose')
    expect(p).not.toContain('Match this refinement')
  })

  it('garment mode folds in an optional text refinement', () => {
    const p = buildDressPrompt({ mode: 'garment', outfit: 'sleeves rolled up' })
    expect(p).toContain('garment shown in the second image')
    expect(p).toContain('Match this refinement: sleeves rolled up.')
  })

  it('text mode names the outfit', () => {
    const p = buildDressPrompt({ mode: 'text', outfit: 'a white one-piece swimsuit' })
    expect(p).toContain("Change the person's outfit to a white one-piece swimsuit.")
    expect(p).toContain('replace only the clothing')
  })

  it('text mode with no outfit returns empty (caller keeps generate disabled)', () => {
    expect(buildDressPrompt({ mode: 'text' })).toBe('')
    expect(buildDressPrompt({ mode: 'text', outfit: '   ' })).toBe('')
  })

  it('exposes a cost constant', () => {
    expect(DRESS_COST_USD).toBeGreaterThan(0)
  })
})
