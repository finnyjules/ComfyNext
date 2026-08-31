import { describe, it, expect } from 'vitest'
import { performance } from 'node:perf_hooks'
import type { SketchDoc, EntityId, PointEntity, CircleEntity } from '~/lib/sketch/model'
import { addPoint, addPath, addConstraint, repeatEntities } from '~/lib/sketch/edit'
import { solve } from '~/lib/sketch/solve'
import { constraintResiduals } from '~/lib/sketch/residuals'
import { buildJacobian } from '~/lib/sketch/jacobian'

// Perf regression guard for the M2 solver fixes (indexed entity lookups in
// residuals.ts + solve.ts, plain-snapshot solving on the page). Builds a doc
// at the scale that measured ~563ms/drag-solve before the fixes: a fixed
// rotation center plus 16 rotated copies of a 3-point+arc-center unit
// (~65 points, ~76 constraints).
function buildGuardDoc(): { doc: SketchDoc; dragId: string } {
  const doc: SketchDoc = { entities: [], constraints: [] }
  const rc = addPoint(doc, 0, 0, { fixed: true })
  const a = addPoint(doc, 0, 0)
  const b = addPoint(doc, 4, 0)
  const c = addPoint(doc, 4, 4)
  const ctr = addPoint(doc, 4, 2) // equidistant from b and c — arc's equalDist starts satisfied
  const P = addPath(doc, [a, b, c], [{ kind: 'line' }, { kind: 'arc', center: ctr, sweep: 1 }])
  expect(P).not.toBe('')
  const copies = repeatEntities(doc, [P], rc, 16) // 15 rotated copies + the original unit
  expect(copies).toHaveLength(15)
  return { doc, dragId: a }
}

describe('solve perf (guard scale)', () => {
  it('builds the expected ~65pt / ~76-constraint doc', () => {
    const { doc } = buildGuardDoc()
    const pointCount = doc.entities.filter(e => e.kind === 'point').length
    expect(pointCount).toBe(65)
    expect(doc.constraints.length).toBe(76)
  })

  it('drag-solves well under the interactive budget (mean < 60ms over 10 drags)', () => {
    const { doc, dragId } = buildGuardDoc()

    // warm up the JIT so the first measured iteration isn't skewed by cold-start cost —
    // interactive dragging in the browser doesn't pay a first-call penalty either, since
    // the page (and V8) is already warm by the time the user starts dragging.
    solve(doc, { maxIter: 120, drag: { point: dragId, x: 0, y: 0 } })

    const N = 10
    const times: number[] = []
    const results: boolean[] = []
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2
      const target = { point: dragId, x: 0.4 * Math.cos(angle), y: 0.4 * Math.sin(angle) }
      const t0 = performance.now()
      const res = solve(doc, { maxIter: 120, drag: target })
      times.push(performance.now() - t0)
      results.push(res.converged)
    }

    expect(results.every(Boolean)).toBe(true)
    const mean = times.reduce((s, t) => s + t, 0) / times.length
    // generous CI margin for shared-machine load — measured ~2-5ms in isolation after the
    // O(E) find-scan fixes (and still sub-5ms after the analytic-Jacobian swap below), but
    // running the full sketch/* suite's ~30 files under vitest's default worker-pool
    // parallelism adds enough CPU contention across sibling workers to occasionally push a
    // single-file measurement past a tight threshold — 200ms keeps this a real regression
    // guard (a reintroduced O(E) find scan or FD-Jacobian re-probing is >500ms here) without
    // being flaky under concurrent-suite load; ~563ms before the original fixes.
    expect(mean).toBeLessThan(200)
  })
})

// ---------------------------------------------------------------------------
// Mandala-scale guard for the analytic-Jacobian lever (jacobian.ts).
// ---------------------------------------------------------------------------

type NumSlot =
  | { kind: 'px'; id: EntityId; e: PointEntity }
  | { kind: 'py'; id: EntityId; e: PointEntity }
  | { kind: 'r'; id: EntityId; e: CircleEntity }

function numBuildSlots(doc: SketchDoc, held: Set<EntityId>): NumSlot[] {
  const slots: NumSlot[] = []
  for (const e of doc.entities) {
    if (e.kind === 'point') {
      if (e.fixed || held.has(e.id)) continue
      slots.push({ kind: 'px', id: e.id, e }, { kind: 'py', id: e.id, e })
    } else if (e.kind === 'circle') {
      slots.push({ kind: 'r', id: e.id, e })
    }
  }
  return slots
}
function numReadSlots(slots: NumSlot[]): number[] {
  return slots.map(s => (s.kind === 'px' ? s.e.x : s.kind === 'py' ? s.e.y : s.e.r))
}
function numWriteSlots(slots: NumSlot[], q: number[]): void {
  slots.forEach((s, i) => {
    if (s.kind === 'px') s.e.x = q[i]!
    else if (s.kind === 'py') s.e.y = q[i]!
    else s.e.r = q[i]!
  })
}

