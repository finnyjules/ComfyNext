import { describe, it, expect } from 'vitest'
import { SURFACES, getSurface } from '~~/shared/template-grid/generate/surfaces'
import { makeRng } from '~~/shared/template-grid/generate/rng'

describe('surfaces', () => {
  it('registers flat, holographic, tint, split-field and duotone-photo', () => {
    expect(SURFACES.map(s => s.id).sort()).toEqual(
      ['duotone-photo', 'flat', 'holographic', 'split-field', 'tint'])
  })
  it('procedural surfaces set a fill and a contrast, no image', () => {
    for (const s of SURFACES.filter(s => s.kind === 'procedural')) {
      const r = s.apply({ rng: makeRng(1), knobs: {} })
      expect(r.background.fill).toBeTruthy()
      expect(['light', 'dark']).toContain(r.contrast)
    }
  })
  it('duotone-photo needs an image and uses it', () => {
    const duo = getSurface('duotone-photo')!
    expect(duo.needsImage).toBe(true)
    const r = duo.apply({ rng: makeRng(1), knobs: {}, image: '/view?filename=x.png&type=input' })
    expect(r.background.image).toContain('x.png')
  })
  it('is deterministic per seed', () => {
    const holo = getSurface('holographic')!
    expect(holo.apply({ rng: makeRng(2), knobs: {} })).toEqual(holo.apply({ rng: makeRng(2), knobs: {} }))
  })
})
