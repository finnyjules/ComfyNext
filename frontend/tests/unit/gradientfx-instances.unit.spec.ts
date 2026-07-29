import { describe, it, expect } from 'vitest'
import { GradientFxRenderer, gradientFx } from '~/lib/gradientfx/renderer'

describe('GradientFxRenderer instances', () => {
  it('is exported as a constructor', () => {
    expect(typeof GradientFxRenderer).toBe('function')
  })

  it('constructs without touching WebGL', () => {
    expect(() => new GradientFxRenderer()).not.toThrow()
  })

  it('produces independent instances, distinct from the singleton', () => {
    const a = new GradientFxRenderer()
    const b = new GradientFxRenderer()
    expect(a).not.toBe(b)
    expect(a).not.toBe(gradientFx)
  })

  it('keeps the singleton available for existing callers', () => {
    expect(gradientFx).toBeInstanceOf(GradientFxRenderer)
  })
})
