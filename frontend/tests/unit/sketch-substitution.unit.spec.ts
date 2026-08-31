import { describe, it, expect } from 'vitest'
import type { SketchDoc, EntityId } from '~/lib/sketch/model'
import { getPoint } from '~/lib/sketch/model'
import { addPoint, addLine, addConstraint, repeatEntities, mirrorEntities } from '~/lib/sketch/edit'
import { solve } from '~/lib/sketch/solve'
import { constraintResiduals } from '~/lib/sketch/residuals'
import { analyzeDerived } from '~/lib/sketch/substitute'

// R(θ)·(p − c) + c
function rot(px: number, py: number, cx: number, cy: number, deg: number): { x: number; y: number } {
  const a = deg * Math.PI / 180, co = Math.cos(a), si = Math.sin(a)
  const dx = px - cx, dy = py - cy
  return { x: cx + co * dx - si * dy, y: cy + si * dx + co * dy }
}

describe('copy-point substitution: identification', () => {
  it('finds zero derived points in a plain (non-repeat) doc → solver is a no-op layer', () => {
    const d: SketchDoc = { entities: [], constraints: [] }
    const a = addPoint(d, 0, 0), b = addPoint(d, 5, 0)
    addConstraint(d, 'distance', [a, b], 5)
    const an = analyzeDerived(d, new Set())
    expect(an.rules.size).toBe(0)
    expect(an.excluded.size).toBe(0)
    expect(an.order).toHaveLength(0)
  })

  it('identifies every rotated copy point of a repeat×6 unit as derived', () => {
    const d: SketchDoc = { entities: [], constraints: [] }
    const rc = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 4, 0), b = addPoint(d, 6, 1)
    addConstraint(d, 'distance', [a, b], Math.hypot(2, 1))
    repeatEntities(d, [a, b], rc, 6) // 5 copies × 2 pts = 10 derived
    const an = analyzeDerived(d, new Set())
    expect(an.rules.size).toBe(10)
    expect(an.excluded.size).toBe(10) // all 10 rotatedFrom defining rules excluded
    // every derived id is a real copy point, never a base point or the center
    for (const id of an.rules.keys()) expect([rc, a, b]).not.toContain(id)
  })

  it('does NOT treat a dragged copy point as derived (keeps its rule active)', () => {
    const d: SketchDoc = { entities: [], constraints: [] }
    const rc = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 4, 0), b = addPoint(d, 6, 1)
    addConstraint(d, 'distance', [a, b], Math.hypot(2, 1))
    repeatEntities(d, [a, b], rc, 6)
    // pick one copy point and pretend it is being dragged
    const someCopy = [...analyzeDerived(d, new Set()).rules.keys()][0]!
    const an = analyzeDerived(d, new Set([someCopy]))
    expect(an.rules.has(someCopy)).toBe(false)
    expect(an.rules.size).toBe(9)
  })
})

describe('copy-point substitution: parity with the constraint semantics', () => {
  it('every rotatedFrom rule is satisfied (≈0) after a substituted solve', () => {
    const d: SketchDoc = { entities: [], constraints: [] }
    const rc = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 4, 0), b = addPoint(d, 6, 1), c = addPoint(d, 5, 3)
    addConstraint(d, 'distance', [a, b], Math.hypot(2, 1))
    addConstraint(d, 'distance', [b, c], Math.hypot(1, 2))
    repeatEntities(d, [a, b, c], rc, 6)
    const res = solve(d, { maxIter: 80 })
    expect(res.converged).toBe(true)
    // the reported residual (over the FILTERED set) is tiny...
    expect(res.residualNorm).toBeLessThan(1e-3)
    // ...AND, independently, the FULL residual set (incl. the excluded defining
    // rules) is also ≈0 — i.e. forward substitution really satisfies them.
    expect(Math.hypot(...constraintResiduals(d))).toBeLessThan(1e-6)
  })

  it('holds 6-fold rotational symmetry exactly when the base outer anchor is dragged', () => {
    const d: SketchDoc = { entities: [], constraints: [] }
    const rc = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 4, 0), b = addPoint(d, 6, 1)
    addConstraint(d, 'distance', [a, b], Math.hypot(2, 1))
    const copies = repeatEntities(d, [a, b], rc, 6)
    expect(copies).toHaveLength(5)
    solve(d, { maxIter: 80 })

    // drag the base outer anchor `b` to a new spot; copies must follow
    const res = solve(d, { maxIter: 80, drag: { point: b, x: 7, y: -2 } })
    expect(res.converged).toBe(true)
    const bp = getPoint(d, b)!
    expect(bp.x).toBeCloseTo(7, 6); expect(bp.y).toBeCloseTo(-2, 6) // drag honored

    // each rotatedFrom copy of `b` must equal R(k·60°)·b about the origin
    const rulesForB = d.constraints.filter(c => c.kind === 'rotatedFrom' && c.refs[1] === b)
    expect(rulesForB).toHaveLength(5)
    for (const k of rulesForB) {
      const cp = getPoint(d, k.refs[0]!)!
      const want = rot(bp.x, bp.y, 0, 0, k.value!)
      expect(cp.x).toBeCloseTo(want.x, 4)
      expect(cp.y).toBeCloseTo(want.y, 4)
    }
  })

  it('mirroredFrom copies land at the exact reflection after a substituted solve+drag', () => {
    const d: SketchDoc = { entities: [], constraints: [] }
    const x1 = addPoint(d, -5, 0, { fixed: true }), x2 = addPoint(d, 5, 0, { fixed: true })
    const AX = addLine(d, x1, x2)         // mirror across the x-axis
    const a = addPoint(d, 1, 2), b = addPoint(d, 3, 4)
    addConstraint(d, 'distance', [a, b], Math.hypot(2, 2))
    const created = mirrorEntities(d, [a, b], AX)
    expect(created.length).toBeGreaterThan(0)
    solve(d, { maxIter: 60 })

    const res = solve(d, { maxIter: 60, drag: { point: a, x: 2, y: 3 } })
    expect(res.converged).toBe(true)
    // copy of `a` = reflection of a across x-axis = (a.x, −a.y)
    const ap = getPoint(d, a)!
    const copyA = d.constraints.find(c => c.kind === 'mirroredFrom' && c.refs[1] === a)!.refs[0]!
    const cp = getPoint(d, copyA)!
    expect(cp.x).toBeCloseTo(ap.x, 4)
    expect(cp.y).toBeCloseTo(-ap.y, 4)
    expect(Math.hypot(...constraintResiduals(d))).toBeLessThan(1e-6)
  })

  it('handles a chained (derived-of-derived) source: mirror OF a rotated copy', () => {
    // rotate a unit, then mirror the whole thing → some mirrored copies have a
    // rotated (itself derived) point as their `orig` source, exercising the
    // topological-order forward substitution + recursive chain rule.
    const d: SketchDoc = { entities: [], constraints: [] }
    const rc = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 4, 0), b = addPoint(d, 6, 1)
    addConstraint(d, 'distance', [a, b], Math.hypot(2, 1))
    const copies = repeatEntities(d, [a, b], rc, 4) // rotated copies
    const x1 = addPoint(d, -8, -3, { fixed: true }), x2 = addPoint(d, 8, -3, { fixed: true })
    const AX = addLine(d, x1, x2)
    // mirror EVERYTHING (base + rotated copies) across a horizontal axis
    const allPts = [a, b, ...copies.flat()]
    mirrorEntities(d, allPts, AX)
    const an = analyzeDerived(d, new Set())
    // there must be at least one mirrored point whose `orig` is itself derived
    const derivedSet = new Set(an.rules.keys())
    const hasChained = [...an.rules.values()].some(r => r.kind === 'mirroredFrom' && derivedSet.has(r.origId))
    expect(hasChained).toBe(true)

    const res = solve(d, { maxIter: 100, drag: { point: b, x: 5, y: 2 } })
    expect(res.converged).toBe(true)
    // full residual set (all rotate + mirror rules) satisfied by construction
    expect(Math.hypot(...constraintResiduals(d))).toBeLessThan(1e-5)
  })
})

