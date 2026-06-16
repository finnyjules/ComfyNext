import { describe, it, expect } from 'vitest'
import { resolveStops, type GradientStop } from '../../app/lib/spacetype/gradient'

describe('resolveStops', () => {
  it('keeps only enabled stops, in order, with positions 0..1', () => {
    const stops: GradientStop[] = [
      { color: '#ff0000', on: true }, { color: '#00ff00', on: false }, { color: '#0000ff', on: true },
    ]
    const r = resolveStops(stops)
    expect(r.map(s => s.color)).toEqual(['#ff0000', '#0000ff'])
    expect(r[0].pos).toBeCloseTo(0, 6)
    expect(r[1].pos).toBeCloseTo(1, 6)
  })
  it('falls back to a single stop when only one is enabled', () => {
    const r = resolveStops([{ color: '#abcdef', on: true }, { color: '#000', on: false }])
    expect(r).toEqual([{ color: '#abcdef', pos: 0 }])
  })
  it('returns [] when none enabled', () => {
    expect(resolveStops([{ color: '#fff', on: false }])).toEqual([])
  })
})
