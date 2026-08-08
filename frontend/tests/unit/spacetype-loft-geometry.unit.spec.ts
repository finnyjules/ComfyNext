import { describe, it, expect } from 'vitest'
import { sampleSpine, interpStopProps, interpStopColor, buildRamp, resampleContour, buildLoftGeometry, buildSlicedLoftGeometry, shapeContour } from '../../app/lib/spacetype/loftGeometry'
import type { LoftStop } from '../../app/lib/spacetype/loftStops'

const stops: LoftStop[] = [
  { id: 'a', x: 0, y: 0.5, z: 0, width: 1, height: 1, roll: 0, color: '#000000' },
  { id: 'b', x: 1, y: 0.5, z: 0, width: 3, height: 1, roll: 90, color: '#ffffff' },
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
      { id: 'a', x: 0.5, y: 0.5, z: 0, width: 1, height: 1, roll: 0, color: '#000000' },
      { id: 'b', x: 0.5, y: 0.5, z: 0, width: 1, height: 1, roll: 0, color: '#ffffff' },
      { id: 'c', x: 0.9, y: 0.5, z: 0, width: 1, height: 1, roll: 0, color: '#ff0000' },
    ]
    for (const s of sampleSpine(dup, false, 24)) {
      expect(Math.hypot(s.normal.x, s.normal.y, s.normal.z)).toBeCloseTo(1, 3)
      expect(Math.hypot(s.binormal.x, s.binormal.y, s.binormal.z)).toBeCloseTo(1, 3)
    }
  })
  it('single stop yields valid unit-length frames', () => {
    const one: LoftStop[] = [{ id: 'a', x: 0.5, y: 0.5, z: 0, width: 1, height: 1, roll: 0, color: '#000000' }]
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
    { id: 'a', x: 0, y: 0.5, z: 0, width: 1, height: 1, roll: 0, color: '#000' },
    { id: 'b', x: 1, y: 0.5, z: 0, width: 1, height: 1, roll: 0, color: '#fff' },
  ], false, K)
}

describe('buildLoftGeometry', () => {
  const K = 10, P = 16
  const stations = fixtureStations(K)
  const props = stations.map(() => ({ width: 1, height: 1, roll: 0 }))
  const contour = shapeContour('oval', { rectRadius: 0.5, polySides: 5, starDepth: 0.5 }, P)

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
    const pr = st.map(() => ({ width: 1, height: 1, roll: 0 }))
    const contour = shapeContour('oval', { rectRadius: 0.5, polySides: 5, starDepth: 0.5 }, P)
    const g = buildLoftGeometry({ stations: st, props: pr, baseContours: [contour], closed: false, render: 'fill' })
    expect(Array.from(g.indices.slice(0, 6))).toEqual([0, 1, 5, 0, 5, 4])
  })
  it('stroke: first station closes its contour loop (topology)', () => {
    const P = 4
    const st = fixtureStations(3)
    const pr = st.map(() => ({ width: 1, height: 1, roll: 0 }))
    const contour = shapeContour('oval', { rectRadius: 0.5, polySides: 5, starDepth: 0.5 }, P)
    const g = buildLoftGeometry({ stations: st, props: pr, baseContours: [contour], closed: false, render: 'stroke' })
    expect(Array.from(g.indices.slice(0, 8))).toEqual([0, 1, 1, 2, 2, 3, 3, 0])
  })
})

