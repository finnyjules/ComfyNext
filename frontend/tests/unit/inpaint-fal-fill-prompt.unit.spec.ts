import { describe, it, expect } from 'vitest'
import { falFillPrompt } from '../../server/utils/falFill'

// Regression: fal's flux-pro/v1/fill rejects an empty prompt with
// `400 {"detail":"Prompt is required"}`. A pure-removal instruction
// ("remove the nose and the mouth") is blanked to '' client-side and forwarded
// to the pro/fal path, which then 400s. Replicate's flux-fill-dev tolerates the
// empty prompt, so only the pro tier needs a non-empty fallback.
describe('falFillPrompt', () => {
  it('substitutes a neutral fill prompt when the removal prompt is empty', () => {
    const p = falFillPrompt('')
    expect(p.trim().length).toBeGreaterThan(0)
  })

  it('treats whitespace-only as empty', () => {
    expect(falFillPrompt('   ').trim().length).toBeGreaterThan(0)
  })

  it('passes a real prompt through unchanged', () => {
    expect(falFillPrompt('a red apple')).toBe('a red apple')
  })

  it('the fallback describes a seamless/background fill, not an object to add', () => {
    const low = falFillPrompt('').toLowerCase()
    expect(low).toMatch(/background|seamless|surrounding|clean/)
  })
})
