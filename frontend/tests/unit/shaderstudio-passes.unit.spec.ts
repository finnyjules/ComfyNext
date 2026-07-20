// frontend/tests/unit/shaderstudio-passes.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { composePasses } from '~/lib/shaderstudio/passes'
import { defaultConfig } from '~/lib/shaderstudio/types'
import type { EffectDef } from '~/lib/shaderfx/types'

const fakeEffect: EffectDef = {
  id: 'halftone', name: 'Halftone', category: 'stylize', animated: false, passes: 1,
  centerParam: null, textures: [],
  params: [{ uniform: 'u_size', label: 'Size', type: 'float', min: 1, max: 10, default: 4, step: 1 }],
  source: 'EFFECT_SRC',
}

// composePasses now takes a resolveDef: (id) => EffectDef | null. For configs with no
// enabled effect the loop never calls it, so `() => null` is a safe stand-in there.
const noDef = () => null

describe('composePasses', () => {
  it('returns [] when nothing is enabled and no effect picked', () => {
    const c = defaultConfig() // effects[0].id '' , all stages disabled
    expect(composePasses(c, noDef, 0)).toEqual([])
  })

  it('includes the effect pass with resolved uniforms when enabled', () => {
    const c = defaultConfig()
    c.effects = [{ layerId: 'L0', id: 'halftone', params: { u_size: 6 }, enabled: true, blend: 'normal', opacity: 1 }]
    const passes = composePasses(c, () => fakeEffect, 0.5)
    expect(passes).toHaveLength(1)
    expect(passes[0]!.id).toBe('halftone')
    expect(passes[0]!.uniforms.u_size).toBe(6)
    expect(passes[0]!.uniforms.u_time).toBe(0.5)
    expect(passes[0]!.uniforms.u_hasInput).toBe(1)
  })

  it('appends duotone/adjust/blur/chromatic in order, splitting colors to _r/_g/_b', () => {
    const c = defaultConfig()
    c.duotone = { enabled: true, ink: '#000000', paper: '#ffffff' }
    c.adjust.enabled = true
    c.post.blur.enabled = true
    c.post.chromatic.enabled = true
    const passes = composePasses(c, noDef, 0) // no effect
    expect(passes.map(p => p.id)).toEqual(['studio:duotone', 'studio:adjust', 'studio:blur', 'studio:chromatic'])
    const duo = passes[0]!
    expect(duo.uniforms.u_ink_r).toBe(0)
    expect(duo.uniforms.u_paper_r).toBe(1)
  })

  it('appends bloom last with its uniforms when enabled', () => {
    const c = defaultConfig()
    c.post.chromatic.enabled = true
    c.post.bloom = { enabled: true, threshold: 0.6, intensity: 1.2, radius: 80 }
    const passes = composePasses(c, noDef, 0)
    expect(passes.map(p => p.id)).toEqual(['studio:chromatic', 'studio:bloom'])
    const bloom = passes[passes.length - 1]!
    expect(bloom.uniforms.u_threshold).toBe(0.6)
    expect(bloom.uniforms.u_intensity).toBe(1.2)
    expect(bloom.uniforms.u_radius).toBe(80)
  })

  it('appends a gradient-map pass with pos-sorted stop uniforms when enabled', () => {
    const c = defaultConfig()
    ;(c as any).gradientMap = { enabled: true, mix: 0.8, stops: [
      { pos: 1, color: '#ffffff' },
      { pos: 0, color: '#000000' },
      { pos: 0.5, color: '#ff0000' },
    ] }
    const passes = composePasses(c, noDef, 0)
    expect(passes.map(p => p.id)).toEqual(['studio:gradientMap'])
    const u = passes[0]!.uniforms
    expect(u.u_gm_n).toBe(3)
    expect(u.u_gm_mix).toBe(0.8)
    expect(u['u_gm_pos[0]']).toBe(0)
    expect(u['u_gm_pos[1]']).toBe(0.5)
    expect(u['u_gm_pos[2]']).toBe(1)
    expect(u['u_gm_r[0]']).toBe(0)   // black
    expect(u['u_gm_r[1]']).toBe(1)   // red
    expect(u['u_gm_g[1]']).toBe(0)
    expect(u['u_gm_r[2]']).toBe(1)   // white
  })

  it('caps the gradient map at 8 stops', () => {
    const c = defaultConfig()
    ;(c as any).gradientMap = { enabled: true, mix: 1, stops: Array.from({ length: 12 }, (_, i) => ({ pos: i / 11, color: '#808080' })) }
    const passes = composePasses(c, noDef, 0)
    expect(passes[0]!.uniforms.u_gm_n).toBe(8)
    expect(passes[0]!.uniforms['u_gm_pos[8]']).toBeUndefined()
  })

  it('expands a multi-pass effect into N passes', () => {
    const c = defaultConfig()
    c.effects = [{ layerId: 'L0', id: 'bloom', params: {}, enabled: true, blend: 'normal', opacity: 1 }]
    const bloom: EffectDef = { ...fakeEffect, id: 'bloom', passes: 3, params: [] }
    const passes = composePasses(c, () => bloom, 0)
    expect(passes).toHaveLength(3)
    expect(passes.every(p => p.id === 'bloom')).toBe(true)
  })
})
