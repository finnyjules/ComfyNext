import { describe, it, expect } from 'vitest'
import { arrange } from '~/lib/geoshape/arrange'
import { DEFAULT_CONFIG } from '~/lib/geoshape/config'

describe('geoshape arrange', () => {
  it('radial places `count` clones on a circle of `radius`', () => {
    const p = arrange({ ...DEFAULT_CONFIG, layout: 'radial', count: 6, radius: 100, rotateStep: 0, scaleStart: 1, scaleEnd: 1 })
    expect(p).toHaveLength(6)
    for (const c of p) expect(Math.hypot(c.x, c.y)).toBeCloseTo(100, 1)
  })
  it('scaleStart→scaleEnd interpolates across clones', () => {
    const p = arrange({ ...DEFAULT_CONFIG, count: 5, scaleStart: 1, scaleEnd: 2 })
    expect(p[0]!.scale).toBeCloseTo(1, 3)
    expect(p[4]!.scale).toBeCloseTo(2, 3)
  })
  it('rotateStep accumulates linearly', () => {
    const p = arrange({ ...DEFAULT_CONFIG, count: 4, rotateBase: 10, rotateStep: 5 })
    expect(p[0]!.rotate).toBeCloseTo(10, 3)
    expect(p[3]!.rotate).toBeCloseTo(25, 3)
  })
  it('grid places cols*rows clones', () => {
    const p = arrange({ ...DEFAULT_CONFIG, layout: 'grid', gridCols: 3, gridRows: 2 })
    expect(p).toHaveLength(6)
  })
  it('radial angle is correct (catches a radians mixup)', () => {
    const p = arrange({ ...DEFAULT_CONFIG, layout: 'radial', count: 4, radius: 100, spin: 0, angleStep: 90, evenAngle: false })
    const expectedAngleDeg = [0, 90]
    for (const [i, deg] of expectedAngleDeg.entries()) {
      const rad = deg * Math.PI / 180
      expect(p[i]!.x).toBeCloseTo(100 * Math.cos(rad), 1)
      expect(p[i]!.y).toBeCloseTo(100 * Math.sin(rad), 1)
    }
  })
  it('count:1 returns a single finite placement (no NaN scale)', () => {
    const p = arrange({ ...DEFAULT_CONFIG, layout: 'radial', count: 1, scaleStart: 1, scaleEnd: 2 })
    expect(p).toHaveLength(1)
    expect(Number.isFinite(p[0]!.scale)).toBe(true)
    expect(p[0]!.scale).toBeCloseTo(1, 3)
  })
  it('evenAngle (default) spreads any count evenly around the ring — no collapse at count>6', () => {
    // count 7: the bug was clone 6 landing at i*60=360==0, on top of clone 0.
    const p = arrange({ ...DEFAULT_CONFIG, layout: 'radial', count: 7, radius: 100, spin: 0, evenAngle: true })
    expect(p).toHaveLength(7)
    // every clone sits at a DISTINCT angle 360/7 apart → no two coincide
    const angleOf = (c: { x: number; y: number }) => ((Math.atan2(c.y, c.x) * 180 / Math.PI) + 360) % 360
    const gap = angleOf(p[1]!) - angleOf(p[0]!)
    expect(gap).toBeCloseTo(360 / 7, 1)
    // clone 6 (the one that used to collapse onto clone 0) is NOT at clone 0's position
    expect(Math.hypot(p[6]!.x - p[0]!.x, p[6]!.y - p[0]!.y)).toBeGreaterThan(1)
  })
  it('evenAngle:false uses the raw angleStep', () => {
    const p = arrange({ ...DEFAULT_CONFIG, layout: 'radial', count: 4, radius: 100, spin: 0, angleStep: 30, evenAngle: false })
    // clone 1 at 30° (raw step), not 90° (even 360/4)
    expect(p[1]!.x).toBeCloseTo(100 * Math.cos(30 * Math.PI / 180), 1)
    expect(p[1]!.y).toBeCloseTo(100 * Math.sin(30 * Math.PI / 180), 1)
  })
})
