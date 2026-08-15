import { describe, it, expect } from 'vitest'
import { defaultConfig, stripeConfig } from '~/lib/gradientfx/randomize'
import { buildGradientPreset } from '~/lib/gradientfx/presets'

describe('simple-gradient defaults', () => {
  it('a fresh document opens on the simple Linear ramp', () => {
    const c = defaultConfig('#fresh001')
    expect(c.canvas.layout).toBe('ramp')
    expect(c.layers[0]!.ramp).toBeTruthy()
    expect(c.layers[0]!.color.stops.length).toBeGreaterThanOrEqual(2)
  })

  it('stripeConfig still produces the stripe archetype', () => {
    expect(stripeConfig('#stripe01').canvas.layout).toBe('linear')
  })

  it('the linear PRESET still yields a stripe layout (repointed, not the new default)', () => {
    expect(buildGradientPreset('linear', '#p1')!.canvas.layout).toBe('linear')
  })
})
