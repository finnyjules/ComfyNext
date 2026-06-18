import { describe, it, expect } from 'vitest'
import { elasticEffect } from '../../app/lib/spacetype/effects/elastic'
import { defaultsFromControls } from '../../app/lib/spacetype/effect'
import { SPACE_TYPE_EFFECTS, getEffect } from '../../app/lib/spacetype/effects/index'

describe('elasticEffect contract', () => {
  it('has id, label, and a textList + a fillList control', () => {
    expect(elasticEffect.id).toBe('elastic')
    expect(elasticEffect.label).toBe('Elastic')
    expect(elasticEffect.controls.some(c => c.kind === 'textList')).toBe(true)
    expect(elasticEffect.controls.some(c => c.kind === 'fillList')).toBe(true)
  })

  it('declares the stretch / skew / warp controls', () => {
    const keys = elasticEffect.controls.map(c => c.key)
    for (const k of [
      'base', 'ampV', 'ampH', 'randomness', 'speed',
      'baseSkew', 'ampSkew', 'baseSlant', 'ampSlant',
      'warp', 'warpScale', 'polygonal', 'fitWidth', 'lineTight', 'scale',
    ]) {
      expect(keys).toContain(k)
    }
  })

  it('defaultsFromControls round-trips (static base stretch = 1, fit off)', () => {
    const d = defaultsFromControls(elasticEffect.controls)
    expect(d.base).toBe(1)
    expect(d.fitWidth).toBe('off')
    expect(typeof d.warp).toBe('number')
  })
})

describe('elastic registration', () => {
  it('is registered in the picker and resolvable by id', () => {
    expect(SPACE_TYPE_EFFECTS.some(e => e.id === 'elastic')).toBe(true)
    expect(getEffect('elastic').label).toBe('Elastic')
  })
})
