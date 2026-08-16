import { describe, it, expect } from 'vitest'
import { resolvePaint } from '~/lib/geoshape/paint'
import { mergeConfig } from '~/lib/geoshape/config'
import type { VectorGradient } from '~/lib/vector/svg'

describe('geoshape/paint resolvePaint', () => {
  it('passes a solid fill + null stroke through unchanged when invert is false', () => {
    const cfg = mergeConfig({ fill: '#111111', stroke: null, invert: false })
    const resolved = resolvePaint(cfg)
    expect(resolved.fill).toBe('#111111')
    expect(resolved.stroke).toBeNull()
    expect(resolved.invert).toBe(false)
  })

  it('passes a gradient fill object through unchanged when invert is false', () => {
    const gradient: VectorGradient = {
      type: 'linear',
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    }
    const cfg = mergeConfig({ fill: gradient, invert: false })
    const resolved = resolvePaint(cfg)
    expect(resolved.fill).toEqual(gradient)
    expect(resolved.invert).toBe(false)
  })

  it('swaps fill and stroke for a solid fill when invert is true', () => {
    const cfg = mergeConfig({ fill: '#111111', stroke: '#eeeeee', invert: true })
    const resolved = resolvePaint(cfg)
    expect(resolved.fill).toBe('#eeeeee')
    expect(resolved.stroke).toBe('#111111')
    expect(resolved.invert).toBe(true)
  })

  it('defaults inverted fill to white when stroke is null (solid fill)', () => {
    const cfg = mergeConfig({ fill: '#111111', stroke: null, invert: true })
    const resolved = resolvePaint(cfg)
    expect(resolved.fill).toBe('#ffffff')
    expect(resolved.stroke).toBe('#111111')
  })

  it('degrades gracefully for a gradient fill when invert is true (no crash, fill kept intact)', () => {
    const gradient: VectorGradient = {
      type: 'radial',
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    }
    const cfg = mergeConfig({ fill: gradient, stroke: '#eeeeee', invert: true })
    expect(() => resolvePaint(cfg)).not.toThrow()
    const resolved = resolvePaint(cfg)
    expect(resolved.fill).toEqual(gradient)
    expect(resolved.invert).toBe(true)
  })
})
