import { describe, it, expect } from 'vitest'
import { tickerPoint, maxAmplitude, buildTickerGeometryData, type TickerGeoParams } from '~/lib/spacetype/tickerGeometry'

const base: TickerGeoParams = {
  segments: 240, length: 100, amplitude: 0, frequency: 2, phase: 0, height: 10, uRepeat: 4,
}

describe('tickerPoint', () => {
  it('spans length centered on the origin', () => {
    expect(tickerPoint(0, base).x).toBeCloseTo(-50, 6)
    expect(tickerPoint(1, base).x).toBeCloseTo(50, 6)
  })
  it('is flat when amplitude is zero', () => {
    expect(tickerPoint(0.37, base).y).toBe(0)
  })
  it('waves with amplitude and frequency', () => {
    const p = { ...base, amplitude: 5, frequency: 1 }
    expect(tickerPoint(0.25, p).y).toBeCloseTo(5, 6)
    expect(tickerPoint(0.75, p).y).toBeCloseTo(-5, 6)
  })
  it('shifts with phase', () => {
    const p = { ...base, amplitude: 5, frequency: 1, phase: Math.PI / 2 }
    expect(tickerPoint(0, p).y).toBeCloseTo(5, 6)
  })
})

describe('maxAmplitude', () => {
  it('shrinks as frequency rises', () => {
    expect(maxAmplitude(4, 100, 10)).toBeLessThan(maxAmplitude(1, 100, 10))
  })
  it('shrinks as the band gets taller', () => {
    expect(maxAmplitude(2, 100, 40)).toBeLessThan(maxAmplitude(2, 100, 10))
  })
  it('is positive for sane inputs', () => {
    expect(maxAmplitude(2, 100, 10)).toBeGreaterThan(0)
  })
})

describe('buildTickerGeometryData', () => {
  it('emits two verts per sample and six indices per segment', () => {
    const g = buildTickerGeometryData({ ...base, segments: 10 })
    expect(g.positions.length).toBe(11 * 2 * 3)
    expect(g.uvs.length).toBe(11 * 2 * 2)
    expect(g.indices.length).toBe(10 * 6)
  })

  it('is flat in Z — the band lives in the XY plane', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6 })
    for (let i = 2; i < g.positions.length; i += 3) expect(g.positions[i]).toBe(0)
  })

  it('arc length equals straight length when flat', () => {
    const g = buildTickerGeometryData(base)
    expect(g.arcLength).toBeCloseTo(100, 4)
  })

  it('arc length exceeds straight length when wavy', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6 })
    expect(g.arcLength).toBeGreaterThan(100)
  })

  it('scales uRepeat by the arc-length ratio and keeps it fractional', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6 })
    expect(g.uRepeatEffective).toBeCloseTo(4 * (g.arcLength / 100), 6)
    expect(Number.isInteger(g.uRepeatEffective)).toBe(false)
  })

  it('holds band width constant around bends', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6, segments: 400 })
    const n = g.positions.length / 3
    for (let i = 0; i < n; i += 2) {
      const dx = g.positions[i * 3] - g.positions[(i + 1) * 3]
      const dy = g.positions[i * 3 + 1] - g.positions[(i + 1) * 3 + 1]
      expect(Math.hypot(dx, dy)).toBeCloseTo(10, 3)
    }
  })

  it('emits monotonically increasing u', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6 })
    for (let i = 2; i < g.uvs.length; i += 4) expect(g.uvs[i]).toBeGreaterThan(g.uvs[i - 4])
  })

  it('spaces u uniformly in ARC LENGTH, not in t — the anti-distortion property', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6, segments: 600 })
    const n = g.positions.length / 3
    let minR = Infinity, maxR = -Infinity
    for (let i = 0; i < n - 2; i += 2) {
      const dx = g.positions[(i + 2) * 3] - g.positions[i * 3]
      const dy = g.positions[(i + 2) * 3 + 1] - g.positions[i * 3 + 1]
      const seg = Math.hypot(dx, dy)
      const du = g.uvs[(i + 2) * 2] - g.uvs[i * 2]
      const ratio = du / seg
      if (ratio < minR) minR = ratio
      if (ratio > maxR) maxR = ratio
    }
    expect(maxR / minR).toBeLessThan(1.01)
  })

  it('runs v across the band', () => {
    const g = buildTickerGeometryData(base)
    expect(g.uvs[1]).toBe(1)
    expect(g.uvs[3]).toBe(0)
  })

  it('clamps amplitude past the self-intersection limit', () => {
    const wild = { ...base, amplitude: 1e6, segments: 400 }
    const g = buildTickerGeometryData(wild)
    const capped = buildTickerGeometryData({ ...wild, amplitude: maxAmplitude(wild.frequency, wild.length, wild.height) })
    expect(g.arcLength).toBeCloseTo(capped.arcLength, 6)
  })
})
