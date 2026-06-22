import { describe, expect, it } from 'vitest'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { TEXTURE_SECTIONS } from '~/lib/texturefx/sections'

describe('texturefx controls', () => {
  it('defaults include every control key plus seed', () => {
    const d = textureDefaults()
    for (const c of TEXTURE_CONTROLS) expect(d[c.key]).toBe(c.default)
    expect(d.seed).toBe(1)
  })

  it('every control group is in the section allow-list', () => {
    const allowed = new Set<string>(TEXTURE_SECTIONS)
    for (const c of TEXTURE_CONTROLS) {
      expect(c.group, `control "${c.key}" has group "${c.group}"`).toBeDefined()
      expect(allowed.has(String(c.group)), `group "${c.group}" not in TEXTURE_SECTIONS`).toBe(true)
    }
  })

  it('select defaults are valid options', () => {
    for (const c of TEXTURE_CONTROLS) {
      if (c.kind === 'select') expect(c.options).toContain(c.default)
    }
  })

  it('procedural and truchet controls are mutually exclusive via `when`', () => {
    const proc = textureDefaults()
    const tru = { ...textureDefaults(), mode: 'truchet' }
    const motif = TEXTURE_CONTROLS.find((c) => c.key === 'motif')!
    const family = TEXTURE_CONTROLS.find((c) => c.key === 'tileFamily')!
    expect(motif.when!(proc)).toBe(true)
    expect(motif.when!(tru)).toBe(false)
    expect(family.when!(proc)).toBe(false)
    expect(family.when!(tru)).toBe(true)
  })

  it('lattice and color controls have no `when` (always visible)', () => {
    for (const key of ['lattice', 'cells', 'colorA', 'colorB', 'background', 'mode']) {
      expect(TEXTURE_CONTROLS.find((c) => c.key === key)!.when).toBeUndefined()
    }
  })

  it('placement shows only in truchet; rotBias↔coherence swap by placement', () => {
    const proc = textureDefaults()
    const truRandom = { ...textureDefaults(), mode: 'truchet', placement: 'random' }
    const truStructured = { ...textureDefaults(), mode: 'truchet', placement: 'structured' }
    const placement = TEXTURE_CONTROLS.find((c) => c.key === 'placement')!
    const rotBias = TEXTURE_CONTROLS.find((c) => c.key === 'rotBias')!
    const coherence = TEXTURE_CONTROLS.find((c) => c.key === 'coherence')!
    expect(placement.when!(proc)).toBe(false)
    expect(placement.when!(truRandom)).toBe(true)
    expect(rotBias.when!(truRandom)).toBe(true)
    expect(rotBias.when!(truStructured)).toBe(false)
    expect(coherence.when!(truStructured)).toBe(true)
    expect(coherence.when!(truRandom)).toBe(false)
  })

  it('defaults pick up placement and coherence', () => {
    const d = textureDefaults()
    expect(d.placement).toBe('random')
    expect(d.coherence).toBe(0.6)
  })

  it('subdivide shows only for multiscale; placement hidden for multiscale', () => {
    const tru = { ...textureDefaults(), mode: 'truchet' }
    const multi = { ...textureDefaults(), mode: 'truchet', tileFamily: 'multiscale' }
    const subdivide = TEXTURE_CONTROLS.find((c) => c.key === 'subdivide')!
    const placement = TEXTURE_CONTROLS.find((c) => c.key === 'placement')!
    expect(subdivide.when!(tru)).toBe(false)
    expect(subdivide.when!(multi)).toBe(true)
    expect(placement.when!(multi)).toBe(false)
    expect(placement.when!(tru)).toBe(true)
  })

  it('multiscale is a valid tileFamily option with a default', () => {
    const fam = TEXTURE_CONTROLS.find((c) => c.key === 'tileFamily')!
    expect(fam.kind === 'select' && fam.options.includes('multiscale')).toBe(true)
    expect(textureDefaults().subdivide).toBe(0.5)
  })
})