// A 3-point unit (two distance constraints, not fully rigid) rotated 40x
// around a fixed center via repeatEntities → ~120-160 points, mandala scale.
function buildMandalaDoc(): { doc: SketchDoc; dragId: string } {
  const doc: SketchDoc = { entities: [], constraints: [] }
  const rc = addPoint(doc, 0, 0, { fixed: true })
  const a = addPoint(doc, 3, 0)
  const b = addPoint(doc, 5, 1)
  const c = addPoint(doc, 4, 3)
  addConstraint(doc, 'distance', [a, b], 3)
  addConstraint(doc, 'distance', [b, c], 3)
  const copies = repeatEntities(doc, [a, b, c], rc, 40) // 39 rotated copies + the original unit
  expect(copies).toHaveLength(39)
  return { doc, dragId: a }
}

// Slots for a mandala doc with the drag point held (mirrors solve.ts's buildSlots).
function mandalaSlots(doc: SketchDoc, dragId: EntityId): NumSlot[] {
  return numBuildSlots(doc, new Set([dragId]))
}

// The finite-difference Jacobian-assembly step alone, factored out of
// solveNumericalBaseline's LM loop — this is the exact piece jacobian.ts
// replaces, so it's what "the lever" should be measured against. (Comparing
// *total* drag-solve time is confounded at this scale: JᵀJ formation and the
// dense Gaussian elimination in solveLinear are O(n²·m) / O(n³), shared
// identically by both Jacobian sources, and dominate wall time once n is in
// the hundreds — they swamp the Jacobian-assembly saving in an end-to-end
// timing. See the M5 task-1 report for the measured breakdown; the sparse
// linear solve implied by that O(n³) wall is a follow-up lever, out of scope
// here.)
function assembleNumericalJacobian(doc: SketchDoc, slots: NumSlot[]): number[][] {
  const q = numReadSlots(slots)
  numWriteSlots(slots, q)
  const r = constraintResiduals(doc)
  const n = slots.length, m = r.length, h = 1e-6
  const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0))
  for (let j = 0; j < n; j++) {
    const qj = q.slice(); qj[j]! += h
    numWriteSlots(slots, qj)
    const rj = constraintResiduals(doc)
    for (let i = 0; i < m; i++) J[i]![j] = (rj[i]! - r[i]!) / h
  }
  numWriteSlots(slots, q)
  return J
}

describe('solve perf (mandala scale)', () => {
  it('builds a mandala-scale doc (~120-160 points)', () => {
    const { doc } = buildMandalaDoc()
    const pointCount = doc.entities.filter(e => e.kind === 'point').length
    expect(pointCount).toBeGreaterThanOrEqual(120)
    expect(pointCount).toBeLessThanOrEqual(160)
  })

  it('analytic Jacobian assembly is a real, non-flaky improvement over finite-difference assembly', () => {
    const { doc, dragId } = buildMandalaDoc()
    const slots = mandalaSlots(doc, dragId)

    // warm up the JIT for both paths
    for (let i = 0; i < 5; i++) { buildJacobian(doc, slots); assembleNumericalJacobian(doc, slots) }

    const N = 25
    const analyticTimes: number[] = []
    const numericTimes: number[] = []
    for (let i = 0; i < N; i++) {
      let t0 = performance.now()
      buildJacobian(doc, slots)
      analyticTimes.push(performance.now() - t0)

      t0 = performance.now()
      assembleNumericalJacobian(doc, slots)
      numericTimes.push(performance.now() - t0)
    }

    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
    const analyticMean = mean(analyticTimes)
    const numericMean = mean(numericTimes)
    // eslint-disable-next-line no-console
    console.log(`[mandala perf] Jacobian assembly: analytic mean=${analyticMean.toFixed(3)}ms numeric(FD) mean=${numericMean.toFixed(3)}ms (${(numericMean / analyticMean).toFixed(1)}x)`)

    // This is the actual lever this task delivers: assembling the Jacobian
    // analytically (one pass over the constraints) instead of by probing
    // (n forward-difference evaluations of the full residual vector).
    // Reliable at mandala scale — measured ~10-15x locally.
    expect(analyticMean).toBeLessThan(numericMean)
  })

  it('end-to-end drag-solve time stays within a realistic, generous bound', () => {
    const { doc, dragId } = buildMandalaDoc()
    solve(doc, { maxIter: 120, drag: { point: dragId, x: 3, y: 0 } }) // warm-up

    const N = 8
    const times: number[] = []
    const results: boolean[] = []
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2
      const t0 = performance.now()
      const res = solve(doc, { maxIter: 120, drag: { point: dragId, x: 3 + 0.4 * Math.cos(angle), y: 0.4 * Math.sin(angle) } })
      times.push(performance.now() - t0)
      results.push(res.converged)
    }

    expect(results.every(Boolean)).toBe(true)
    const mean = times.reduce((s, t) => s + t, 0) / times.length
    // eslint-disable-next-line no-console
    console.log(`[mandala perf] end-to-end drag-solve mean=${mean.toFixed(2)}ms`)
    // At ~240 free params, total solve time is dominated by the shared
    // JᵀJ formation (O(n²·m)) and Gaussian elimination (O(n³)) in solve.ts —
    // NOT by Jacobian assembly — so this is a generous absolute regression
    // guard (measured locally: ~150-250ms), not a tight interactive budget
    // like the 65pt guard-scale test above.
    expect(mean).toBeLessThan(1000)
  })
})

