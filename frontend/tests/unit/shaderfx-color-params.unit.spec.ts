import { describe, it, expect } from 'vitest'
import { resolveValues, toUniforms, serializeParams, cleanStops, hexVec3 } from '~/lib/shaderfx/params'
import { resolveEffectParams } from '~/lib/shaderfill/descriptor'
import { derivedShaderFillControls } from '~/lib/shaderfill/controls'
import { normalizeShaderSpec } from '~/lib/spacetype/fillTile'
import type { EffectDef, GradientStop } from '~/lib/shaderfx/types'

const RAMP: GradientStop[] = [
  { pos: 0, color: '#000000' },
  { pos: 1, color: '#ffffff' },
]

function def(): EffectDef {
  return {
    id: 'test', name: 'Test', category: 'color', animated: false, passes: 1,
    centerParam: null, textures: [],
    params: [
      { uniform: 'u_ink', label: 'Ink', type: 'color', default: '#1a1a2e' },
      { uniform: 'u_ramp', label: 'Ramp', type: 'gradient', maxStops: 4, default: RAMP },
      { uniform: 'u_mix', label: 'Mix', type: 'float', min: 0, max: 1, default: 1, step: 0.05 },
    ],
    source: '',
  }
}

describe('colour + gradient param types', () => {
  it('parses hex to a 0..1 vec3', () => {
    expect(hexVec3('#ff0080')).toEqual([1, 0, 128 / 255])
    expect(hexVec3('#fff')).toEqual([1, 1, 1])
  })

  // Found by driving the real picker: StudioColor emits 8-digit #rrggbbaa as
  // soon as its alpha track is touched. Rejecting that sent the param back to
  // its default, so picking a colour silently did nothing.
  it('accepts an 8-digit hex with alpha and drops the alpha', () => {
    expect(hexVec3('#e609f580')).toEqual(hexVec3('#e609f5'))
    const v = resolveValues(def(), { u_ink: '#e609f580' })
    expect(v.u_ink).toBe('#e609f580')
    expect(toUniforms(def(), v).u_ink).toEqual(hexVec3('#e609f5'))
  })

  it('keeps an alpha colour through the descriptor and the persistence boundary', () => {
    expect(resolveEffectParams(def(), { ink: '#e609f580' }).ink).toBe('#e609f580')
    expect(normalizeShaderSpec({ effectId: 'test', params: { ink: '#e609f580' } }, 0).params.ink).toBe('#e609f580')
  })

  it('keeps colours as hex in values, expands to vec3 only in uniforms', () => {
    const v = resolveValues(def(), { u_ink: '#ff0000' })
    expect(v.u_ink).toBe('#ff0000')
    expect(toUniforms(def(), v).u_ink).toEqual([1, 0, 0])
  })

  it('expands a gradient into indexed colour/position uniforms plus a count', () => {
    const u = toUniforms(def(), resolveValues(def(), {}))
    expect(u.u_rampCount).toBe(2)
    expect(u['u_ramp[0]']).toEqual([0, 0, 0])
    expect(u['u_ramp[1]']).toEqual([1, 1, 1])
    expect(u['u_rampPos[0]']).toBe(0)
    expect(u['u_rampPos[1]']).toBe(1)
  })

  it('falls back to the default for a malformed colour or gradient', () => {
    const v = resolveValues(def(), { u_ink: 'not-a-colour', u_ramp: [{ pos: 0, color: 'nope' }, { pos: 1, color: '#fff' }] })
    expect(v.u_ink).toBe('#1a1a2e')
    expect(v.u_ramp).toEqual(RAMP)
  })

  it('sorts and caps stops at maxStops', () => {
    const many = [
      { pos: 1, color: '#111111' }, { pos: 0, color: '#222222' },
      { pos: 0.5, color: '#333333' }, { pos: 0.25, color: '#444444' },
      { pos: 0.75, color: '#555555' },
    ]
    const v = resolveValues(def(), { u_ramp: many }) as { u_ramp: GradientStop[] }
    expect((v.u_ramp as GradientStop[]).map(s => s.pos)).toEqual([0, 0.25, 0.5, 0.75])
  })

  it('clamps stop positions into [0,1]', () => {
    expect(cleanStops([{ pos: -3, color: '#000' }, { pos: 9, color: '#fff' }], 8, RAMP).map(s => s.pos)).toEqual([0, 1])
  })

  it('serializes only non-default values, comparing gradients structurally', () => {
    const d = def()
    expect(serializeParams(d, { u_ink: '#1a1a2e', u_ramp: [...RAMP], u_mix: 1 })).toBe('{}')
    const changed = JSON.parse(serializeParams(d, { u_ink: '#00ff00', u_ramp: [...RAMP], u_mix: 1 }))
    expect(changed).toEqual({ u_ink: '#00ff00' })
  })
})

describe('shader-fill consumers of the new types', () => {
  // The descriptor is the cache identity: two different colours MUST key apart,
  // or a shader fill renders one and serves it for the other with no error.
  it('resolves colour and gradient params under unprefixed keys', () => {
    const r = resolveEffectParams(def(), { ink: '#00ff00' })
    expect(r.ink).toBe('#00ff00')
    expect(r.ramp).toEqual(RAMP)
    expect(r.mix).toBe(1)
  })

  it('normalises stop ORDER so two orderings of one ramp key identically', () => {
    const a = resolveEffectParams(def(), { ramp: [{ pos: 1, color: '#ffffff' }, { pos: 0, color: '#000000' }] })
    const b = resolveEffectParams(def(), { ramp: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('keys two different ramps apart', () => {
    const a = resolveEffectParams(def(), { ramp: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] })
    const b = resolveEffectParams(def(), { ramp: [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#00ff00' }] })
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('derives a colour control as kind:color and OMITS gradients', () => {
    const cs = derivedShaderFillControls(def(), 'fill.shader')
    const ink = cs.find(c => c.key === 'fill.shader.params.ink')
    expect(ink?.kind).toBe('color')
    expect(ink?.default).toBe('#1a1a2e')
    // A gradient has no scalar ControlSpec representation; absent beats lying.
    expect(cs.find(c => c.key === 'fill.shader.params.ramp')).toBeUndefined()
    // And a colour must never fall through to the numeric slider branch.
    expect(cs.every(c => !(c.kind === 'slider' && c.key.endsWith('.ink')))).toBe(true)
  })

  it('survives the persistence boundary — normalizeShaderSpec keeps all three shapes', () => {
    const spec = normalizeShaderSpec({
      effectId: 'test',
      params: { ink: '#ff00ff', ramp: RAMP, mix: 0.5, junk: { nope: true } },
    }, 0)
    expect(spec.params.ink).toBe('#ff00ff')
    expect(spec.params.ramp).toEqual(RAMP)
    expect(spec.params.mix).toBe(0.5)
    expect(spec.params.junk).toBeUndefined()
  })
})
