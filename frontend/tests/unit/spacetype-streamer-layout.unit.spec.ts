import { describe, it, expect } from 'vitest'
import { streamerRadius, streamerCycle, buildStreamerGeometry, gradientColorAt } from '../../app/lib/spacetype/streamerLayout'

describe('streamerRadius / streamerCycle', () => {
  it('radius = segmentCount*segmentSpace/PI', () => {
    expect(streamerRadius(22, 23)).toBeCloseTo((22 * 23) / Math.PI)
  })
  it('cycle = 2*segmentCount*(1+middleStretch), rounded', () => {
    expect(streamerCycle(22, 0)).toBe(44)
    expect(streamerCycle(10, 1)).toBe(40)
  })
})

describe('buildStreamerGeometry', () => {
  it('oval (middleStretch 0): cells ≈ 2*segmentCount', () => {
    expect(buildStreamerGeometry(20, 10, 0, 30).cells).toBe(40)
  })
  it('racetrack straights add cells (≈ 2*segmentCount*(1+ms))', () => {
    expect(buildStreamerGeometry(20, 10, 1, 30).cells).toBe(80)
  })
  it('emits 2 verts per sample, a closing sample, and 6 indices per quad', () => {
    const g = buildStreamerGeometry(10, 10, 0, 20)
    expect(g.positions.length % 6).toBe(0)            // 2 verts * 3 floats
    const verts = g.positions.length / 3
    expect(verts % 2).toBe(0)
    // index count = (samples) * 6; verts = (samples+1)*2 ⇒ indices = (verts/2 - 1)*6
    expect(g.indices.length).toBe((verts / 2 - 1) * 6)
  })
  it('band width is along Z = ±depth/2', () => {
    const g = buildStreamerGeometry(10, 10, 0, 24)
    expect(g.positions[2]).toBeCloseTo(12)            // first vert z = +half
    expect(g.positions[5]).toBeCloseTo(-12)           // second vert z = -half
  })
  it('uv.x runs 0→1 once around the loop', () => {
    const g = buildStreamerGeometry(10, 10, 0, 20)
    expect(g.uvs[0]).toBeCloseTo(0)                    // first u
    expect(g.uvs[g.uvs.length - 2]).toBeCloseTo(1)     // last u
  })
})

describe('gradientColorAt', () => {
  it('single stop → that color everywhere', () => {
    expect(gradientColorAt(5, 10, ['#ff0000'])).toEqual({ r: 1, g: 0, b: 0 })
  })
  it('endpoints hit the first and last stop', () => {
    expect(gradientColorAt(0, 10, ['#000000', '#ffffff'])).toEqual({ r: 0, g: 0, b: 0 })
    const end = gradientColorAt(10, 10, ['#000000', '#ffffff'])
    expect(end.r).toBeCloseTo(1); expect(end.g).toBeCloseTo(1); expect(end.b).toBeCloseTo(1)
  })
  it('two stops lerp linearly at the midpoint', () => {
    const mid = gradientColorAt(5, 10, ['#000000', '#ffffff'])
    expect(mid.r).toBeCloseTo(0.5)
  })
  it('three stops band the run into halves', () => {
    const mid = gradientColorAt(5, 10, ['#ff0000', '#00ff00', '#0000ff'])
    expect(mid.g).toBeGreaterThan(0.9)
  })
})
