import { describe, it, expect } from 'vitest'
import { rollPaintItem, gradientFromPaint, ROLLS } from '~/lib/compositor/fillPalette'
import type { Gradient } from '~/composables/useCompositorLayers'

describe('rollPaintItem (shuffle)', () => {
  it('is deterministic: same N → same pick', () => {
    for (const n of [1, 2, 7, 42]) {
      expect(rollPaintItem(n)).toEqual(rollPaintItem(n))
    }
  })

  it('returns a deep copy (mutating the result never touches the table)', () => {
    const a = rollPaintItem(3) as { a?: string }
    a.a = '#deadbe'
    const b = rollPaintItem(3) as { a?: string }
    expect(b.a).not.toBe('#deadbe')
  })

  it('spans more than one distinct look across rolls', () => {
    const seen = new Set(Array.from({ length: 24 }, (_, i) => JSON.stringify(rollPaintItem(i + 1))))
    expect(seen.size).toBeGreaterThan(1)
  })

  it('only ever picks items from the ROLLS table', () => {
    const table = new Set(ROLLS.map(r => JSON.stringify(r)))
    for (let n = 1; n <= 30; n++) expect(table.has(JSON.stringify(rollPaintItem(n)))).toBe(true)
  })
})

describe('gradientFromPaint (round-trip, no collapse)', () => {
  it('preserves a radial gradient and all its stops', () => {
    const g: Gradient = { type: 'radial', stops: [{ offset: 0, color: '#fff' }, { offset: 0.5, color: '#f0f' }, { offset: 1, color: '#000' }] }
    const out = gradientFromPaint(g, '#111', '#222', 10)
    expect(out.type).toBe('radial')
    expect(out.stops).toHaveLength(3)
    expect(out.stops.map(s => s.color)).toEqual(['#fff', '#f0f', '#000'])
  })

  it('preserves a multi-stop linear gradient + its angle (does NOT flatten to 2 stops)', () => {
    const g: Gradient = { type: 'linear', angle: 270, stops: [{ offset: 0, color: '#a' }, { offset: 0.3, color: '#b' }, { offset: 0.7, color: '#c' }, { offset: 1, color: '#d' }] }
    const out = gradientFromPaint(g, '#000', '#fff', 45)
    expect(out.type).toBe('linear')
    expect((out as Extract<Gradient, { type: 'linear' }>).angle).toBe(270)
    expect(out.stops).toHaveLength(4)
  })

  it('seeds a 2-stop linear from a/b/angle for a non-gradient paint', () => {
    const out = gradientFromPaint('#3b82f6', '#3b82f6', '#000000', 90)
    expect(out.type).toBe('linear')
    expect(out.stops).toEqual([{ offset: 0, color: '#3b82f6' }, { offset: 1, color: '#000000' }])
    expect((out as Extract<Gradient, { type: 'linear' }>).angle).toBe(90)
  })

  it('returns copies of stops (no shared references with the input)', () => {
    const g: Gradient = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#a' }, { offset: 1, color: '#b' }] }
    const out = gradientFromPaint(g, '#0', '#1', 0)
    expect(out.stops[0]).not.toBe(g.stops[0])
  })
})
