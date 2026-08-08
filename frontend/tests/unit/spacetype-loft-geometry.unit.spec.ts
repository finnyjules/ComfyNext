import { describe, it, expect } from 'vitest'
import { sampleSpine, interpStopProps, interpStopColor, buildRamp, parametricProfileContour, resampleContour, buildLoftGeometry } from '../../app/lib/spacetype/loftGeometry'
import type { LoftStop } from '../../app/lib/spacetype/loftStops'

const stops: LoftStop[] = [
  { id: 'a', x: 0, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#000000' },
  { id: 'b', x: 1, y: 0.5, z: 0, width: 3, height: 1, radius: 0.5, sides: 32, roll: 90, color: '#ffffff' },
]

describe('sampleSpine', () => {
  it('returns exactly `count` stations with orthonormal frames', () => {
    const st = sampleSpine(stops, false, 20)
    expect(st.length).toBe(20)
    for (const s of st) {
      const dot = s.normal.x * s.binormal.x + s.normal.y * s.binormal.y + s.normal.z * s.binormal.z
      expect(Math.abs(dot)).toBeLessThan(1e-3)                     // normal ⟂ binormal
      const nlen = Math.hypot(s.normal.x, s.normal.y, s.normal.z)
      expect(nlen).toBeCloseTo(1, 3)                               // unit length
      expect(Math.hypot(s.binormal.x, s.binormal.y, s.binormal.z)).toBeCloseTo(1, 3)  // binormal unit length
    }
    expect(st[0]!.t).toBeCloseTo(0); expect(st[19]!.t).toBeCloseTo(1)
  })
  it('closed spine wraps (last station near first position)', () => {
    const st = sampleSpine(stops, true, 24)
    const d = Math.hypot(st[0]!.pos.x - st[st.length - 1]!.pos.x, st[0]!.pos.y - st[st.length - 1]!.pos.y)
    expect(d).toBeLessThan(0.6)   // closed loop returns toward start
  })
  it('coincident adjacent stops still yield unit-length orthonormal frames', () => {
    const dup: LoftStop[] = [
      { id: 'a', x: 0.5, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#000000' },
      { id: 'b', x: 0.5, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#ffffff' },
      { id: 'c', x: 0.9, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#ff0000' },
    ]
    for (const s of sampleSpine(dup, false, 24)) {
      expect(Math.hypot(s.normal.x, s.normal.y, s.normal.z)).toBeCloseTo(1, 3)
      expect(Math.hypot(s.binormal.x, s.binormal.y, s.binormal.z)).toBeCloseTo(1, 3)
    }
  })
  it('single stop yields valid unit-length frames', () => {
    const one: LoftStop[] = [{ id: 'a', x: 0.5, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#000000' }]
    const st = sampleSpine(one, false, 5)
    expect(st.length).toBe(5)
    for (const s of st) expect(Math.hypot(s.binormal.x, s.binormal.y, s.binormal.z)).toBeCloseTo(1, 3)
  })
})

describe('interpStopProps', () => {
  it('interpolates width monotonically end to end', () => {
    expect(interpStopProps(stops, 0).width).toBeCloseTo(1)
    expect(interpStopProps(stops, 1).width).toBeCloseTo(3)
    expect(interpStopProps(stops, 0.5).width).toBeGreaterThan(1)
    expect(interpStopProps(stops, 0.5).width).toBeLessThan(3)
  })
})

describe('interpStopColor / buildRamp', () => {
  it('endpoints match stop colours', () => {
    expect(interpStopColor(stops, 0)).toEqual([0, 0, 0])
    expect(interpStopColor(stops, 1)).toEqual([1, 1, 1])
  })
  it('ramp is size*4 RGBA and matches endpoints', () => {
    const ramp = buildRamp(stops, 256)
    expect(ramp.length).toBe(256 * 4)
    expect([ramp[0], ramp[1], ramp[2], ramp[3]]).toEqual([0, 0, 0, 255])
    expect([ramp[255 * 4], ramp[255 * 4 + 1], ramp[255 * 4 + 2]]).toEqual([255, 255, 255])
  })
})

describe('parametricProfileContour', () => {
  it('returns `points` vertices bounded to the unit box', () => {
    const c = parametricProfileContour({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }, 64)
    expect(c.length).toBe(64)
    for (const p of c) { expect(Math.abs(p.x)).toBeLessThanOrEqual(1.001); expect(Math.abs(p.y)).toBeLessThanOrEqual(1.001) }
  })
  it('high sides + full radius ≈ ellipse (all radii ~1)', () => {
    const c = parametricProfileContour({ width: 1, height: 1, radius: 1, sides: 64, roll: 0 }, 64)
    for (const p of c) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 2)
  })
  it('higher sides is rounder than lower sides', () => {
    const maxDev = (sides: number) => {
      const c = parametricProfileContour({ width: 1, height: 1, radius: 1, sides, roll: 0 }, 64)
      return Math.max(...c.map(p => Math.abs(Math.hypot(p.x, p.y) - 1)))
    }
    expect(maxDev(64)).toBeLessThan(maxDev(3))
  })
})

describe('resampleContour', () => {
  it('resamples to the requested count, closed', () => {
    const src = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]
    expect(resampleContour(src, 40).length).toBe(40)
  })
  it('spaces points ~evenly by arc length', () => {
    const sq = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]  // perimeter 8
    const r = resampleContour(sq, 8)
    const d: number[] = []
    for (let i = 0; i < 8; i++) { const a = r[i]!, b = r[(i + 1) % 8]!; d.push(Math.hypot(b.x - a.x, b.y - a.y)) }
    const mean = d.reduce((s, x) => s + x, 0) / 8
    for (const x of d) expect(Math.abs(x - mean)).toBeLessThan(0.35)
  })
})

function fixtureStations(K: number) {
  return sampleSpine([
    { id: 'a', x: 0, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#000' },
    { id: 'b', x: 1, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#fff' },
  ], false, K)
}

describe('buildLoftGeometry', () => {
  const K = 10, P = 16
  const stations = fixtureStations(K)
  const props = stations.map(() => ({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }))
  const contour = parametricProfileContour({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }, P)

  it('fill: K*C*P verts and (K-1)*C*P*6 indices (open)', () => {
    const g = buildLoftGeometry({ stations, props, baseContours: [contour], closed: false, render: 'fill' })
    expect(g.positions.length).toBe(K * 1 * P * 3)
    expect(g.along.length).toBe(K * 1 * P)
    expect(g.indices.length).toBe((K - 1) * 1 * P * 6)
  })
  it('fill closed: K*C*P*6 indices', () => {
    const g = buildLoftGeometry({ stations, props, baseContours: [contour], closed: true, render: 'fill' })
    expect(g.indices.length).toBe(K * 1 * P * 6)
  })
  it('stroke: K*C*P*2 line indices', () => {
    const g = buildLoftGeometry({ stations, props, baseContours: [contour], closed: false, render: 'stroke' })
    expect(g.indices.length).toBe(K * 1 * P * 2)
  })
  it('along runs 0→1 across stations', () => {
    const g = buildLoftGeometry({ stations, props, baseContours: [contour], closed: false, render: 'stroke' })
    expect(g.along[0]).toBeCloseTo(0)
    expect(g.along[g.along.length - 1]).toBeCloseTo(1)
  })
  it('fill: first quad wires the intended neighbours (topology, not just count)', () => {
    const P = 4
    const st = fixtureStations(3)
    const pr = st.map(() => ({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }))
    const contour = parametricProfileContour({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }, P)
    const g = buildLoftGeometry({ stations: st, props: pr, baseContours: [contour], closed: false, render: 'fill' })
    expect(Array.from(g.indices.slice(0, 6))).toEqual([0, 1, 5, 0, 5, 4])
  })
  it('stroke: first station closes its contour loop (topology)', () => {
    const P = 4
    const st = fixtureStations(3)
    const pr = st.map(() => ({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }))
    const contour = parametricProfileContour({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }, P)
    const g = buildLoftGeometry({ stations: st, props: pr, baseContours: [contour], closed: false, render: 'stroke' })
    expect(Array.from(g.indices.slice(0, 8))).toEqual([0, 1, 1, 2, 2, 3, 3, 0])
  })
})
