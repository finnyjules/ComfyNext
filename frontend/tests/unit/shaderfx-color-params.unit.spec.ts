import { describe, it, expect } from 'vitest'
import { resolveValues, toUniforms, serializeParams, cleanStops, serializeStops, hexVec3 } from '~/lib/shaderfx/params'
import { resolveEffectParams } from '~/lib/shaderfill/descriptor'
import { derivedShaderFillControls } from '~/lib/shaderfill/controls'
import { normalizeShaderSpec } from '~/lib/spacetype/fillTile'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'
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

  it('derives a colour as kind:color and a gradient as kind:gradientStops', () => {
    const cs = derivedShaderFillControls(def(), 'fill.shader')
    const ink = cs.find(c => c.key === 'fill.shader.params.ink')
    expect(ink?.kind).toBe('color')
    expect(ink?.default).toBe('#1a1a2e')
    expect(cs.find(c => c.key === 'fill.shader.params.ramp')?.kind).toBe('gradientStops')
    // Neither may fall through to the numeric slider branch — that branch is the
    // `else`, so a missing case here renders a hex string as a 0..1 slider.
    expect(cs.every(c => c.kind !== 'slider' || !/\.(ink|ramp)$/.test(c.key))).toBe(true)
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

// A `gradientStops` ControlSpec stores JSON text (ParamValue is scalar), while a
// studio's own picker writes an array. These MUST resolve — and therefore key —
// identically, or a ramp set by the agent renders differently from the same ramp
// set by hand. That equivalence is the whole reason cleanStops takes both.
describe('gradient: array and JSON text are one value', () => {
  const RAMP3: GradientStop[] = [
    { pos: 0, color: '#06283d' },
    { pos: 0.5, color: '#256d85' },
    { pos: 1, color: '#47b5ff' },
  ]

  it('cleanStops normalizes an array and its JSON text to the same list', () => {
    const fromArray = cleanStops(RAMP3, 8, [])
    const fromText = cleanStops(JSON.stringify(RAMP3), 8, [])
    expect(fromText).toEqual(fromArray)
  })

  it('produces the SAME descriptor key either way', () => {
    const a = resolveEffectParams(def(), { ramp: RAMP3 })
    const b = resolveEffectParams(def(), { ramp: JSON.stringify(RAMP3) })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('produces the SAME uniforms either way', () => {
    const a = toUniforms(def(), resolveValues(def(), { u_ramp: RAMP3 }))
    const b = toUniforms(def(), resolveValues(def(), { u_ramp: JSON.stringify(RAMP3) }))
    expect(a).toEqual(b)
  })

  it('falls back on unparseable text rather than throwing', () => {
    expect(cleanStops('{not json', 8, RAMP)).toEqual(RAMP)
    expect(cleanStops('"a string"', 8, RAMP)).toEqual(RAMP)
  })

  it('treats the text spelling of the default as the default when serializing', () => {
    const d = def()
    expect(serializeParams(d, { u_ramp: serializeStops(RAMP) })).toBe('{}')
  })
})

describe('gradient: agent vocabulary', () => {
  const control = () => derivedShaderFillControls(def(), 'fill.shader')
    .find(c => c.key === 'fill.shader.params.ramp')!

  it('derives a gradientStops control carrying its stop cap', () => {
    const c = control()
    expect(c.kind).toBe('gradientStops')
    expect((c as { maxStops?: number }).maxStops).toBe(4)
    // A ramp has no float sweep — it must not offer a motion track.
    expect((c as { animatable?: boolean }).animatable).toBe(false)
  })

  it('is offered to the agent, with the stop format spelled out', () => {
    const d = describeControls([control()], {})
    expect(d).toHaveLength(1)
    expect(d[0]!.kind).toBe('gradientStops')
    expect(d[0]!.hint).toMatch(/pos/)
    expect(d[0]!.maxStops).toBe(4)
  })

  it('accepts a well-formed ramp from the agent and re-serializes it canonically', () => {
    const d = describeControls([control()], {})
    const patch = validatePatch({
      'fill.shader.params.ramp': '[{"pos":1,"color":"#ff9900"},{"pos":0,"color":"#220044"}]',
    }, d)
    // Sorted on the way in, so the agent's ordering cannot create a second key.
    expect(patch['fill.shader.params.ramp'])
      .toBe(serializeStops([{ pos: 0, color: '#220044' }, { pos: 1, color: '#ff9900' }]))
  })

  it('drops a malformed ramp entirely rather than applying it in part', () => {
    const d = describeControls([control()], {})
    expect(validatePatch({ 'fill.shader.params.ramp': '[{"pos":0,"color":"nope"},{"pos":1,"color":"#fff"}]' }, d)).toEqual({})
    expect(validatePatch({ 'fill.shader.params.ramp': '[{"pos":0,"color":"#000"}]' }, d)).toEqual({})
    expect(validatePatch({ 'fill.shader.params.ramp': 'not json' }, d)).toEqual({})
  })

  it('accepts an 8-digit colour from the agent (StudioColor emits them)', () => {
    const d = describeControls([{ key: 'ink', label: 'Ink', kind: 'color', default: '#000000', group: 'g' }], {})
    expect(validatePatch({ ink: '#e609f580' }, d)).toEqual({ ink: '#e609f580' })
  })
})
