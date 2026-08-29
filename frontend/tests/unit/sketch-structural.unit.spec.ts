import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { addPoint, addLine, addPath, repeatEntities, mirrorEntities } from '~/lib/sketch/edit'
import { solve } from '~/lib/sketch/solve'
import { getPoint } from '~/lib/sketch/model'

const empty = (): SketchDoc => ({ entities: [], constraints: [] })

describe('addPath', () => {
  it('adds a path and auto-equalDist for each arc segment', () => {
    const d = empty()
    const a = addPoint(d, 0, 0), b = addPoint(d, 4, 0), c = addPoint(d, 4, 4)
    const ctr = addPoint(d, 4, 2)
    const P = addPath(d, [a, b, c], [{ kind: 'line' }, { kind: 'arc', center: ctr, sweep: 1 }])
    expect(P).not.toBe('')
    const eq = d.constraints.filter(k => k.kind === 'equalDist')
    expect(eq).toHaveLength(1)
    expect(eq[0]!.refs).toEqual([ctr, b, ctr, c])
  })

  it('rejects a segment-count mismatch without touching the doc', () => {
    const d = empty()
    const a = addPoint(d, 0, 0), b = addPoint(d, 4, 0)
    const before = d.entities.length
    expect(addPath(d, [a, b], [])).toBe('')
    expect(d.entities.length).toBe(before)
  })
})

describe('repeatEntities', () => {
  it('creates rotated live copies that the solver keeps in formation', () => {
    const d = empty()
    const ctr = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 2, 0), b = addPoint(d, 4, 0)
    const L = addLine(d, a, b)
    const copies = repeatEntities(d, [L], ctr, 4)     // 3 copies at 90/180/270°
    expect(copies).toHaveLength(3)
    // copy points start AT their rotated positions (solver already satisfied)
    const rot = d.constraints.filter(c => c.kind === 'rotatedFrom')
    expect(rot).toHaveLength(6)                        // 2 points × 3 copies
    const res = solve(d, { maxIter: 40 })
    expect(res.converged).toBe(true)
    // drag the ORIGINAL outer point; copies must follow to stay rotated
    solve(d, { maxIter: 80, drag: { point: b, x: 5, y: 1 } })
    const bP = getPoint(d, b)!
    // the 90° copy of b must equal rotate(b, 90°) about origin: (−y, x)
    const copyB = d.constraints.find(c => c.kind === 'rotatedFrom' && c.refs[1] === b && c.value === 90)!.refs[0]!
    const cp = getPoint(d, copyB)!
    expect(cp.x).toBeCloseTo(-bP.y, 3)
    expect(cp.y).toBeCloseTo(bP.x, 3)
  })

  it('copies intra-closure constraints (an arc path keeps its equalDist in each copy)', () => {
    const d = empty()
    const ctr = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 2, 0), b = addPoint(d, 4, 0), m = addPoint(d, 3, 1)
    const P = addPath(d, [a, b], [{ kind: 'arc', center: m, sweep: 1 }])
    repeatEntities(d, [P], ctr, 3)
    expect(d.constraints.filter(c => c.kind === 'equalDist')).toHaveLength(3) // original + 2 copies
  })
})

describe('mirrorEntities', () => {
  it('creates a reflected live copy and flips arc sweep', () => {
    const d = empty()
    const x1 = addPoint(d, -5, 0, { fixed: true }), x2 = addPoint(d, 5, 0, { fixed: true })
    const AX = addLine(d, x1, x2)
    const a = addPoint(d, 1, 1), b = addPoint(d, 3, 1), m = addPoint(d, 2, 2)
    const P = addPath(d, [a, b], [{ kind: 'arc', center: m, sweep: 1 }])
    mirrorEntities(d, [P], AX)
    const mirrored = d.constraints.filter(c => c.kind === 'mirroredFrom')
    expect(mirrored).toHaveLength(3)                   // a, b, m
    const copyA = mirrored.find(c => c.refs[1] === a)!.refs[0]!
    expect(getPoint(d, copyA)).toMatchObject({ x: 1, y: -1 })  // reflected across x-axis
    const copyPath = d.entities.find(e => e.kind === 'path' && e.id !== P) as any
    expect(copyPath.segments[0].sweep).toBe(0)         // flipped
  })
})
