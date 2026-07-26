import { describe, it, expect } from 'vitest'
import {
  type Fill, FILL_TYPES, DEFAULT_FILL, DEFAULT_SHADER_SPEC,
  normalizeFill, parseFills, serializeFills, fillIsShader, effectiveTileFill,
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

  it('coerces a non-finite speed (NaN/Infinity) to the default rather than letting it through', () => {
    expect(normalizeFill({ type: 'shader', shader: { ...DEFAULT_SHADER_SPEC, speed: NaN } }).shader!.speed).toBe(1)
    expect(normalizeFill({ type: 'shader', shader: { ...DEFAULT_SHADER_SPEC, speed: Infinity } }).shader!.speed).toBe(1)
  })

  it('round-trips through serializeFills/parseFills (the save/reload path)', () => {
    const original = shaderFill({
      shader: { effectId: 'kaleidoscope', params: { segments: 6 }, anchor: 'frame', speed: 0.5,
                input: { ...DEFAULT_FILL, type: 'gradient', a: '#ff0000' } },
    })
    const [back] = parseFills(serializeFills([original]))
    expect(back).toEqual(original)
  })
})

describe('effectiveTileFill (graceful degradation for the CPU tile builders)', () => {
  it('passes a non-shader fill through unchanged', () => {
    const f: Fill = { ...DEFAULT_FILL, type: 'grid' }
    expect(effectiveTileFill(f)).toBe(f)
  })

  it('resolves a shader fill to its input fill', () => {
    const input: Fill = { ...DEFAULT_FILL, type: 'gradient', a: '#ff0000', b: '#00ff00' }
    const f = shaderFill({ shader: { ...DEFAULT_SHADER_SPEC, input } })
    expect(effectiveTileFill(f)).toEqual(input)
  })

  it('falls back to the default shader input when `shader` is absent, rather than throwing', () => {
    const f: Fill = { ...DEFAULT_FILL, type: 'shader' } // shader missing
    expect(() => effectiveTileFill(f)).not.toThrow()
    expect(effectiveTileFill(f)).toEqual(DEFAULT_SHADER_SPEC.input)
  })

  it('never returns a shader-typed fill, even if a malformed input slipped past normalizeFill', () => {
    const malformed = { ...DEFAULT_FILL, type: 'shader', shader: { ...DEFAULT_SHADER_SPEC } } as Fill
    // simulate a bypass of the depth-1 guard: input is itself (bogusly) typed 'shader'
    ;(malformed.shader as any).input = { ...DEFAULT_FILL, type: 'shader', shader: { ...DEFAULT_SHADER_SPEC } }
    expect(effectiveTileFill(malformed).type).not.toBe('shader')
  })
})
