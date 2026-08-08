import { describe, it, expect } from 'vitest'
import { parseStops, serializeStops, presetStops, DEFAULT_STOPS, type LoftStop } from '../../app/lib/spacetype/loftStops'

describe('parseStops', () => {
  it('round-trips serialize→parse', () => {
    const s = serializeStops(DEFAULT_STOPS)
    expect(parseStops(s)).toEqual(DEFAULT_STOPS)
  })
  it('strips alpha from stop colours', () => {
    const [s] = parseStops('[{"id":"a","x":0.5,"y":0.5,"z":0,"width":1,"height":1,"roll":0,"color":"#ff000080"}]')
    expect(s!.color).toBe('#ff0000')
  })
  it('is tolerant of garbage → falls back to defaults', () => {
    expect(parseStops('not json')).toEqual(DEFAULT_STOPS)
    expect(parseStops('[]')).toEqual(DEFAULT_STOPS)   // never zero stops
  })
  it('assigns a stable id when missing', () => {
    const [s] = parseStops('[{"x":0.2,"y":0.2,"z":0,"width":1,"height":1,"roll":0,"color":"#fff"}]')
    expect(typeof s!.id).toBe('string'); expect(s!.id.length).toBeGreaterThan(0)
  })
  it('fallback returns a fresh clone (mutation does not poison DEFAULT_STOPS)', () => {
    const before = DEFAULT_STOPS.map(s => s.x)
    const got = parseStops('garbage')
    got[0]!.x = 0.123
    expect(DEFAULT_STOPS.map(s => s.x)).toEqual(before)   // unchanged
  })
  it('reassigns duplicate ids on parse', () => {
    const dup = JSON.stringify([
      { id: 'x', x: 0.2, y: 0.5, z: 0, width: 1, height: 1, roll: 0, color: '#fff' },
      { id: 'x', x: 0.8, y: 0.5, z: 0, width: 1, height: 1, roll: 0, color: '#000' },
    ])
    const out = parseStops(dup)
    expect(new Set(out.map(s => s.id)).size).toBe(out.length)
  })
})

describe('presetStops', () => {
  it('helix returns ≥4 stops spanning depth', () => {
    const stops = presetStops('helix')
    expect(stops.length).toBeGreaterThanOrEqual(4)
    const zs = stops.map(s => s.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.5)
  })
  it('every preset yields valid, unique-id stops', () => {
    for (const p of ['helix','wave','arch','s-curve','loop'] as const) {
      const stops = presetStops(p)
      expect(stops.length).toBeGreaterThanOrEqual(3)
      expect(new Set(stops.map(s => s.id)).size).toBe(stops.length)
      for (const s of stops) { expect(s.width).toBeGreaterThan(0); expect(s.color).toMatch(/^#[0-9a-f]{6}$/i) }
    }
  })
})
