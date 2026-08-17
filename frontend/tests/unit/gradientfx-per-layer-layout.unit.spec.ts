import { describe, it, expect } from 'vitest'
import { effectiveLayout, ensureConfigDefaults, type GradientConfig } from '~/lib/gradientfx/types'
import { defaultConfig } from '~/lib/gradientfx/randomize'

function twoLayer(): GradientConfig {
  const c = ensureConfigDefaults(defaultConfig('#pll1') as GradientConfig)
  c.canvas.layout = 'ramp'
  c.layers = [c.layers[0]!, { ...structuredClone(c.layers[0]!) }]
  return c
}

describe('effectiveLayout', () => {
  it('returns the layer override when set', () => {
    const c = twoLayer()
    c.layers[1]!.layout = 'radialRamp'
    expect(effectiveLayout(c, 1)).toBe('radialRamp')
  })
  it('falls back to canvas.layout when the layer has no override', () => {
    const c = twoLayer()
    expect(effectiveLayout(c, 0)).toBe('ramp')
    expect(effectiveLayout(c, 1)).toBe('ramp')
  })
  it('falls back to canvas.layout for an out-of-range index', () => {
    const c = twoLayer()
    expect(effectiveLayout(c, 9)).toBe('ramp')
  })
})
