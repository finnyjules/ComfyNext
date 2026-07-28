import { describe, it, expect } from 'vitest'
import { ShaderFxRenderer, shaderFx } from '~/lib/shaderfx/renderer'

describe('ShaderFxRenderer instances', () => {
  it('is exported as a constructor', () => {
    expect(typeof ShaderFxRenderer).toBe('function')
  })

  it('constructs without touching WebGL', () => {
    expect(() => new ShaderFxRenderer()).not.toThrow()
  })

  it('produces independent instances, distinct from the singleton', () => {
    const a = new ShaderFxRenderer()
    const b = new ShaderFxRenderer()
    expect(a).not.toBe(b)
    expect(a).not.toBe(shaderFx)
  })

  it('keeps the singleton available for existing callers', () => {
    expect(shaderFx).toBeInstanceOf(ShaderFxRenderer)
  })
})
