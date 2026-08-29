import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { addPoint, addPath, addConstraint, deleteEntity, addSmoothHandles, setAnchorSmooth } from '~/lib/sketch/edit'
import { getPoint } from '~/lib/sketch/model'
import { solve } from '~/lib/sketch/solve'

const empty = (): SketchDoc => ({ entities: [], constraints: [] })

describe('addSmoothHandles', () => {
  it('creates mirrored construction handles + the collinear rule', () => {
    const d = empty()
    const a = addPoint(d, 5, 5)
    const { hOut, hIn } = addSmoothHandles(d, a, 7, 6)
    expect(getPoint(d, hOut)).toMatchObject({ x: 7, y: 6, construction: true })
    expect(getPoint(d, hIn)).toMatchObject({ x: 3, y: 4, construction: true })  // 2*(5,5)-(7,6)
    const col = d.constraints.find(c => c.kind === 'collinear')!
    expect(col.refs).toEqual([hIn, a, hOut])
  })

  it('smoothness survives solving when a handle is dragged', () => {
    const d = empty()
    const a = addPoint(d, 5, 5, { fixed: true })
    const { hOut, hIn } = addSmoothHandles(d, a, 7, 6)
    solve(d, { maxIter: 60, drag: { point: hOut, x: 8, y: 8 } })
    const ho = getPoint(d, hOut)!, hi = getPoint(d, hIn)!, an = getPoint(d, a)!
    // collinear: cross((anchor−hIn),(hOut−hIn)) ≈ 0
    const cr = (an.x - hi.x) * (ho.y - hi.y) - (an.y - hi.y) * (ho.x - hi.x)
    expect(Math.abs(cr)).toBeLessThan(1e-3)
  })
})

describe('setAnchorSmooth', () => {
  it('retro-fits handles on a corner anchor of a line path', () => {
    const d = empty()
    const a = addPoint(d, 0, 0), b = addPoint(d, 6, 0), c = addPoint(d, 6, 6)
    const P = addPath(d, [a, b, c], [{ kind: 'line' }, { kind: 'line' }])
    expect(setAnchorSmooth(d, P, 1)).toBe(true)
    const path = d.entities.find(e => e.id === P) as any
    expect(path.segments[0].kind).toBe('cubic')  // both adjacent segments upgraded
    expect(path.segments[1].kind).toBe('cubic')
    expect(path.segments[0].h2).toBeTruthy()     // incoming handle of b
    expect(path.segments[1].h1).toBeTruthy()     // outgoing handle of b
    expect(d.constraints.some(k => k.kind === 'collinear')).toBe(true)
  })
})

describe('deleteEntity — handle demotion', () => {
  it('deleting a handle (cubic h1/h2) demotes the anchor to a cusp instead of deleting the path', () => {
    const d = empty()
    const a = addPoint(d, 0, 0)
    const b = addPoint(d, 6, 0)
    const hOut = addPoint(d, 2, 1, { construction: true })
    const hIn = addPoint(d, -2, -1, { construction: true })
    addConstraint(d, 'collinear', [hIn, a, hOut])
    const P = addPath(d, [a, b], [{ kind: 'cubic', h1: hOut, h2: null }])
    expect(P).not.toBe('')

    deleteEntity(d, hOut)

    const path = d.entities.find(e => e.id === P) as any
    expect(path).toBeTruthy()               // path survives
    expect(path.segments[0].h1).toBeNull()  // handle slot nulled, not cascaded
    expect(d.constraints.some(k => k.kind === 'collinear')).toBe(false)  // dangling refs dropped
    expect(d.entities.some(e => e.id === hOut)).toBe(false)              // the handle point itself is gone
    expect(d.entities.some(e => e.id === a)).toBe(true)                  // anchors untouched
    expect(d.entities.some(e => e.id === b)).toBe(true)
  })
})
