import { describe, it, expect } from 'vitest'
import { shapeReliefPrompt, DEPTH_MODEL } from '~~/server/utils/scene3dRelief'

describe('scene3d relief generation helpers', () => {
  it('biases the prompt toward a flat, evenly lit material sample', () => {
    const out = shapeReliefPrompt('hammered copper')
    expect(out).toContain('hammered copper')
    expect(out.length).toBeGreaterThan('hammered copper'.length)
  })

  it('returns empty for an empty prompt', () => {
    expect(shapeReliefPrompt('   ')).toBe('')
  })

  it('targets the confirmed live depth-anything-v2 preprocessor endpoint', () => {
    expect(DEPTH_MODEL.app).toBe('fal-ai/image-preprocessors/depth-anything/v2')
  })

  it('builds a depth input carrying the image url under image_url', () => {
    const input = DEPTH_MODEL.buildInput('https://cdn.example/a.png')
    expect(input.image_url).toBe('https://cdn.example/a.png')
    expect(Object.values(input)).toContain('https://cdn.example/a.png')
  })

  it('extracts the height url from a well-formed result', () => {
    expect(DEPTH_MODEL.heightUrlFrom({ image: { url: 'https://cdn.example/d.png' } }))
      .toBe('https://cdn.example/d.png')
  })

  it('returns null rather than throwing on a malformed result', () => {
    expect(DEPTH_MODEL.heightUrlFrom({})).toBeNull()
    expect(DEPTH_MODEL.heightUrlFrom(null)).toBeNull()
    expect(DEPTH_MODEL.heightUrlFrom({ image: {} })).toBeNull()
  })
})
