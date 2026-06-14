import { describe, it, expect } from 'vitest'
import { snakePoint, buildRibbonGeometryData, ribbonInstance, scrollOffset, loopTiles, type RibbonGeoParams } from '../../app/lib/spacetype/ribbonGeometry'

const P: RibbonGeoParams = { segments: 8, length: 16, amplitude: 3, frequency: 1.5, height: 1, uRepeat: 6, phase: 0 }

describe('snakePoint', () => {
  it('centers x and applies the sine in y', () => {
    const a = snakePoint(0, P), b = snakePoint(1, P)
    expect(a.x).toBeCloseTo(-P.length / 2, 6)
    expect(b.x).toBeCloseTo(P.length / 2, 6)
    expect(snakePoint(0, P).y).toBeCloseTo(P.amplitude * Math.sin(0), 6)
  })
})

describe('buildRibbonGeometryData', () => {
  const g = buildRibbonGeometryData(P)
  it('emits two vertices per sample', () => {
    expect(g.positions.length).toBe((P.segments + 1) * 2 * 3)
    expect(g.uvs.length).toBe((P.segments + 1) * 2 * 2)
  })
  it('emits 6 indices per segment (two triangles)', () => {
    expect(g.indices.length).toBe(P.segments * 6)
  })
  it('U spans 0..uRepeat, V is 0 or 1', () => {
    let maxU = 0; const vs = new Set<number>()
    for (let i = 0; i < g.uvs.length; i += 2) { maxU = Math.max(maxU, g.uvs[i]); vs.add(Math.round(g.uvs[i + 1])) }
    expect(maxU).toBeCloseTo(P.uRepeat, 6)
    expect([...vs].sort()).toEqual([0, 1])
  })
})

describe('ribbonInstance', () => {
  it('alternate negates the snake direction on odd ribbons', () => {
    expect(ribbonInstance(0, { count: 3, spacing: 1, offset: 0.2, alternate: true }).dir).toBe(1)
    expect(ribbonInstance(1, { count: 3, spacing: 1, offset: 0.2, alternate: true }).dir).toBe(-1)
  })
  it('centers ribbons around 0 in y', () => {
    const mid = ribbonInstance(1, { count: 3, spacing: 2, offset: 0, alternate: false })
    expect(mid.y).toBeCloseTo(0, 6)
  })
})

describe('scrollOffset / loopTiles (seamless loop)', () => {
  it('scrolls a whole number of tiles per loop for ANY speed', () => {
    for (const speed of [0.6, 1, 1.37, 2.4, 0.05]) {
      const total = scrollOffset(1, speed, 4) - scrollOffset(0, speed, 4)
      expect(Number.isInteger(total)).toBe(true)
    }
  })
  it('loopTiles rounds speed*uRepeat and clamps to >= 0', () => {
    expect(loopTiles(0.6, 4)).toBe(2)
    expect(loopTiles(1, 4)).toBe(4)
    expect(loopTiles(-3, 4)).toBe(0)
  })
})
