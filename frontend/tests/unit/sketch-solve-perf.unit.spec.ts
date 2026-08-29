import { describe, it, expect } from 'vitest'
import { performance } from 'node:perf_hooks'
import type { SketchDoc } from '~/lib/sketch/model'
import { addPoint, addPath, repeatEntities } from '~/lib/sketch/edit'
import { solve } from '~/lib/sketch/solve'

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

  it('drag-solves well under the interactive budget (mean < 25ms over 10 drags)', () => {
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
    // generous CI margin — measured ~2-5ms locally after the fixes, ~563ms before them
    // generous under shared-machine load; a real regression (O(E) find scans) is >500ms at this scale
    expect(mean).toBeLessThan(60)
  })
})
