import { describe, it, expect } from 'vitest'
import { looksLikeImageIdea } from '~/lib/sketch/sketchIntent'

describe('looksLikeImageIdea', () => {
  it('treats a descriptive noun phrase as an idea', () => {
    expect(looksLikeImageIdea('a lighthouse at dusk', false)).toBe(true)
    expect(looksLikeImageIdea('moody cyberpunk alley, neon rain', false)).toBe(true)
  })
  it('rejects graph-edit imperatives', () => {
    expect(looksLikeImageIdea('add a blur node', false)).toBe(false)
    expect(looksLikeImageIdea('make it warmer', false)).toBe(false)
    expect(looksLikeImageIdea('connect these two', false)).toBe(false)
  })
  it('rejects questions', () => {
    expect(looksLikeImageIdea('what does this node do?', false)).toBe(false)
    expect(looksLikeImageIdea('how do I export', false)).toBe(false)
  })
  it('leans toward sketch on an empty canvas', () => {
    expect(looksLikeImageIdea('the dog', true)).toBe(true)
  })
  it('rejects long instruction-like text when the graph is not empty', () => {
    expect(looksLikeImageIdea('go through every node and set the seed to a fixed value please', false)).toBe(false)
  })
  it('rejects empty input', () => {
    expect(looksLikeImageIdea('   ', false)).toBe(false)
  })
})
