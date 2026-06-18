import { describe, it, expect } from 'vitest'
import { elasticEffect } from '../../app/lib/spacetype/effects/elastic'
import { defaultsFromControls } from '../../app/lib/spacetype/effect'
import { ELASTIC_MODES } from '../../app/lib/spacetype/elasticMath'
import { SPACE_TYPE_EFFECTS, getEffect } from '../../app/lib/spacetype/effects/index'

describe('elasticEffect contract', () => {
  it('has id, label, and a textList + a fillList control', () => {
    expect(elasticEffect.id).toBe('elastic')
    expect(elasticEffect.label).toBe('Elastic')
    expect(elasticEffect.controls.some(c => c.kind === 'textList')).toBe(true)
    expect(elasticEffect.controls.some(c => c.kind === 'fillList')).toBe(true)
  })

  it('exposes a mode select listing all five modes', () => {
    const mode = elasticEffect.controls.find(c => c.key === 'mode')
    expect(mode?.kind).toBe('select')
    expect(mode && 'options' in mode ? mode.options : []).toEqual([...ELASTIC_MODES])
  })

  it('declares the skew + motion controls', () => {
    const keys = elasticEffect.controls.map(c => c.key)
    for (const k of ['textSkew', 'lineSkew', 'lineStagger', 'intensity', 'stretch', 'shear', 'waveLength', 'speed']) {
      expect(keys).toContain(k)
    }
  })

  it('defaultsFromControls round-trips (mode defaults to Wave)', () => {
    const d = defaultsFromControls(elasticEffect.controls)
    expect(d.mode).toBe('Wave')
    expect(typeof d.intensity).toBe('number')
  })
})

describe('elastic registration', () => {
  it('is registered in the picker and resolvable by id', () => {
    expect(SPACE_TYPE_EFFECTS.some(e => e.id === 'elastic')).toBe(true)
    expect(getEffect('elastic').label).toBe('Elastic')
  })
})
