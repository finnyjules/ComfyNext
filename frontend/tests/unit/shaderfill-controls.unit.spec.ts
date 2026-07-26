import { describe, it, expect } from 'vitest'
import { SHADER_FILL_CONTROLS, derivedShaderFillControls } from '../../app/lib/shaderfill/controls'
import { getByPath } from '../../app/lib/studio/path'
import { DEFAULT_SHADER_SPEC } from '../../app/lib/spacetype/fillTile'

// EffectParamDef exposes `.uniform` (already `u_`-prefixed, e.g. "u_segments"), not
// `.key` — see EffectParamDef in ~/lib/shaderfx/types. derivedShaderFillControls strips
// the prefix, so `uniform: 'u_segments'` must produce the control key `...params.segments`.
const effect = { id: 'kaleidoscope', name: 'Kaleidoscope', params: [
  { uniform: 'u_segments', label: 'Segments', type: 'float', min: 2, max: 24, default: 6 },
] } as any

describe('shader fill controls', () => {
  it('declares exactly the three frozen keys', () => {
    expect(SHADER_FILL_CONTROLS.map(c => c.key))
      .toEqual(['fill.shader.effectId', 'fill.shader.anchor', 'fill.shader.speed'])
  })
  it('derives one spec per effect param addressed at the real ShaderSpec.params path', () => {
    const d = derivedShaderFillControls(effect, 'fill.shader')
    expect(d.map(c => c.key)).toEqual(['fill.shader.params.segments'])
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

  // Pins the PROPERTY, not just the string: a key that merely equals
  // 'fill.shader.params.segments' would still pass if storage moved out from under it.
  // Walking the dotted path against a real Fill/ShaderSpec object (the same naive
  // traversal makeConfigParams/getByPath use everywhere else) and landing on the
  // actual param value — not undefined — proves the derived key addresses REAL
  // storage, not a schema-only namespace one segment removed from it.
  it('derived keys resolve against real ShaderSpec storage, not a phantom namespace', () => {
    const d = derivedShaderFillControls(effect, 'fill.shader')
    const root = {
      fill: {
        type: 'shader',
        shader: { ...DEFAULT_SHADER_SPEC, params: { segments: 8 } },
      },
    }
    const params: Record<string, number> = root.fill.shader.params
    for (const c of d) {
      const paramId = c.key.split('.').pop()!
      expect(getByPath(root, c.key), c.key).toBe(params[paramId])
      expect(getByPath(root, c.key), c.key).not.toBeUndefined()
    }
    expect(getByPath(root, d[0]!.key)).toBe(8)
  })
})
