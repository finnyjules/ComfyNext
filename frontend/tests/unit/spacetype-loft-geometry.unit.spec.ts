import { describe, it, expect } from 'vitest'
import { sampleSpine, interpStopProps, interpStopColor, buildRamp } from '../../app/lib/spacetype/loftGeometry'
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
