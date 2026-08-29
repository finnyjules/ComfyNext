import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { addPoint, addLine, addPath, deleteEntity, repeatEntities, mirrorEntities } from '~/lib/sketch/edit'
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

describe('deleteEntity path awareness (F1)', () => {
  it('deleting an anchor point deletes the path that referenced it (no zombie); repeat still works on a healthy doc', () => {
    const d = empty()
    const a = addPoint(d, 0, 0), b = addPoint(d, 4, 0), c = addPoint(d, 4, 4)
    const ctr = addPoint(d, 4, 2)
    const P = addPath(d, [a, b, c], [{ kind: 'line' }, { kind: 'arc', center: ctr, sweep: 1 }])
    deleteEntity(d, a)
    expect(d.entities.find(e => e.id === P)).toBeUndefined()               // path gone, no zombie
    expect(d.constraints.filter(k => k.kind === 'equalDist')).toHaveLength(0)

    // fresh, healthy doc: repeat still works normally
    const d2 = empty()
    const rc = addPoint(d2, 0, 0, { fixed: true })
    const p1 = addPoint(d2, 2, 0), p2 = addPoint(d2, 4, 0)
    const L = addLine(d2, p1, p2)
    expect(repeatEntities(d2, [L], rc, 4)).toHaveLength(3)
  })

  it('deleting a path removes its auto equalDist, orphan-cleans its exclusive arc center, but keeps a fixed anchor and a point shared with another entity', () => {
    const d = empty()
    const a = addPoint(d, 0, 0, { fixed: true })
    const b = addPoint(d, 4, 0)
    const m = addPoint(d, 2, 2)                 // arc center, exclusive to the path
    const P = addPath(d, [a, b], [{ kind: 'arc', center: m, sweep: 1 }])
    const other = addPoint(d, 8, 0)
    const L = addLine(d, b, other)              // b shared with another entity
    deleteEntity(d, P)
    expect(d.entities.find(e => e.id === P)).toBeUndefined()
    expect(d.constraints.filter(k => k.kind === 'equalDist')).toHaveLength(0)
    expect(d.entities.find(e => e.id === m)).toBeUndefined()   // exclusive point orphan-cleaned
    expect(d.entities.find(e => e.id === a)).toBeDefined()     // fixed point kept
    expect(d.entities.find(e => e.id === b)).toBeDefined()     // shared point kept
    expect(d.entities.find(e => e.id === L)).toBeDefined()
  })

  it('deleting ONE copy of a repeat×3 path removes its exclusive points + rotatedFrom rules; original and other copy stay solvable', () => {
    const d = empty()
    const ctr = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 2, 0), b = addPoint(d, 4, 0), m = addPoint(d, 3, 1)
    const P = addPath(d, [a, b], [{ kind: 'arc', center: m, sweep: 1 }])
    const copies = repeatEntities(d, [P], ctr, 3)     // 2 copies
    expect(copies).toHaveLength(2)
    const copyPaths = d.entities.filter(e => e.kind === 'path' && e.id !== P) as any[]
    expect(copyPaths).toHaveLength(2)
    const [c1, c2] = copyPaths
    const c1Points = [...c1.anchors, ...c1.segments.filter((s: any) => s.kind === 'arc').map((s: any) => s.center)]

    deleteEntity(d, c1.id)

    for (const pid of c1Points) expect(d.entities.find(e => e.id === pid)).toBeUndefined()  // exclusive points gone
    const rot = d.constraints.filter(k => k.kind === 'rotatedFrom')
    expect(rot.every(r => !c1Points.includes(r.refs[0]))).toBe(true)                        // their rotatedFrom rules gone

    expect(d.entities.find(e => e.id === P)).toBeDefined()      // original intact
    expect(d.entities.find(e => e.id === c2.id)).toBeDefined()  // other copy intact
    const res = solve(d, { maxIter: 80 })
    expect(res.converged).toBe(true)
  })

  it('deleting the ORIGINAL path drops copies rotatedFrom rules but leaves the copies as free geometry; repeat on remaining geometry does not throw', () => {
    const d = empty()
    const ctr = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 2, 0), b = addPoint(d, 4, 0), m = addPoint(d, 3, 1)
    const P = addPath(d, [a, b], [{ kind: 'arc', center: m, sweep: 1 }])
    const copies = repeatEntities(d, [P], ctr, 3)
    expect(copies).toHaveLength(2)

    deleteEntity(d, P)

    expect(d.entities.find(e => e.id === P)).toBeUndefined()
    const rot = d.constraints.filter(k => k.kind === 'rotatedFrom')
    expect(rot.every(r => r.refs[1] !== a && r.refs[1] !== b && r.refs[1] !== m)).toBe(true)  // dangling refs dropped
    const copyPaths = d.entities.filter(e => e.kind === 'path') as any[]
    expect(copyPaths).toHaveLength(2)                                                          // copies remain as free geometry
    expect(() => repeatEntities(d, [copyPaths[0]!.id], ctr, 3)).not.toThrow()
  })

  it('repeatEntities rounds a fractional count before validating; out-of-range counts return [] without mutating the doc', () => {
    const d = empty()
    const ctr = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 2, 0), b = addPoint(d, 4, 0)
    const L = addLine(d, a, b)
    const copies = repeatEntities(d, [L], ctr, 6.49)    // rounds to 6 → 5 copies at k*60°
    expect(copies).toHaveLength(5)
    const angles = d.constraints.filter(k => k.kind === 'rotatedFrom').map(k => k.value!)
    for (const ang of angles) expect(Math.round(ang / 60) * 60).toBeCloseTo(ang, 6)

    const d2 = empty()
    const ctr2 = addPoint(d2, 0, 0, { fixed: true })
    const a2 = addPoint(d2, 2, 0), b2 = addPoint(d2, 4, 0)
    const L2 = addLine(d2, a2, b2)
    const before = JSON.stringify(d2)
    expect(repeatEntities(d2, [L2], ctr2, 100)).toEqual([])
    expect(JSON.stringify(d2)).toBe(before)             // untouched
  })

  it('repeat: when the closure contains the center point, it is shared (no self-referential rotatedFrom, no duplicate center point)', () => {
    const d = empty()
    const ctr = addPoint(d, 0, 0, { fixed: true })
    const other = addPoint(d, 4, 0)
    const L = addLine(d, ctr, other)      // one endpoint IS the center
    const before = d.entities.length
    const copies = repeatEntities(d, [L], ctr, 3)   // 2 copies
    expect(copies).toHaveLength(2)
    const rot = d.constraints.filter(k => k.kind === 'rotatedFrom')
    expect(rot.every(r => r.refs[1] !== ctr)).toBe(true)   // no self-referential rule for the center
    expect(rot).toHaveLength(2)                            // just `other`, once per copy
    const copyLines = d.entities.filter(e => e.kind === 'line' && e.id !== L) as any[]
    expect(copyLines).toHaveLength(2)
    for (const cl of copyLines) expect([cl.p1, cl.p2]).toContain(ctr)   // shares the center, no fresh copy
    expect(d.entities.length).toBe(before + 4)             // 2 copies × (1 new point + 1 new line)
    const res = solve(d, { maxIter: 80 })
    expect(res.converged).toBe(true)
  })

  it('repeatEntities/mirrorEntities return [] without mutating the doc when a closure point is unresolvable', () => {
    const d = empty()
    const ctr = addPoint(d, 0, 0, { fixed: true })
    const a = addPoint(d, 2, 0)
    const L = addLine(d, a, 'GONE')   // dangling ref, never resolves to a point
    const before = JSON.stringify(d)
    expect(repeatEntities(d, [L], ctr, 4)).toEqual([])
    expect(JSON.stringify(d)).toBe(before)

    const x1 = addPoint(d, -5, 0, { fixed: true }), x2 = addPoint(d, 5, 0, { fixed: true })
    const AX = addLine(d, x1, x2)
    const before2 = JSON.stringify(d)
    expect(mirrorEntities(d, [L], AX)).toEqual([])
    expect(JSON.stringify(d)).toBe(before2)
  })
})
