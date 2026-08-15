import { describe, it, expect } from 'vitest'
import { buildGradientPreset, GRADIENT_PRESET_NAMES } from '~/lib/gradientfx/presets'

describe('simple-gradient authored presets', () => {
  it('dawn / halo / spectrum are offered and resolve to the right layouts', () => {
    for (const n of ['dawn','halo','spectrum']) expect(GRADIENT_PRESET_NAMES).toContain(n)
    expect(buildGradientPreset('dawn', '#a')!.canvas.layout).toBe('ramp')
    expect(buildGradientPreset('halo', '#b')!.canvas.layout).toBe('radialRamp')
    const spectrum = buildGradientPreset('spectrum', '#c')!
    expect(spectrum.canvas.layout).toBe('conic')
    expect(spectrum.layers[0]!.ramp?.closeLoop).toBe(true)
  })
})
