import { describe, it, expect } from 'vitest'
import {
  type Fill, FILL_TYPES, DEFAULT_FILL, DEFAULT_SHADER_SPEC,
  normalizeFill, parseFills, fillIsShader,
} from '~/lib/spacetype/fillTile'

const shaderFill = (over: Partial<Fill> = {}): Fill => ({
  ...DEFAULT_FILL, type: 'shader', shader: { ...DEFAULT_SHADER_SPEC }, ...over,
})

describe('shader fill model', () => {
  it('shader is the ninth fill type, appended so picker order is stable', () => {
    expect(FILL_TYPES).toEqual(['solid','gradient','ombre','grid','noise','checkerboard','stripes','qr','shader'])
  })

  it('fillIsShader narrows only a shader fill carrying a spec', () => {
    expect(fillIsShader(shaderFill())).toBe(true)
    expect(fillIsShader({ ...DEFAULT_FILL })).toBe(false)
    expect(fillIsShader({ ...DEFAULT_FILL, type: 'shader' })).toBe(false) // type without spec
  })

  it('normalizeFill fills a default spec when type is shader but spec is missing', () => {
    const n = normalizeFill({ type: 'shader' })
    expect(n.type).toBe('shader')
    expect(n.shader).toEqual(DEFAULT_SHADER_SPEC)
  })

  it('normalizeFill drops a spec when the type is not shader', () => {
    const n = normalizeFill({ type: 'grid', shader: { ...DEFAULT_SHADER_SPEC } })
    expect(n.shader).toBeUndefined()
  })

  it('enforces depth-1: a nested shader input collapses to its own input', () => {
    const nested = normalizeFill({
      type: 'shader',
      shader: { ...DEFAULT_SHADER_SPEC, input: { ...DEFAULT_FILL, type: 'shader', shader: { ...DEFAULT_SHADER_SPEC } } },
    })
    expect(nested.shader!.input.type).not.toBe('shader')
    expect(nested.shader!.input.shader).toBeUndefined()
  })

  it('coerces a junk spec rather than throwing', () => {
    const n = normalizeFill({ type: 'shader', shader: { effectId: 42, anchor: 'sideways', speed: 'fast', params: null } })
    expect(n.shader!.effectId).toBe(DEFAULT_SHADER_SPEC.effectId)
    expect(n.shader!.anchor).toBe('object')
    expect(typeof n.shader!.speed).toBe('number')
    expect(n.shader!.params).toEqual({})
  })

  it('round-trips through parseFills (the save/reload path)', () => {
    const original = shaderFill({
      shader: { effectId: 'kaleidoscope', params: { segments: 6 }, anchor: 'frame', speed: 0.5,
                input: { ...DEFAULT_FILL, type: 'gradient', a: '#ff0000' } },
    })
    const [back] = parseFills(JSON.stringify([original]))
    expect(back).toEqual(original)
  })
})
