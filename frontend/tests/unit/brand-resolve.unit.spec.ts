// frontend/tests/unit/brand-resolve.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { effectiveBrand, brandLogoUrl } from '../../shared/brand/resolve'

describe('effectiveBrand', () => {
  const templateDefaults = { primary: '#111111', fontDisplay: 'Poppins', background: '#000000' }
  const activeKit = { primary: '#E2362B', accent: '#A3E635' }
  const wired = { accent: '#FF00FF' }

  it('merge order: template ← active kit ← wired', () => {
    const b = effectiveBrand(templateDefaults, activeKit, wired)
    expect(b.primary).toBe('#E2362B')      // kit over template
    expect(b.accent).toBe('#FF00FF')       // wired over kit
    expect(b.fontDisplay).toBe('Poppins')  // template survives where kit is silent
    expect(b.background).toBe('#000000')
  })
  it('strips undefined and empty-string values so partial kits inherit', () => {
    const b = effectiveBrand(templateDefaults, { primary: '', fontDisplay: undefined, accent: '#A3E635' })
    expect(b.primary).toBe('#111111')      // empty string does NOT clobber
    expect(b.fontDisplay).toBe('Poppins')  // undefined does NOT clobber
    expect(b.accent).toBe('#A3E635')
  })
  it('all arguments optional; no kit ⇒ template defaults verbatim', () => {
    expect(effectiveBrand(templateDefaults)).toEqual(templateDefaults)
    expect(effectiveBrand()).toEqual({})
    expect(effectiveBrand(undefined, activeKit)).toEqual(activeKit)
  })
  it('does not mutate its inputs', () => {
    const t = { ...templateDefaults }
    effectiveBrand(t, activeKit, wired)
    expect(t).toEqual(templateDefaults)
  })
})

describe('logos + assets extensions', () => {
  it('brandLogoUrl: slot wins, legacy logo is the primary fallback', () => {
    expect(brandLogoUrl({ logo: '/view?filename=old.png&type=input' })).toBe('/view?filename=old.png&type=input')
    expect(brandLogoUrl({ logo: '/view?filename=old.png&type=input', logos: { primary: '/view?filename=new.png&type=input' } }))
      .toBe('/view?filename=new.png&type=input')
    expect(brandLogoUrl({ logo: '/view?filename=old.png&type=input' }, 'mark')).toBeUndefined()
    expect(brandLogoUrl({ logos: { mark: '/view?filename=m.png&type=input' } }, 'mark')).toBe('/view?filename=m.png&type=input')
    expect(brandLogoUrl(undefined)).toBeUndefined()
  })
  it('effectiveBrand merges logos per-slot across layers', () => {
    const b = effectiveBrand(
      { logos: { primary: '/t-p.png', mark: '/t-m.png' } },
      { logos: { primary: '/k-p.png' } },
    )
    expect(b.logos).toEqual({ primary: '/k-p.png', mark: '/t-m.png' })
  })
  it('effectiveBrand back-fills legacy logo from logos.primary', () => {
    expect(effectiveBrand(undefined, { logos: { primary: '/k-p.png' } }).logo).toBe('/k-p.png')
    // explicit legacy logo is NOT clobbered
    expect(effectiveBrand(undefined, { logo: '/old.png', logos: { mark: '/m.png' } }).logo).toBe('/old.png')
  })
  it('effectiveBrand strips empty logo slots and keeps non-empty asset lists', () => {
    const b = effectiveBrand(undefined, {
      logos: { primary: '', mark: '/m.png' },
      assets: [{ id: 'a1', name: 'Pattern', path: '/p.png' }],
    })
    expect(b.logos).toEqual({ mark: '/m.png' })
    expect(b.assets).toEqual([{ id: 'a1', name: 'Pattern', path: '/p.png' }])
    expect(effectiveBrand(undefined, { assets: [] }).assets).toBeUndefined()
  })
})
