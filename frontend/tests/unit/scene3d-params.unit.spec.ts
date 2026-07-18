import { describe, it, expect } from 'vitest'
import { PRIMITIVE_PARAMS, paramValue, sanitizeParams, MODIFIER_SPECS, modifierValue, resolveParam, sanitizeBag } from '~/lib/scene3d/primParams'
import { PRIMITIVE_KINDS } from '~/lib/scene3d/config'

describe('scene3d primitive params', () => {
  it('has a spec list for every primitive kind', () => {
    expect(Object.keys(PRIMITIVE_PARAMS).sort()).toEqual([...PRIMITIVE_KINDS].sort())
  })

  it('gives every spec a default inside its own range and a unique key', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const specs = PRIMITIVE_PARAMS[kind]
      expect(specs.length, `${kind} has no params`).toBeGreaterThan(0)
      const keys = specs.map((s) => s.key)
      expect(new Set(keys).size, `${kind} has duplicate keys`).toBe(keys.length)
      for (const s of specs) {
        expect(s.default, `${kind}.${s.key} default below min`).toBeGreaterThanOrEqual(s.min)
        expect(s.default, `${kind}.${s.key} default above max`).toBeLessThanOrEqual(s.max)
        expect(s.min).toBeLessThan(s.max)
        expect(s.step).toBeGreaterThan(0)
        expect(s.hint.length, `${kind}.${s.key} needs a tooltip hint`).toBeGreaterThan(0)
      }
    }
  })

  it('resolves a stored value, falls back to the default, and clamps', () => {
    expect(paramValue('sphere', { detail: 12 }, 'detail')).toBe(12)
    expect(paramValue('sphere', undefined, 'detail')).toBe(48)
    expect(paramValue('sphere', {}, 'arc')).toBe(360)
    expect(paramValue('sphere', { detail: 9999 }, 'detail')).toBe(64)
    expect(paramValue('sphere', { detail: -5 }, 'detail')).toBe(4)
    expect(paramValue('sphere', { detail: Number.NaN }, 'detail')).toBe(48)
  })

  it('throws on a param key the kind does not have', () => {
    expect(() => paramValue('sphere', undefined, 'cornerRadius')).toThrow()
  })

  it('sanitizes: drops unknown and non-finite keys, clamps, keeps absent absent', () => {
    expect(sanitizeParams('sphere', undefined)).toBeUndefined()
    expect(sanitizeParams('sphere', {})).toBeUndefined()
    expect(sanitizeParams('sphere', { nope: 3 })).toBeUndefined()
    expect(sanitizeParams('sphere', { detail: 'big' })).toBeUndefined()
    expect(sanitizeParams('sphere', { detail: Number.POSITIVE_INFINITY })).toBeUndefined()
    expect(sanitizeParams('sphere', { detail: 16, nope: 3 })).toEqual({ detail: 16 })
    expect(sanitizeParams('sphere', { detail: 9999 })).toEqual({ detail: 64 })
  })

  it('gives the box a corner radius and the polyhedra a subdivision detail', () => {
    expect(PRIMITIVE_PARAMS.box.map((s) => s.key)).toEqual(['cornerRadius', 'cornerSides'])
    expect(paramValue('box', undefined, 'cornerRadius')).toBe(0)
    expect(paramValue('icosahedron', undefined, 'detail')).toBe(0)
    expect(paramValue('icosahedron', { detail: 2 }, 'detail')).toBe(2)
  })

  it('models the open-ended flag as a 0/1 toggle so params stay numeric', () => {
    const spec = PRIMITIVE_PARAMS.cylinder.find((s) => s.key === 'openEnded')!
    expect(spec.control).toBe('toggle')
    expect(spec.min).toBe(0)
    expect(spec.max).toBe(1)
    expect(spec.default).toBe(0)
  })
})

describe('scene3d modifier specs', () => {
  it('describes every modifier with a hint, a sane range and a unique key', () => {
    const keys = MODIFIER_SPECS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const s of MODIFIER_SPECS) {
      expect(s.hint.length, `${s.key} needs a tooltip hint`).toBeGreaterThan(0)
      expect(s.min).toBeLessThan(s.max)
      expect(s.step).toBeGreaterThan(0)
      expect(s.default).toBeGreaterThanOrEqual(s.min)
      expect(s.default).toBeLessThanOrEqual(s.max)
      if (s.control === 'options') {
        expect(s.options, `${s.key} needs options`).toBeTruthy()
        expect(s.options!.length).toBeGreaterThan(1)
        // options are stored as an index, so the range must cover them exactly
        expect(s.min).toBe(0)
        expect(s.max).toBe(s.options!.length - 1)
      }
    }
  })

  it('defaults every modifier to its identity so a fresh object is undeformed', () => {
    for (const key of ['subdivide', 'taper', 'twist', 'bend', 'noise']) {
      expect(modifierValue(undefined, key), `${key} must default to 0`).toBe(0)
    }
    expect(modifierValue(undefined, 'arrayCount')).toBe(1)
  })

  it('covers the documented modifier set', () => {
    expect(MODIFIER_SPECS.map((s) => s.key)).toEqual([
      'subdivide',
      'taper', 'taperAxis',
      'twist', 'twistAxis',
      'bend', 'bendAxis',
      'noise', 'noiseScale', 'noiseSeed',
      'arrayCount', 'arrayMode', 'arrayOffsetX', 'arrayOffsetY', 'arrayOffsetZ', 'arrayRadius', 'arrayAxis',
    ])
  })

  it('resolves and sanitizes modifier bags like param bags', () => {
    expect(modifierValue({ twist: 90 }, 'twist')).toBe(90)
    expect(modifierValue({ twist: 9999 }, 'twist')).toBe(360)
    expect(sanitizeBag(MODIFIER_SPECS, { twist: 90, nope: 1 })).toEqual({ twist: 90 })
    expect(sanitizeBag(MODIFIER_SPECS, {})).toBeUndefined()
  })

  it('keeps the generic resolver and the param-specific wrapper in agreement', () => {
    expect(resolveParam(PRIMITIVE_PARAMS.sphere, { detail: 12 }, 'detail'))
      .toBe(paramValue('sphere', { detail: 12 }, 'detail'))
    expect(sanitizeBag(PRIMITIVE_PARAMS.sphere, { detail: 12, nope: 1 }))
      .toEqual(sanitizeParams('sphere', { detail: 12, nope: 1 }))
  })
})
