import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { getPoint } from '~/lib/sketch/model'
import { solve } from '~/lib/sketch/solve'
import { dist, distPointToLine } from '~/lib/sketch/geom'

// A horizontal line on the x-axis + a circle above it, made tangent.
function tangentSetup(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0, fixed: true },
      { id: 'b', kind: 'point', x: 10, y: 0, fixed: true },
      { id: 'cc', kind: 'point', x: 5, y: 8 },   // starts too high
      { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
      { id: 'C', kind: 'circle', center: 'cc', r: 3 },
    ],
    constraints: [
      { id: 'k', kind: 'tangentLineCircle', refs: ['L', 'C'] },
      { id: 'rr', kind: 'radius', refs: ['C'], value: 3 },
    ],
  }
}

describe('solve', () => {
  it('drives a circle down until it is tangent to a fixed line', () => {
    const d = tangentSetup()
    const res = solve(d, { maxIter: 60 })
    expect(res.converged).toBe(true)
    const cen = getPoint(d, 'cc')!
    // tangent ⇒ perpendicular distance from center to line equals r (=3)
    expect(Math.abs(distPointToLine({ x: cen.x, y: cen.y }, { x: 0, y: 0 }, { x: 10, y: 0 }))).toBeCloseTo(3, 4)
  })

  it('keeps tangency after the line is rotated via a drag on a free endpoint', () => {
    const d = tangentSetup()
    // free endpoint b so a drag can rotate the line
    ;(d.entities[1] as any).fixed = false
    solve(d, { maxIter: 60 })
    // drag b up to (10, 6): the line tilts, the circle must roll to stay tangent
    const res = solve(d, { maxIter: 80, drag: { point: 'b', x: 10, y: 6 } })
    expect(res.converged).toBe(true)
    const a = getPoint(d, 'a')!, b = getPoint(d, 'b')!, cen = getPoint(d, 'cc')!
    expect(b.x).toBeCloseTo(10, 3); expect(b.y).toBeCloseTo(6, 3) // drag honored
    const perp = Math.abs(distPointToLine({ x: cen.x, y: cen.y }, { x: a.x, y: a.y }, { x: b.x, y: b.y }))
    expect(perp).toBeCloseTo(3, 3) // still tangent
  })

  it('reverts positions when it cannot converge (over-constrained)', () => {
    const d: SketchDoc = {
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 10, y: 0 },
      ],
      constraints: [
        { id: 'd1', kind: 'distance', refs: ['a', 'b'], value: 10 },
        { id: 'd2', kind: 'distance', refs: ['a', 'b'], value: 20 }, // contradiction
      ],
    }
    const res = solve(d, { maxIter: 40 })
    expect(res.converged).toBe(false)
    // positions restored to the pre-call state
    expect(getPoint(d, 'b')).toMatchObject({ x: 10, y: 0 })
  })

  it('stops iterating once the hard residual is converged (no maxIter burn)', () => {
    const d = tangentSetup()
    const res = solve(d, { maxIter: 60 })
    expect(res.converged).toBe(true)
    // empirically converges in ~10 iterations; the old dead break burned all 60
    expect(res.iterations).toBeLessThan(30)
    // precision must NOT degrade: tangency still holds to 4 decimals
    const cen = getPoint(d, 'cc')!
    expect(Math.abs(distPointToLine({ x: cen.x, y: cen.y }, { x: 0, y: 0 }, { x: 10, y: 0 }))).toBeCloseTo(3, 4)
  })

  it('n===0 path honors the revert contract and the shared threshold', () => {
    // two points, one fixed; drag the other; a contradictory distance pair
    const d: SketchDoc = {
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0, fixed: true },
        { id: 'b', kind: 'point', x: 10, y: 0 },
      ],
      constraints: [
        { id: 'd1', kind: 'distance', refs: ['a', 'b'], value: 10 },
        { id: 'd2', kind: 'distance', refs: ['a', 'b'], value: 20 },
      ],
    }
    // dragging b pins it → zero free slots → n===0 branch, over-constrained
    const res = solve(d, { maxIter: 40, drag: { point: 'b', x: 3, y: 4 } })
    expect(res.converged).toBe(false)
    // the dragged point must be restored to its pre-call position
    expect(getPoint(d, 'b')).toMatchObject({ x: 10, y: 0 })
  })
})
