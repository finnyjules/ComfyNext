import { describe, it, expect } from 'vitest'
import { isFill, isGradient, __test__, type Paint, type Gradient } from '~/lib/compositor/paint'
import { DEFAULT_FILL, type Fill } from '~/lib/spacetype/fillTile'

// paintTileBox itself needs `document.createElement('canvas')` and can't run in
// this suite's node/no-DOM environment (vitest.config.ts) — see the browser-pane
// pixel proof in the report for that half. This file covers everything pure:
// stop sorting/clamping and arm discrimination (given a Paint, which arm fires).

const { sortedClampedStops } = __test__

describe('sortedClampedStops', () => {
  it('sorts out-of-order stops by offset', () => {
    const out = sortedClampedStops([{ offset: 1, color: '#fff' }, { offset: 0, color: '#000' }, { offset: 0.5, color: '#888' }])
    expect(out.map(s => s.offset)).toEqual([0, 0.5, 1])
  })

  it('clamps offsets outside 0..1', () => {
    const out = sortedClampedStops([{ offset: -3, color: '#000' }, { offset: 7, color: '#fff' }])
    expect(out.map(s => s.offset)).toEqual([0, 1])
  })

  it('sinks non-finite offsets to 0', () => {
    const out = sortedClampedStops([{ offset: NaN, color: '#a' }, { offset: Infinity, color: '#b' }, { offset: 0.5, color: '#c' }])
    // NaN and Infinity both sink to 0; stable-ish sort keeps them at the front alongside the clamp
    expect(out.filter(s => s.offset === 0).length).toBe(2)
    expect(out.some(s => s.offset === 0.5)).toBe(true)
  })

  it('handles an empty stop list', () => {
    expect(sortedClampedStops([])).toEqual([])
  })

  it('handles a single stop', () => {
    const out = sortedClampedStops([{ offset: 0.3, color: '#123456' }])
    expect(out).toEqual([{ offset: 0.3, color: '#123456' }])
  })

  it('does not mutate the input array', () => {
    const input = [{ offset: 1, color: '#fff' }, { offset: 0, color: '#000' }]
    const copy = input.map(s => ({ ...s }))
    sortedClampedStops(input)
    expect(input).toEqual(copy)
  })
})

describe('Paint arm discrimination', () => {
  const linear: Gradient = { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }
  const radial: Gradient = { type: 'radial', stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }
  const fill: Fill = { ...DEFAULT_FILL, type: 'gradient' }

  it('a string is neither a gradient nor a fill (string arm)', () => {
    const p: Paint = '#ff00ff'
    expect(isGradient(p)).toBe(false)
    expect(isFill(p)).toBe(false)
  })

  it('a linear/radial gradient hits the gradient arm, not the fill arm', () => {
    expect(isGradient(linear)).toBe(true)
    expect(isFill(linear)).toBe(false)
    expect(isGradient(radial)).toBe(true)
    expect(isFill(radial)).toBe(false)
  })

  it('a Fill (even a Fill of type "gradient") hits the fill arm, not the gradient arm', () => {
    expect(isFill(fill)).toBe(true)
    expect(isGradient(fill)).toBe(false)
  })

  it('a shader-typed Fill still hits the fill arm', () => {
    const shaderFill: Fill = { ...DEFAULT_FILL, type: 'shader', shader: { effectId: 'x', params: {}, anchor: 'object', speed: 1, input: DEFAULT_FILL } }
    expect(isFill(shaderFill)).toBe(true)
    expect(isGradient(shaderFill)).toBe(false)
  })
})
