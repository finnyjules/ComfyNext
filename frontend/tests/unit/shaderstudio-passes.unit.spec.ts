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

describe('composePasses', () => {
  it('returns [] when nothing is enabled and no effect picked', () => {
    const c = defaultConfig() // effect.id '' , all passes disabled
    expect(composePasses(c, null, 0)).toEqual([])
  })

  it('includes the effect pass with resolved uniforms when enabled', () => {
    const c = defaultConfig()
    c.effect = { id: 'halftone', params: { u_size: 6 }, enabled: true }
    const passes = composePasses(c, fakeEffect, 0.5)
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
    const passes = composePasses(c, null, 0) // no effect
    expect(passes.map(p => p.id)).toEqual(['studio:duotone', 'studio:adjust', 'studio:blur', 'studio:chromatic'])
    const duo = passes[0]!
    expect(duo.uniforms.u_ink_r).toBe(0)
    expect(duo.uniforms.u_paper_r).toBe(1)
  })

  it('expands a multi-pass effect into N passes', () => {
    const c = defaultConfig()
    c.effect = { id: 'bloom', params: {}, enabled: true }
    const bloom: EffectDef = { ...fakeEffect, id: 'bloom', passes: 3, params: [] }
    const passes = composePasses(c, bloom, 0)
    expect(passes).toHaveLength(3)
    expect(passes.every(p => p.id === 'bloom')).toBe(true)
  })
})
