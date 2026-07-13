import { describe, it, expect } from 'vitest'
import { sketchPadPromptOverrides } from '~/lib/sketch/sketchPadPrompt'

describe('sketchPadPromptOverrides', () => {
  it('builds a schnell 4-up webp override bundle carrying the prompt + seed', () => {
    const b = sketchPadPromptOverrides('a lighthouse at dusk', 42)
    expect(b.widgetOverrides.model).toBe('flux-schnell')
    expect(b.widgetOverrides.prompt).toBe('a lighthouse at dusk')
    expect(b.widgetOverrides.seed).toBe(42)
    expect(JSON.parse(b.widgetOverrides.model_options as string)).toMatchObject({
      megapixels: '0.25', num_outputs: 4, output_format: 'webp',
    })
    // The transient node is a pad, not a user-facing sketch node.
    expect(b.propertyOverrides.sketchPad).toBe(true)
  })
})