describe('buildSlicedLoftGeometry', () => {
  const P = 12, ELEMENTS = 5
  const stopsFix = [
    { id:'a', x:0, y:0.5, z:0, width:1, height:1, roll:0, color:'#000000' },
    { id:'b', x:1, y:0.5, z:0, width:1, height:1, roll:0, color:'#ffffff' },
  ]
  const stations = sampleSpine(stopsFix as any, false, 200)
  const props = stations.map(() => ({ width:1, height:1, roll:0 }))
  const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)

  it('fill: emits ELEMENTS separate bands (each 2 rings skinned) → vertex + index counts scale with ELEMENTS', () => {
    const g = buildSlicedLoftGeometry({ stations, props, baseContours: [contour], closed:false, render:'fill', elements: ELEMENTS, spacing: 0.4 })
    // each band = 2 rings of P verts
    expect(g.positions.length).toBe(ELEMENTS * 2 * P * 3)
    expect(g.indices.length).toBe(ELEMENTS * 1 * P * 6)   // (rings-1)=1 quad-row per band
  })
  it('bands do not touch: consecutive band centres are gapped', () => {
    const g = buildSlicedLoftGeometry({ stations, props, baseContours: [contour], closed:false, render:'fill', elements: ELEMENTS, spacing: 0.4 })
    // along holds each band's centre t; there should be ELEMENTS distinct values
    const along = new Set(Array.from(g.along).map(v => Math.round(v*1000)/1000))
    expect(along.size).toBe(ELEMENTS)
  })
  it('stroke: each band is one outline ring → ELEMENTS*P*2 line indices', () => {
    const g = buildSlicedLoftGeometry({ stations, props, baseContours: [contour], closed:false, render:'stroke', elements: ELEMENTS, spacing: 0.4 })
    expect(g.indices.length).toBe(ELEMENTS * 1 * P * 2)
  })
  it('fill: band 0 first quad wires ring0↔ring1 of the SAME band (topology, not just count)', () => {
    const g = buildSlicedLoftGeometry({ stations, props, baseContours: [contour], closed:false, render:'fill', elements: ELEMENTS, spacing: 0.4 })
    // idx(0,0,0,0)=0, idx(0,0,0,1)=1, idx(0,1,0,0)=P, idx(0,1,0,1)=P+1  → quad (a,b,e,a,e,d)
    expect(Array.from(g.indices.slice(0, 6))).toEqual([0, 1, P + 1, 0, P + 1, P])
  })
  it('fill bands keep non-zero thickness when elements == station count (interpolated, not rounded)', () => {
    const K = 40
    const st = sampleSpine([
      { id:'a', x:0, y:0.5, z:0, width:1, height:1, roll:0, color:'#000000' },
      { id:'b', x:1, y:0.5, z:0, width:1, height:1, roll:0, color:'#ffffff' },
    ] as any, false, K)
    const pr = st.map(() => ({ width:1, height:1, roll:0 }))
    const P = 8
    const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)
    const g = buildSlicedLoftGeometry({ stations: st, props: pr, baseContours:[contour], closed:false, render:'fill', elements: K, spacing: 0.5 })
    // every band: ring0 vertex 0 vs ring1 vertex 0 must be at different positions (thickness>0)
    for (let band = 0; band < K; band++) {
      const ring0Off = (band * 2) * P * 3
      const ring1Off = (band * 2 + 1) * P * 3
      const d = Math.hypot(
        g.positions[ring0Off]! - g.positions[ring1Off]!,
        g.positions[ring0Off + 1]! - g.positions[ring1Off + 1]!,
        g.positions[ring0Off + 2]! - g.positions[ring1Off + 2]!,
      )
      expect(d).toBeGreaterThan(1e-4)
    }
  })
})

describe('cross-section caps (fill)', () => {
  const P = 12
  const stopsFix = [
    { id:'a', x:0, y:0.5, z:0, width:1, height:1, roll:0, color:'#000000' },
    { id:'b', x:1, y:0.5, z:0, width:1, height:1, roll:0, color:'#ffffff' },
  ]
  const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)

  it('continuous fill caps: exactly 2 end caps → +2 centroid verts and +2*P cap triangles', () => {
    const K = 10
    const st = sampleSpine(stopsFix as any, false, K)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const base = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill' })
    const capped = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', cap:true })
    expect(capped.positions.length).toBe(base.positions.length + 2 * 1 * 3)      // +2 centroid verts (C=1)
    expect(capped.indices.length).toBe(base.indices.length + 2 * 1 * P * 3)      // +2 caps * P tris * 3
  })
  it('closed continuous fill: no caps (closed tube has no ends)', () => {
    const K = 12
    const st = sampleSpine(stopsFix as any, true, K)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const a = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:true, render:'fill' })
    const b = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:true, render:'fill', cap:true })
    expect(b.positions.length).toBe(a.positions.length)
    expect(b.indices.length).toBe(a.indices.length)
  })
  it('sliced fill caps: 2 caps per band → +2*E centroids and +2*E*P cap triangles', () => {
    const E = 5
    const st = sampleSpine(stopsFix as any, false, 200)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const base = buildSlicedLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', elements:E, spacing:0.4 })
    const capped = buildSlicedLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', elements:E, spacing:0.4, cap:true })
    expect(capped.positions.length).toBe(base.positions.length + 2 * E * 1 * 3)
    expect(capped.indices.length).toBe(base.indices.length + 2 * E * 1 * P * 3)
  })
  it('cap ignored in stroke mode', () => {
    const st = sampleSpine(stopsFix as any, false, 10)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const a = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke' })
    const b = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke', cap:true })
    expect(b.positions.length).toBe(a.positions.length)
  })
})
