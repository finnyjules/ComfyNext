import { describe, it, expect } from 'vitest'
import { SHADER_FILL_CONTROLS, derivedShaderFillControls } from '../../app/lib/shaderfill/controls'

// EffectParamDef exposes `.uniform` (already `u_`-prefixed, e.g. "u_segments"), not
// `.key` — see EffectParamDef in ~/lib/shaderfx/types. derivedShaderFillControls strips
// the prefix, so `uniform: 'u_segments'` must produce the control key `...p.segments`.
const effect = { id: 'kaleidoscope', name: 'Kaleidoscope', params: [
  { uniform: 'u_segments', label: 'Segments', type: 'float', min: 2, max: 24, default: 6 },
] } as any

describe('shader fill controls', () => {
  it('declares exactly the three frozen keys', () => {
    expect(SHADER_FILL_CONTROLS.map(c => c.key))
      .toEqual(['fill.shader.effectId', 'fill.shader.anchor', 'fill.shader.speed'])
  })
  it('derives one spec per effect param under the reserved namespace', () => {
    const d = derivedShaderFillControls(effect, 'fill.shader')
    expect(d.map(c => c.key)).toEqual(['fill.shader.p.segments'])
    expect(d[0]).toMatchObject({ kind: 'slider', min: 2, max: 24, default: 6 })
  })
  it('derived params are animatable, so motion tracks come free', () => {
    expect(derivedShaderFillControls(effect, 'fill.shader')[0]!.animatable).not.toBe(false)
  })
  it('speed is animatable and anchor is not — anchor is a mode, not a value', () => {
    const byKey = Object.fromEntries(SHADER_FILL_CONTROLS.map(c => [c.key, c]))
    expect(byKey['fill.shader.speed']!.animatable).not.toBe(false)
    expect(byKey['fill.shader.anchor']!.animatable).toBe(false)
  })
})
