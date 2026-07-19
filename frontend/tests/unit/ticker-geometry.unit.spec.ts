import { describe, it, expect } from 'vitest'
import { tickerPoint, maxAmplitude, buildTickerGeometryData, buildTickerStrokeData, STROKE_Z, type TickerGeoParams } from '~/lib/spacetype/tickerGeometry'

const base: TickerGeoParams = {
  segments: 240, length: 100, amplitude: 0, frequency: 2, phase: 0, height: 10, uRepeat: 4,
}

describe('tickerPoint', () => {
  it('spans length centered on the origin', () => {
    expect(tickerPoint(0, base).x).toBeCloseTo(-50, 6)
    expect(tickerPoint(1, base).x).toBeCloseTo(50, 6)
  })
  it('is flat when amplitude is zero', () => {
    expect(tickerPoint(0.37, base).y).toBeCloseTo(0, 12)
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

  it('pins the normal DIRECTION, not just band width — a sign flip would invert every scene', () => {
    // On a rising centreline (amplitude>0, freq 1 at t≈0 the slope is +), the in-plane normal
    // (-ty, tx) points up-and-left. Vert a = centre + normal*half, vert b = centre - normal*half.
    // With a purely magnitude-based test a flipped normal (a/b swapped) passes; this does not.
    const g = buildTickerGeometryData({ ...base, amplitude: 5, frequency: 1, segments: 200 })
    // Sample near t=0 where dy/dt > 0: vert a must sit ABOVE the centreline, vert b BELOW.
    const i = 2 // a few samples in, still on the rising edge
    const ay = g.positions[(i * 2) * 3 + 1]!
    const by = g.positions[(i * 2 + 1) * 3 + 1]!
    const centreY = (ay + by) / 2
    expect(ay).toBeGreaterThan(centreY)   // +normal vertex is the upper edge
    expect(by).toBeLessThan(centreY)      // -normal vertex is the lower edge
    // And the normal leans left (−x) on a rising slope: the +normal vert is left of the −normal one.
    const ax = g.positions[(i * 2) * 3]!
    const bx = g.positions[(i * 2 + 1) * 3]!
    expect(ax).toBeLessThan(bx)
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
    for (let i = 4; i < g.uvs.length; i += 4) expect(g.uvs[i]).toBeGreaterThan(g.uvs[i - 4])
  })

  it('spaces u uniformly in ARC LENGTH, not in t — the anti-distortion property', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6, segments: 600 })
    const sampleCount = g.positions.length / 6 // two verts per sample, 3 floats per vert
    const centreline = (s: number) => ({
      x: (g.positions[(2 * s) * 3] + g.positions[(2 * s + 1) * 3]) / 2,
      y: (g.positions[(2 * s) * 3 + 1] + g.positions[(2 * s + 1) * 3 + 1]) / 2,
    })
    let minR = Infinity, maxR = -Infinity
    for (let s = 0; s < sampleCount - 1; s++) {
      const p0 = centreline(s)
      const p1 = centreline(s + 1)
      const seg = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      const du = g.uvs[(2 * (s + 1)) * 2] - g.uvs[(2 * s) * 2]
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

describe('buildTickerStrokeData', () => {
  // 4 verts per sample: outerA, outerB, innerA, innerB. Two independent rails, one per long edge.
  const W = 0.4

  it('is empty at zero width — no stroke mesh should be built at all', () => {
    const s = buildTickerStrokeData({ ...base, segments: 10 }, 0)
    expect(s.positions.length).toBe(0)
    expect(s.indices.length).toBe(0)
  })

  it('emits four verts per sample and twelve indices per segment', () => {
    const s = buildTickerStrokeData({ ...base, segments: 10 }, W)
    expect(s.positions.length).toBe(11 * 4 * 3)
    expect(s.indices.length).toBe(10 * 12)
  })

  it('holds rail width constant around bends', () => {
    const s = buildTickerStrokeData({ ...base, amplitude: 6, segments: 400 }, W)
    const n = s.positions.length / 3
    for (let i = 0; i < n; i += 4) {
      const outer = Math.hypot(
        s.positions[i * 3] - s.positions[(i + 1) * 3],
        s.positions[i * 3 + 1] - s.positions[(i + 1) * 3 + 1],
      )
      const inner = Math.hypot(
        s.positions[(i + 2) * 3] - s.positions[(i + 3) * 3],
        s.positions[(i + 2) * 3 + 1] - s.positions[(i + 3) * 3 + 1],
      )
      expect(outer).toBeCloseTo(W, 5)
      expect(inner).toBeCloseTo(W, 5)
    }
  })

  it('centres each rail exactly on the band edge — rails cannot drift off the band', () => {
    const p = { ...base, amplitude: 6, segments: 300 }
    const band = buildTickerGeometryData(p)
    const s = buildTickerStrokeData(p, W)
    const samples = s.positions.length / 3 / 4
    for (let i = 0; i < samples; i++) {
      const b = i * 4, g = i * 2
      // Rail centre = midpoint of its two verts; band edge = the band's own vert for that side.
      for (const [r0, r1, edge] of [[b, b + 1, g], [b + 2, b + 3, g + 1]] as const) {
        const cx = (s.positions[r0 * 3]! + s.positions[r1 * 3]!) / 2
        const cy = (s.positions[r0 * 3 + 1]! + s.positions[r1 * 3 + 1]!) / 2
        expect(cx).toBeCloseTo(band.positions[edge * 3]!, 5)
        expect(cy).toBeCloseTo(band.positions[edge * 3 + 1]!, 5)
      }
    }
  })

  it('sits in a single plane just in front of the band, to avoid z-fighting', () => {
    const s = buildTickerStrokeData({ ...base, amplitude: 6 }, W)
    const band = buildTickerGeometryData({ ...base, amplitude: 6 })
    for (let i = 2; i < s.positions.length; i += 3) {
      // toBeCloseTo, not toBe: Float32Array cannot hold 0.001 exactly.
      expect(s.positions[i]).toBeCloseTo(STROKE_Z, 9)
    }
    expect(STROKE_Z).toBeGreaterThan(band.positions[2]!)
    expect(STROKE_Z).toBeLessThan(0.01)
  })

  it('clamps rail half-width to the band half-height so the inner rail never inverts', () => {
    // Thinnest band (height 0.3 → half 0.15) with the widest stroke (0.4 → hw 0.2) would put the
    // inner edge at half - hw = -0.05, crossing the centreline. Clamped, it lands at exactly 0.
    const thin = { ...base, height: 0.3, amplitude: 0, segments: 4 }
    const s = buildTickerStrokeData(thin, 0.4)
    const half = 0.15
    const samples = s.positions.length / 3 / 4
    for (let i = 0; i < samples; i++) {
      const b = i * 4
      // innerA is vert index 2, at offset -(half - hw). With hw clamped to half it must be >= 0
      // (never negative), i.e. the inner rail stays on the band side of the centreline.
      const innerAoffsetSign = s.positions[(b + 2) * 3 + 1]! // amplitude 0 ⇒ normal is +y, offset = y
      expect(innerAoffsetSign).toBeGreaterThanOrEqual(-1e-6)
      // Rail width still exactly the clamped stroke (2*half = 0.3), constant.
      const outer = Math.hypot(
        s.positions[b * 3]! - s.positions[(b + 1) * 3]!,
        s.positions[b * 3 + 1]! - s.positions[(b + 1) * 3 + 1]!,
      )
      expect(outer).toBeCloseTo(2 * half, 5)
    }
  })

  it('clamps amplitude identically to the band, so the two cannot diverge', () => {
    const wild = { ...base, amplitude: 1e6, segments: 200 }
    const a = buildTickerStrokeData(wild, W)
    const b = buildTickerStrokeData({ ...wild, amplitude: maxAmplitude(wild.frequency, wild.length, wild.height) }, W)
    for (let i = 0; i < a.positions.length; i++) expect(a.positions[i]).toBeCloseTo(b.positions[i]!, 5)
  })
})