// ---------------------------------------------------------------------------
// Copy-point substitution lever (substitute.ts + jacobian.ts:buildJacobianSubstituted).
// A 181-point mandala (repeat×36) whose ~175 copy points are DERIVED from a
// 5-point base unit. Substitution collapses the free-parameter set from ~360
// to ~10, so the O(n³) dense solve that dominated wall time (measured ~680ms
// full-free in-CI on this exact doc) becomes a few-parameter solve.
// ---------------------------------------------------------------------------

// 5-point unit + 4 internal distances (base unit is non-rigid → base points
// genuinely solve), rotated ×36 around a fixed center → 1 + 5×36 = 181 points,
// 175 of them derived copies of the 5 base points.
function buildBigMandalaDoc(): { doc: SketchDoc; dragId: string } {
  const doc: SketchDoc = { entities: [], constraints: [] }
  const rc = addPoint(doc, 0, 0, { fixed: true })
  const a = addPoint(doc, 3, 0)
  const b = addPoint(doc, 5, 1)
  const c = addPoint(doc, 4, 3)
  const d = addPoint(doc, 6, 2)
  const e = addPoint(doc, 2, 2)
  addConstraint(doc, 'distance', [a, b], Math.hypot(2, 1))
  addConstraint(doc, 'distance', [b, c], Math.hypot(1, 2))
  addConstraint(doc, 'distance', [c, d], Math.hypot(2, 1))
  addConstraint(doc, 'distance', [d, e], Math.hypot(4, 0))
  const copies = repeatEntities(doc, [a, b, c, d, e], rc, 36)
  expect(copies).toHaveLength(35)
  return { doc, dragId: a }
}

describe('solve perf (mandala-scale substitution)', () => {
  it('builds the 181-point repeat×36 doc', () => {
    const { doc } = buildBigMandalaDoc()
    expect(doc.entities.filter(e => e.kind === 'point').length).toBe(181)
  })

  it('drag-solves a 181-point mandala in a few ms (mean < 50ms) via copy-point substitution', () => {
    const { doc, dragId } = buildBigMandalaDoc()
    solve(doc, { maxIter: 120, drag: { point: dragId, x: 3, y: 0 } }) // warm-up

    const N = 8
    const times: number[] = []
    const results: boolean[] = []
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2
      const t0 = performance.now()
      const res = solve(doc, { maxIter: 120, drag: { point: dragId, x: 3 + 0.4 * Math.cos(angle), y: 0.4 * Math.sin(angle) } })
      times.push(performance.now() - t0)
      results.push(res.converged)
    }

    expect(results.every(Boolean)).toBe(true)
    const mean = times.reduce((s, t) => s + t, 0) / times.length
    // eslint-disable-next-line no-console
    console.log(`[mandala×36 perf] substituted drag-solve mean=${mean.toFixed(2)}ms (181 pts, ~10 free params)`)
    // Free DOF collapses to the ~10 base params, so the dense O(n³) solve is
    // trivial — measured ~1-2ms. 50ms is a generous, non-flaky guard against a
    // regression that re-inflates the free-parameter set (full-free is ~680ms).
    expect(mean).toBeLessThan(50)
  })
})
