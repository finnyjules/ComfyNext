import { describe, it, expect } from 'vitest'
import { recolorPrompt, HARMONIZE_PROMPT } from '~/lib/editActions/prompts'

describe('recolorPrompt', () => {
  it('names the color', () => {
    expect(recolorPrompt('forest green (#2d6a4f)')).toContain('forest green (#2d6a4f)')
  })
  it('keeps material and lighting (masked recolor, not regenerate)', () => {
    const low = recolorPrompt('red').toLowerCase()
    expect(low).toContain('texture')
    expect(low).toContain('lighting')
  })
  it('describes the masked object generically (flux-fill sees only the region)', () => {
    // The SAM mask picks the object; the prompt must not require a target name.
    expect(recolorPrompt('#ff0000').toLowerCase()).toContain('same object')
  })
})

describe('HARMONIZE_PROMPT', () => {
  it('relights the second image to the first', () => {
    const low = HARMONIZE_PROMPT.toLowerCase()
    expect(low).toContain('second image')
    expect(low).toContain('first image')
    expect(low).toMatch(/relight|re-light/)
  })
  it('preserves identity, shape and framing', () => {
    const low = HARMONIZE_PROMPT.toLowerCase()
    expect(low).toContain('identity')
    expect(low).toContain('shape')
  })
})
