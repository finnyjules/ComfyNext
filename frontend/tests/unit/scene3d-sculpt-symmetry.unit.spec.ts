import { describe, it, expect } from 'vitest'
import { expandStamp } from '~/lib/scene3d/sculpt/symmetry'
import type { BrushStamp } from '~/lib/scene3d/sculpt/brushes'

// DELIBERATELY ASYMMETRIC — a stamp on an axis or at the origin would pass
// against a broken mirror by coincidence.
const stamp: BrushStamp = {
  centre: [0.3, 0.7, -0.2], normal: [0.6, 0.8, 0], radius: 0.1, strength: 0.5, invert: false,
}

describe('symmetry', () => {
  it('passes the stamp through unchanged when off', () => {
    expect(expandStamp(stamp, { mode: 'none', axis: 0, count: 1 })).toEqual([stamp])
  })

  it('mirrors position AND normal across X', () => {
    const out = expandStamp(stamp, { mode: 'mirror', axis: 0, count: 1 })
    expect(out).toHaveLength(2)
    expect(out[1]!.centre).toEqual([-0.3, 0.7, -0.2])
    // The normal must flip too — mirroring only the position tilts every
    // mirrored stroke the wrong way, which reads as a lighting bug.
    expect(out[1]!.normal).toEqual([-0.6, 0.8, 0])
  })

  it('leaves the other components untouched when mirroring', () => {
    const out = expandStamp(stamp, { mode: 'mirror', axis: 0, count: 1 })
    expect(out[1]!.radius).toBe(0.1)
    expect(out[1]!.strength).toBe(0.5)
  })

  it('produces N stamps around the axis in radial mode', () => {
    const out = expandStamp(stamp, { mode: 'radial', axis: 1, count: 8 })
    expect(out).toHaveLength(8)
    // Every copy keeps its distance from the axis and its height.
    const r0 = Math.hypot(stamp.centre[0], stamp.centre[2])
    for (const s of out) {
      expect(Math.hypot(s.centre[0], s.centre[2])).toBeCloseTo(r0, 6)
      expect(s.centre[1]).toBeCloseTo(0.7, 6)
    }
    // ...and they are actually distinct, not eight copies of the same point.
    const xs = new Set(out.map((s) => s.centre[0]!.toFixed(4)))
    expect(xs.size).toBe(8)
  })

  it('radial with count 1 is a no-op', () => {
    expect(expandStamp(stamp, { mode: 'radial', axis: 1, count: 1 })).toEqual([stamp])
  })
})
