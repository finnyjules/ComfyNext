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
})
