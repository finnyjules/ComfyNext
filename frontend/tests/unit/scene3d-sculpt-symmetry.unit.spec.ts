import { describe, it, expect } from 'vitest'
import { expandStamp } from '~/lib/scene3d/sculpt/symmetry'
import type { BrushStamp } from '~/lib/scene3d/sculpt/brushes'

// DELIBERATELY ASYMMETRIC — a stamp on an axis or at the origin would pass
// against a broken mirror by coincidence.
const stamp: BrushStamp = {
  centre: [0.3, 0.7, -0.2], normal: [0.6, 0.8, 0], radius: 0.1, strength: 0.5, invert: false,
}

// A grab stamp carries `drag` too — also deliberately asymmetric (not
// axis-aligned), so a broken transform (e.g. copying `drag` unchanged, or
// negating/rotating the wrong component) doesn't pass by coincidence.
const grabStamp: BrushStamp = {
  centre: [0.3, 0.7, -0.2], normal: [0.6, 0.8, 0], radius: 0.1, strength: 0.5, invert: false,
  drag: [0.4, -0.5, 0.9],
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

  it('leaves drag undefined when the original stamp has none', () => {
    const out = expandStamp(stamp, { mode: 'mirror', axis: 0, count: 1 })
    expect(out[0]!.drag).toBeUndefined()
    expect(out[1]!.drag).toBeUndefined()
  })

  it('mirrors `drag` by negating the mirrored axis component (grab)', () => {
    // `drag` is a DIRECTION, not a position — a mirrored grab must pull the
    // mirrored side in the mirrored direction. Copying it unchanged (Finding
    // 1) would drag both sides the same way instead.
    const out = expandStamp(grabStamp, { mode: 'mirror', axis: 0, count: 1 })
    expect(out).toHaveLength(2)
    expect(out[0]!.drag).toEqual([0.4, -0.5, 0.9])       // original untouched
    expect(out[1]!.drag).toEqual([-0.4, -0.5, 0.9])      // X component negated only
  })

  it('rotates `drag` about the axis by the same angle as centre/normal (radial)', () => {
    const angle = Math.PI / 2 // quarter turn, easy to check by hand
    const out = expandStamp(grabStamp, { mode: 'radial', axis: 1, count: 4 })
    expect(out).toHaveLength(4)
    expect(out[0]!.drag).toEqual([0.4, -0.5, 0.9]) // original, angle 0
    // Copy 1 is rotated by 2π/4 = π/2 about Y. Matches `rotateAbout`'s fixed
    // cyclic convention for axis=1 (a=(axis+1)%3=Z, b=(axis+2)%3=X):
    // (z,x) -> (z cosθ - x sinθ, z sinθ + x cosθ), same rotation direction the
    // existing centre/normal radial test already exercises for this axis.
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const [dx, , dz] = grabStamp.drag!
    const expectedZ = dz * cos - dx * sin
    const expectedX = dz * sin + dx * cos
    expect(out[1]!.drag![0]).toBeCloseTo(expectedX, 6)
    expect(out[1]!.drag![1]).toBeCloseTo(grabStamp.drag![1], 6) // Y (the rotation axis) untouched
    expect(out[1]!.drag![2]).toBeCloseTo(expectedZ, 6)
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
