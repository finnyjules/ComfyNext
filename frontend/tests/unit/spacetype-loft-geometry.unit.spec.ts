import { describe, it, expect } from 'vitest'
import { sampleSpine, interpStopProps, interpStopColor, buildRamp, resampleContour, buildLoftGeometry, buildSlicedLoftGeometry, shapeContour } from '../../app/lib/spacetype/loftGeometry'
import type { LoftStop } from '../../app/lib/spacetype/loftStops'
import { autoSmoothStops } from '../../app/lib/spacetype/loftStops'

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

describe('sampleSpine bezier', () => {
  const S = (x:number,y:number,extra:any={}) => ({ id:`s${x}${y}`, x, y, z:0, width:1, height:1, roll:0, color:'#fff', ...extra })
  it('still yields orthonormal unit frames + endpoints t=0/1 (bezier)', () => {
    const st = sampleSpine([S(0,0.5), S(0.5,0.2), S(1,0.5)] as any, false, 20)
    for (const s of st) { expect(Math.hypot(s.normal.x,s.normal.y,s.normal.z)).toBeCloseTo(1,3); expect(Math.hypot(s.binormal.x,s.binormal.y,s.binormal.z)).toBeCloseTo(1,3) }
    expect(st[0]!.t).toBeCloseTo(0); expect(st[19]!.t).toBeCloseTo(1)
  })
  it('a manual tangent handle bends the curve vs the auto version', () => {
    const base = [S(0,0.5), S(0.5,0.5), S(1,0.5)]
    const bent = [S(0,0.5), S(0.5,0.5,{ manual:true, ta: Math.PI/2, hlf:0.4, hlb:0.4 }), S(1,0.5)]
    const a = sampleSpine(base as any, false, 40)[20]!.pos
    const b = sampleSpine(bent as any, false, 40)[20]!.pos
    expect(Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z)).toBeGreaterThan(0.1)   // the manual handle moved the curve
  })
  it('legacy stops (no tangents) sample without throwing', () => {
    expect(() => sampleSpine([S(0,0.2), S(1,0.8)] as any, false, 10)).not.toThrow()
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

describe('cap angle (mitred end caps)', () => {
  const P = 12
  const stopsFix = [
    { id:'a', x:0, y:0.5, z:0, width:1, height:1, roll:0, color:'#000000' },
    { id:'b', x:1, y:0.5, z:0, width:1, height:1, roll:0, color:'#ffffff' },
  ]
  const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)

  it('capAngle=0 is byte-identical to building with no capAngle opt at all (continuous)', () => {
    const K = 10
    const st = sampleSpine(stopsFix as any, false, K)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const noOpt = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', cap:true })
    const zero = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', cap:true, capAngle:0 })
    expect(zero.positions.length).toBe(noOpt.positions.length)
    expect(zero.indices.length).toBe(noOpt.indices.length)
    for (let i = 0; i < noOpt.positions.length; i++) expect(zero.positions[i]).toBeCloseTo(noOpt.positions[i]!, 9)
    for (let i = 0; i < noOpt.indices.length; i++) expect(zero.indices[i]).toBe(noOpt.indices[i])
  })

  it('capAngle=0 is byte-identical to building with no capAngle opt at all (sliced)', () => {
    const E = 5
    const st = sampleSpine(stopsFix as any, false, 200)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const noOpt = buildSlicedLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', elements:E, spacing:0.4, cap:true })
    const zero = buildSlicedLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', elements:E, spacing:0.4, cap:true, capAngle:0 })
    expect(zero.positions.length).toBe(noOpt.positions.length)
    expect(zero.indices.length).toBe(noOpt.indices.length)
    for (let i = 0; i < noOpt.positions.length; i++) expect(zero.positions[i]).toBeCloseTo(noOpt.positions[i]!, 9)
    for (let i = 0; i < noOpt.indices.length; i++) expect(zero.indices[i]).toBe(noOpt.indices[i])
  })

  it('capAngle=45 shears the outer cap ring along the station tangent (continuous)', () => {
    const K = 10
    const st = sampleSpine(stopsFix as any, false, K)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const zero = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', cap:true, capAngle:0 })
    const sheared = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', cap:true, capAngle:45 })
    // Unsheared cap ring vertices are literally the shared wall vertices — station0, contour0,
    // point p=3 (oval point at angle 90°, i.e. (0,1)) has a non-zero binormal component so the
    // shear (proportional to it) is non-zero there.
    const p = 3
    const wallIdx = p                                    // idx(0,0,p) with C=1
    const basePos = [zero.positions[wallIdx*3]!, zero.positions[wallIdx*3+1]!, zero.positions[wallIdx*3+2]!]
    // sheared layout after the K*P grid: cap0 = [centroid, P ring verts...]; ring vertex p is at
    // offset (gridVerts + 1 + p).
    const gridVerts = K * 1 * P
    const shearedRingVertIdx = gridVerts + 1 + p
    const shearedPos = [sheared.positions[shearedRingVertIdx*3]!, sheared.positions[shearedRingVertIdx*3+1]!, sheared.positions[shearedRingVertIdx*3+2]!]
    const dx = shearedPos[0]-basePos[0], dy = shearedPos[1]-basePos[1], dz = shearedPos[2]-basePos[2]
    const moved = Math.hypot(dx, dy, dz)
    expect(moved).toBeGreaterThan(0.05)
    // the displacement should be (nearly) parallel to the station's tangent T = normal × binormal
    const s0 = st[0]!
    const tx = s0.normal.y*s0.binormal.z - s0.normal.z*s0.binormal.y
    const ty = s0.normal.z*s0.binormal.x - s0.normal.x*s0.binormal.z
    const tz = s0.normal.x*s0.binormal.y - s0.normal.y*s0.binormal.x
    const tlen = Math.hypot(tx, ty, tz) || 1
    const dot = (dx*tx + dy*ty + dz*tz) / tlen
    expect(Math.abs(dot)).toBeCloseTo(moved, 3)   // displacement is (anti)parallel to tangent
  })

  it('sliced: interior band-end caps are NOT sheared — only band0-ring0 and the last band-ring1 move', () => {
    const E = 2
    const st = sampleSpine(stopsFix as any, false, 200)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const zero = buildSlicedLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', elements:E, spacing:0.4, cap:true, capAngle:0 })
    const sheared = buildSlicedLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', elements:E, spacing:0.4, cap:true, capAngle:60 })
    const nVerts = E * 2 * 1 * P
    // capAngle=0 layout: 4 rings in loop order (i0r0, i0r1, i1r0, i1r1), each = 1 centroid vertex.
    const zeroCentroid = (k: number) => [zero.positions[(nVerts+k)*3]!, zero.positions[(nVerts+k)*3+1]!, zero.positions[(nVerts+k)*3+2]!]
    // sheared layout: i0r0 is OUTER (band0's first ring) → centroid + P ring verts; i0r1 and i1r0
    // are interior → 1 centroid each (unchanged path); i1r1 is OUTER (last band's last ring) →
    // centroid + P ring verts.
    let o = nVerts
    o += (P + 1)                       // skip i0r0's sheared block
    const centroidI0r1 = o; o += 1
    const centroidI1r0 = o; o += 1
    // (i1r1's sheared block follows — not needed here)
    const shearedI0r1 = [sheared.positions[centroidI0r1*3]!, sheared.positions[centroidI0r1*3+1]!, sheared.positions[centroidI0r1*3+2]!]
    const shearedI1r0 = [sheared.positions[centroidI1r0*3]!, sheared.positions[centroidI1r0*3+1]!, sheared.positions[centroidI1r0*3+2]!]
    const zeroI0r1 = zeroCentroid(1), zeroI1r0 = zeroCentroid(2)
    expect(shearedI0r1[0]).toBeCloseTo(zeroI0r1[0]!, 9); expect(shearedI0r1[1]).toBeCloseTo(zeroI0r1[1]!, 9); expect(shearedI0r1[2]).toBeCloseTo(zeroI0r1[2]!, 9)
    expect(shearedI1r0[0]).toBeCloseTo(zeroI1r0[0]!, 9); expect(shearedI1r0[1]).toBeCloseTo(zeroI1r0[1]!, 9); expect(shearedI1r0[2]).toBeCloseTo(zeroI1r0[2]!, 9)
  })
})

describe('stroke ribbons (width)', () => {
  const P = 10
  const stopsFix = [
    { id:'a', x:0, y:0.5, z:0, width:1, height:1, roll:0, color:'#000000' },
    { id:'b', x:1, y:0.5, z:0, width:1, height:1, roll:0, color:'#ffffff' },
  ]
  const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)
  const st = sampleSpine(stopsFix as any, false, 8)
  const props = st.map(() => ({ width:1, height:1, roll:0 }))

  it('strokeWidth>0 emits a ribbon: 2x vertices and triangle indices (6 per contour edge)', () => {
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke', strokeWidth:0.06 })
    expect(g.positions.length).toBe(8 * 1 * P * 2 * 3)        // 2x verts (inner+outer)
    expect(g.indices.length).toBe(8 * 1 * P * 6)              // 2 tris per edge * 3
  })
  it('inner and outer edges are offset apart (ribbon has width)', () => {
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke', strokeWidth:0.1 })
    // vertex 0 (inner p0) vs vertex 1 (outer p0) should differ by ~strokeWidth
    const d = Math.hypot(g.positions[0]-g.positions[3], g.positions[1]-g.positions[4], g.positions[2]-g.positions[5])
    expect(d).toBeGreaterThan(0.05); expect(d).toBeLessThan(0.2)
  })
  it('strokeWidth 0 keeps line-segment output (back-compat)', () => {
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke', strokeWidth:0 })
    expect(g.indices.length).toBe(8 * 1 * P * 2)             // line-segment pairs
  })
})

describe('aAcross coordinate', () => {
  const P = 12
  const stopsFix = [
    { id:'a', x:0, y:0.5, z:0, width:1, height:1, roll:0, color:'#000000' },
    { id:'b', x:1, y:0.5, z:0, width:1, height:1, roll:0, color:'#ffffff' },
  ]
  const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)
  const st = sampleSpine(stopsFix as any, false, 8)
  const props = st.map(() => ({ width:1, height:1, roll:0 }))

  it('across is present, same length as along, all in [0,1]', () => {
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', gradientAngle:90 })
    expect(g.across.length).toBe(g.along.length)
    for (const a of g.across) { expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(1) }
  })
  it('angle 90 (vertical): the top contour point → ~1, bottom → ~0', () => {
    // oval point 0 is at angle 0 = (+1,0); the y-extremes are at p≈P/4 and p≈3P/4
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', gradientAngle:90 })
    // gather across for the first ring's P points
    const ring0 = Array.from(g.across.slice(0, P))
    expect(Math.max(...ring0)).toBeGreaterThan(0.9)   // top of oval → ~1
    expect(Math.min(...ring0)).toBeLessThan(0.1)      // bottom → ~0
  })
  it('sliced fill caps: centroid across = 0.5', () => {
    const s2 = sampleSpine(stopsFix as any, false, 200)
    const p2 = s2.map(() => ({ width:1, height:1, roll:0 }))
    const g = buildSlicedLoftGeometry({ stations: s2, props: p2, baseContours:[contour], closed:false, render:'fill', elements:4, spacing:0.4, cap:true, gradientAngle:90 })
    // the last 4*2 vertices are cap centroids (2 per band, 4 bands) — but count precisely:
    // grid = 4 bands * 2 rings * 1 contour * P; caps appended after → each centroid across = 0.5
    const gridVerts = 4 * 2 * 1 * P
    for (let i = gridVerts; i < g.across.length; i++) expect(g.across[i]).toBeCloseTo(0.5)
  })
})
