import { describe, it, expect } from 'vitest'
import { serpentinePoint, buildStreamerGeometry, gradientColorAt } from '../../app/lib/spacetype/streamerLayout'

describe('serpentinePoint', () => {
  const rowLen = 100, r = 10
  it('row 0 is a straight run at y=0 flowing +x', () => {
    const p = serpentinePoint(20, rowLen, r)
    expect(p.y).toBeCloseTo(0); expect(p.x).toBeCloseTo(20); expect(p.tx).toBeCloseTo(1); expect(p.ty).toBeCloseTo(0)
  })
  it('the arc after row 0 descends to the next row (y = -2r) at the right end', () => {
    const seg = rowLen + Math.PI * r
    const end = serpentinePoint(seg, rowLen, r)       // start of row 1
    expect(end.y).toBeCloseTo(-2 * r); expect(end.x).toBeCloseTo(rowLen)
  })
  it('row 1 flows the opposite direction (−x) one gap down', () => {
    const seg = rowLen + Math.PI * r
    const p = serpentinePoint(seg + 20, rowLen, r)
    expect(p.y).toBeCloseTo(-2 * r); expect(p.tx).toBeCloseTo(-1)
    expect(p.x).toBeCloseTo(rowLen - 20)
  })
})

describe('buildStreamerGeometry (serpentine band)', () => {
  it('cells ≈ pathLength / segmentSpace', () => {
    // rowChars 10, ss 10 → rowLen 100; rows 3, r 10 → path = 3*100 + 2*PI*10
    const path = 3 * 100 + 2 * Math.PI * 10
    expect(buildStreamerGeometry(10, 10, 3, 30, 10).cells).toBe(Math.round(path / 10))
  })
  it('emits 2 verts per sample and 6 indices per quad', () => {
    const g = buildStreamerGeometry(10, 10, 2, 20, 10)
    const verts = g.positions.length / 3
    expect(verts % 2).toBe(0)
    expect(g.indices.length).toBe((verts / 2 - 1) * 6)
  })
  it('band width is along Z = ±depth/2', () => {
    const g = buildStreamerGeometry(10, 10, 2, 24, 10)
    expect(g.positions[2]).toBeCloseTo(12)
    expect(g.positions[5]).toBeCloseTo(-12)
  })
  it('uv.x runs 0→1 across the whole path', () => {
    const g = buildStreamerGeometry(10, 10, 2, 20, 10)
    expect(g.uvs[0]).toBeCloseTo(0)
    expect(g.uvs[g.uvs.length - 2]).toBeCloseTo(1)
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
