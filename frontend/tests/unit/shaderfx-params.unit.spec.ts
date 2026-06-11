import { describe, expect, it } from 'vitest'
import { parseParams, resolveUniforms, serializeParams } from '~/lib/shaderfx/params'
import type { EffectDef } from '~/lib/shaderfx/types'

const eff: EffectDef = {
  id: 'x', name: 'X', category: 'distortion', animated: true, passes: 1,
  centerParam: null, textures: [], source: '',
  params: [
    { uniform: 'u_amount', label: 'Amount', type: 'float', min: 0, max: 0.3, default: 0.06, step: 0.005 },
    { uniform: 'u_scale', label: 'Scale', type: 'float', min: 1, max: 20, default: 4, step: 0.5 },
  ],
}

describe('shaderfx params', () => {
  it('parses bad JSON to empty object', () => {
    expect(parseParams('{nope')).toEqual({})
    expect(parseParams('')).toEqual({})
  })

  it('resolves defaults, clamps overrides, drops unknown keys', () => {
    expect(resolveUniforms(eff, {})).toEqual({ u_amount: 0.06, u_scale: 4 })
    const u = resolveUniforms(eff, { u_amount: 99, u_bogus: 1 })
    expect(u.u_amount).toBe(0.3)
    expect('u_bogus' in u).toBe(false)
  })

  it('serializes only non-default values', () => {
    expect(serializeParams(eff, { u_amount: 0.06, u_scale: 9 })).toBe('{"u_scale":9}')
    expect(serializeParams(eff, { u_amount: 0.06, u_scale: 4 })).toBe('{}')
  })
})