describe('copy-point substitution: chain-rule is load-bearing', () => {
  // The tests above are all BASE-determined: the base point is dragged (or
  // pinned) directly, and the copy is only ever checked AFTER the fact. They'd
  // still pass with a broken derivedGradients() chain-rule block, because the
  // solver's convergence gate is the TRUE residual (constraintResiduals over
  // the live, forward-substituted doc) — a wrong Jacobian only risks slower or
  // failed convergence, never a wrong-but-"converged" answer, since a bogus
  // descent direction just gets rejected by the LM accept/reject step.
  //
  // This test instead puts the ONLY hard constraint on the COPY and leaves the
  // base fully free, so the solver has no way to place the base correctly
  // except by chain-ruling that constraint's Jacobian back through R(θ)/(I−R(θ))
  // onto the base's x/y columns. If that block were wrong, the Gauss-Newton
  // step direction would not point the base toward the analytic solution and
  // (for this small, well-conditioned, EXACTLY-determined 2-eq/2-unknown linear
  // system) the solve reliably fails to converge — see the corrupt-and-confirm
  // check in the PR description; this is intentionally NOT re-asserted here
  // (there is no public seam to inject a broken derivedGradients from a spec).
  it('a hard constraint on the COPY drives the free BASE to the analytically-known position', () => {
    const d: SketchDoc = { entities: [], constraints: [] }
    const center = addPoint(d, 0, 0, { fixed: true })
    const base = addPoint(d, 1, 1) // free; deliberately far from the solution
    const copy = addPoint(d, 0, 0) // derived once solved — position is irrelevant here
    addConstraint(d, 'rotatedFrom', [copy, base, center], 90)

    // Pin the copy to a fixed target T=(0,4). Since copy = rot90(base) about
    // the origin = (−base.y, base.x), coincident[copy, T] is only satisfiable
    // by base = (4, 0):
    //   −base.y = 0  ⇒ base.y = 0
    //    base.x = 4  ⇒ base.x = 4
    // copy's defining rotatedFrom rule is EXCLUDED from the active residual set
    // (satisfied by forward substitution), so the ONLY hard residual the
    // solver optimizes is coincident[copy, T] — and copy is not a free slot at
    // all, so hitting that residual is impossible without the chain rule
    // routing it onto base's px/py columns.
    const target = addPoint(d, 0, 4, { fixed: true })
    addConstraint(d, 'coincident', [copy, target])

    const res = solve(d, { maxIter: 80 })
    expect(res.converged).toBe(true)

    const bp = getPoint(d, base)!
    expect(bp.x).toBeCloseTo(4, 3)
    expect(bp.y).toBeCloseTo(0, 3)

    // and, independently, the copy itself really landed on the target
    const cp = getPoint(d, copy)!
    expect(cp.x).toBeCloseTo(0, 3)
    expect(cp.y).toBeCloseTo(4, 3)
  })
})
