import { describe, it, expect } from 'vitest'
import { streamerRadius, streamerCycle, tilePose, gradientColorAt } from '../../app/lib/spacetype/streamerLayout'

describe('streamerRadius / streamerCycle', () => {
  it('radius = segmentCount*segmentSpace/PI', () => {
    expect(streamerRadius(22, 23)).toBeCloseTo((22 * 23) / Math.PI)
  })
  it('cycle = 2*segmentCount*(1+middleStretch), rounded', () => {
    expect(streamerCycle(22, 0)).toBe(44)
    expect(streamerCycle(10, 1)).toBe(40)
  })
})

describe('tilePose (middleStretch 0 = oval)', () => {
  const sc = 20, ss = 10, ms = 0
  it('phase 1/2 (top + right arc) are side +1, phase 3/4 are side -1', () => {
    expect(tilePose(0, sc, ss, ms).side).toBe(1)
    expect(tilePose(sc, sc, ss, ms).side).toBe(1)
    expect(tilePose(sc + 1, sc, ss, ms).side).toBe(-1)
  })
  it('top arc rotates 0→~PI across segmentCount steps', () => {
    expect(tilePose(0, sc, ss, ms).rot).toBeCloseTo(0)
    expect(tilePose(sc, sc, ss, ms).rot).toBeCloseTo(Math.PI)
  })
  it('return run sits a diameter (2*radius) below in y', () => {
    const r = streamerRadius(sc, ss)
    expect(tilePose(sc + 5, sc, ss, ms).y).toBeCloseTo(2 * r)
  })
  it('jumper increments once per full cycle (text longer than one loop)', () => {
    const cyc = streamerCycle(sc, ms)
    expect(tilePose(0, sc, ss, ms).jumper).toBe(0)
    expect(tilePose(cyc, sc, ss, ms).jumper).toBe(1)
  })
  it('is periodic in i modulo the cycle (same pose shape each loop)', () => {
    const cyc = streamerCycle(sc, ms)
    const a = tilePose(3, sc, ss, ms), b = tilePose(3 + cyc, sc, ss, ms)
    expect(b.x).toBeCloseTo(a.x); expect(b.rot).toBeCloseTo(a.rot); expect(b.side).toBe(a.side)
  })
})

describe('tilePose (middleStretch > 0 = racetrack straights)', () => {
  it('top straight advances x by segmentSpace per step, rot 0', () => {
    const p = tilePose(2, 10, 10, 1)
    expect(p.rot).toBe(0); expect(p.x).toBeCloseTo(2 * 10); expect(p.side).toBe(1)
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
