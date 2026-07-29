import { describe, it, expect } from 'vitest'
import { cocFor, apertureRadiusPx, apertureOffsets } from '~/lib/compositor/dofMath'

describe('cocFor', () => {
  it('is zero inside the sharp band and grows outside it', () => {
    expect(cocFor(0.5, 0.5, 0.2)).toBe(0)
    expect(cocFor(0.55, 0.5, 0.2)).toBe(0)   // within range/2
    expect(cocFor(0.8, 0.5, 0.2)).toBeGreaterThan(0)
  })
  it('is symmetric in front of and behind the focal plane', () => {
    expect(cocFor(0.2, 0.5, 0.1)).toBeCloseTo(cocFor(0.8, 0.5, 0.1), 10)
  })
  it('never exceeds 1', () => {
    expect(cocFor(0, 1, 0)).toBeLessThanOrEqual(1)
    expect(cocFor(1, 0, 0)).toBeLessThanOrEqual(1)
  })
  it('a full-width sharp band defocuses nothing', () => {
    for (const d of [0, 0.25, 0.5, 0.75, 1]) expect(cocFor(d, 0.5, 2)).toBe(0)
  })
})

describe('apertureRadiusPx', () => {
  it('scales with canvas width so preview and bake match', () => {
    expect(apertureRadiusPx(0.02, 1000)).toBeCloseTo(20, 10)
    expect(apertureRadiusPx(0.02, 2000)).toBeCloseTo(40, 10)
  })
  it('is zero at zero aperture', () => {
    expect(apertureRadiusPx(0, 4000)).toBe(0)
  })
})

describe('apertureOffsets', () => {
  it('returns the requested tap count', () => {
    expect(apertureOffsets(32, 6, 0)).toHaveLength(32)
  })
  it('keeps every sample inside the unit disc', () => {
    for (const o of apertureOffsets(64, 6, 0)) {
      expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
  it('bladeCount < 3 gives a circular iris reaching the rim', () => {
    const r = apertureOffsets(128, 0, 0).map(o => Math.hypot(o.x, o.y))
    expect(Math.max(...r)).toBeGreaterThan(0.95)
  })
  it('a polygonal iris is tighter than a circular one', () => {
    const area = (n: number) => apertureOffsets(256, n, 0)
      .reduce((s, o) => s + Math.hypot(o.x, o.y), 0)
    expect(area(3)).toBeLessThan(area(0))
  })
  it('rotation changes the sample set but not its size', () => {
    const a = apertureOffsets(32, 6, 0), b = apertureOffsets(32, 6, 30)
    expect(b).toHaveLength(32)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })
  it('is deterministic — bakes must not shimmer', () => {
    expect(apertureOffsets(32, 6, 15)).toEqual(apertureOffsets(32, 6, 15))
  })
})
