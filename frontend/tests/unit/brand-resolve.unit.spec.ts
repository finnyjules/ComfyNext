// frontend/tests/unit/brand-resolve.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { effectiveBrand } from '../../shared/brand/resolve'

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
