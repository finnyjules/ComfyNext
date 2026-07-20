import { describe, it, expect } from 'vitest'
import { looksLikeImageIdea, cleanSketchPrompt } from '~/lib/sketch/sketchIntent'

describe('cleanSketchPrompt', () => {
  it('strips the draft/command wrapper down to the subject', () => {
    expect(cleanSketchPrompt('sketch me a dog sleeping on a couch')).toBe('dog sleeping on a couch')
    expect(cleanSketchPrompt('draw a lighthouse at dusk')).toBe('lighthouse at dusk')
    expect(cleanSketchPrompt('generate a moody cyberpunk alley')).toBe('moody cyberpunk alley')
    expect(cleanSketchPrompt('make me a quick sketch of a red door')).toBe('red door')
  })
  it('leaves a bare subject untouched', () => {
    expect(cleanSketchPrompt('a dog sleeping on a couch')).toBe('a dog sleeping on a couch')
    expect(cleanSketchPrompt('moody cyberpunk alley, neon rain')).toBe('moody cyberpunk alley, neon rain')
  })
  it('preserves an explicit STYLE request (not verb-led)', () => {
    expect(cleanSketchPrompt('a pencil sketch of a dog')).toBe('a pencil sketch of a dog')
  })
  it('keeps the original if the wrapper was the whole thing', () => {
    expect(cleanSketchPrompt('sketch')).toBe('sketch')
  })
  it('handles no leading article after the verb', () => {
    expect(cleanSketchPrompt('sketch cyberpunk city')).toBe('cyberpunk city')
  })
})

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
