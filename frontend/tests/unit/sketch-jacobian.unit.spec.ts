import { describe, it, expect } from 'vitest'
import type { SketchDoc, EntityId } from '~/lib/sketch/model'
import { constraintResiduals } from '~/lib/sketch/residuals'
import { buildJacobian } from '~/lib/sketch/jacobian'

// Every free point x/y and every circle r, in entity order — mirrors solve.ts's
// buildSlots but with nothing held, so the test always has the full parameter set.
type Slot = { kind: 'px' | 'py' | 'r'; id: EntityId }
function allSlots(doc: SketchDoc): Slot[] {
  const slots: Slot[] = []
  for (const e of doc.entities) {
    if (e.kind === 'point') slots.push({ kind: 'px', id: e.id }, { kind: 'py', id: e.id })
    else if (e.kind === 'circle') slots.push({ kind: 'r', id: e.id })
  }
  return slots
}

function readSlot(doc: SketchDoc, s: Slot): number {
  const e = doc.entities.find(x => x.id === s.id)!
  return s.kind === 'px' ? (e as any).x : s.kind === 'py' ? (e as any).y : (e as any).r
}
function writeSlot(doc: SketchDoc, s: Slot, v: number): void {
  const e = doc.entities.find(x => x.id === s.id)!
  if (s.kind === 'px') (e as any).x = v
  else if (s.kind === 'py') (e as any).y = v
  else (e as any).r = v
}

// Numerical Jacobian via central differences — the ground truth the analytic
// Jacobian is checked against.
function numericalJacobian(doc: SketchDoc, slots: Slot[]): number[][] {
  const h = 1e-6
  const r0 = constraintResiduals(doc)
  const m = r0.length
  const n = slots.length
  const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0))
  for (let j = 0; j < n; j++) {
    const s = slots[j]!
    const orig = readSlot(doc, s)
    writeSlot(doc, s, orig + h)
    const rPlus = constraintResiduals(doc)
    writeSlot(doc, s, orig - h)
    const rMinus = constraintResiduals(doc)
    writeSlot(doc, s, orig)
    for (let i = 0; i < m; i++) J[i]![j] = (rPlus[i]! - rMinus[i]!) / (2 * h)
  }
  return J
}

function expectClose(analytic: number[][], numeric: number[][], tol = 1e-4): void {
  expect(analytic.length).toBe(numeric.length)
  for (let i = 0; i < analytic.length; i++) {
    expect(analytic[i]!.length).toBe(numeric[i]!.length)
    for (let j = 0; j < analytic[i]!.length; j++) {
      const a = analytic[i]![j]!
      const b = numeric[i]![j]!
      if (Math.abs(a - b) > tol) {
        throw new Error(`mismatch at row ${i} col ${j}: analytic=${a} numeric=${b}`)
      }
    }
  }
}

// A doc containing at least one instance of every constraint kind, wired so
// none of the geometry is degenerate (no zero-length lines/vectors, no
// coincident centers) — every analytic partial should be well-defined.
function buildAllKindsDoc(): SketchDoc {
  const doc: SketchDoc = {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 10, y: 0 },
      { id: 'p', kind: 'point', x: 5, y: 3 },
      { id: 'q', kind: 'point', x: 6, y: -2 },
      { id: 'coi1', kind: 'point', x: 1, y: 1 },
      { id: 'coi2', kind: 'point', x: 2, y: 4 },
      { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
      { id: 'cc1', kind: 'point', x: 5, y: 4 },
      { id: 'C1', kind: 'circle', center: 'cc1', r: 3 },
      { id: 'cc2', kind: 'point', x: 20, y: 4 },
      { id: 'C2', kind: 'circle', center: 'cc2', r: 5 },
      { id: 'onL', kind: 'point', x: 4, y: 1.5 },
      { id: 'onC', kind: 'point', x: 5, y: 8 },
      { id: 'tanCen', kind: 'point', x: 3, y: 6 },
      { id: 'Ctan', kind: 'circle', center: 'tanCen', r: 2 },
      { id: 'hA', kind: 'point', x: 0, y: 5 },
      { id: 'hB', kind: 'point', x: 8, y: 5.2 },
      { id: 'vA', kind: 'point', x: -3, y: 0 },
      { id: 'vB', kind: 'point', x: -3.1, y: 6 },
      { id: 'dA', kind: 'point', x: 0, y: 0 },
      { id: 'dB', kind: 'point', x: 3, y: 4 },
      { id: 'eqA', kind: 'point', x: 0, y: 0 },
      { id: 'eqB', kind: 'point', x: 5, y: 0 },
      { id: 'eqP', kind: 'point', x: 0, y: 0 },
      { id: 'eqQ', kind: 'point', x: 0, y: 7 },
      { id: 'rotCenter', kind: 'point', x: 1, y: 1 },
      { id: 'rotOrig', kind: 'point', x: 4, y: 2 },
      { id: 'rotCopy', kind: 'point', x: -1, y: 5 },
      { id: 'mirAxisA', kind: 'point', x: 0, y: -2 },
      { id: 'mirAxisB', kind: 'point', x: 6, y: 3 },
      { id: 'mirAxis', kind: 'line', p1: 'mirAxisA', p2: 'mirAxisB' },
      { id: 'mirOrig', kind: 'point', x: 2, y: 9 },
      { id: 'mirCopy', kind: 'point', x: -4, y: -1 },
      { id: 'colA', kind: 'point', x: 0, y: 0 },
      { id: 'colB', kind: 'point', x: 4, y: 2 },
      { id: 'colP', kind: 'point', x: 1, y: 3 },
      { id: 'perpA', kind: 'point', x: 0, y: 0 },
      { id: 'perpB', kind: 'point', x: 4, y: 1 },
      { id: 'perpP', kind: 'point', x: 2, y: 2 },
      { id: 'perpQ', kind: 'point', x: -1, y: 6 },
      { id: 'parA', kind: 'point', x: 0, y: 0 },
      { id: 'parB', kind: 'point', x: 4, y: 1 },
      { id: 'parP', kind: 'point', x: -2, y: 5 },
      { id: 'parQ', kind: 'point', x: 3, y: 8 },
    ],
    constraints: [
      { id: 'k-coincident', kind: 'coincident', refs: ['coi1', 'coi2'] },
      { id: 'k-concentric', kind: 'concentric', refs: ['C1', 'C2'] },
      { id: 'k-pointOnLine', kind: 'pointOnLine', refs: ['onL', 'L'] },
      { id: 'k-pointOnCircle', kind: 'pointOnCircle', refs: ['onC', 'C1'] },
      { id: 'k-tangentLineCircle', kind: 'tangentLineCircle', refs: ['L', 'Ctan'] },
      { id: 'k-tangentCircleCircle', kind: 'tangentCircleCircle', refs: ['C1', 'C2'] },
      { id: 'k-horizontal', kind: 'horizontal', refs: ['hA', 'hB'] },
      { id: 'k-vertical', kind: 'vertical', refs: ['vA', 'vB'] },
      { id: 'k-distance', kind: 'distance', refs: ['dA', 'dB'], value: 4 },
      { id: 'k-radius', kind: 'radius', refs: ['C1'], value: 3 },
      { id: 'k-equalDist', kind: 'equalDist', refs: ['eqA', 'eqB', 'eqP', 'eqQ'] },
      { id: 'k-rotatedFrom', kind: 'rotatedFrom', refs: ['rotCopy', 'rotOrig', 'rotCenter'], value: 37 },
      { id: 'k-mirroredFrom', kind: 'mirroredFrom', refs: ['mirCopy', 'mirOrig', 'mirAxis'] },
      { id: 'k-collinear', kind: 'collinear', refs: ['colA', 'colB', 'colP'] },
      { id: 'k-perpendicular', kind: 'perpendicular', refs: ['perpA', 'perpB', 'perpP', 'perpQ'] },
      { id: 'k-parallel', kind: 'parallel', refs: ['parA', 'parB', 'parP', 'parQ'] },
    ],
  }
  return doc
}

describe('buildJacobian (analytic) vs numerical (central-difference)', () => {
  it('matches the numerical Jacobian within 1e-4 for a doc containing every constraint kind', () => {
    const doc = buildAllKindsDoc()
    const slots = allSlots(doc)
    const analytic = buildJacobian(doc, slots)
    const numeric = numericalJacobian(doc, slots)
    expectClose(analytic, numeric)
  })

  it('row count matches constraintResiduals(doc) exactly', () => {
    const doc = buildAllKindsDoc()
    const slots = allSlots(doc)
    const analytic = buildJacobian(doc, slots)
    const residuals = constraintResiduals(doc)
    expect(analytic.length).toBe(residuals.length)
  })

  it('skips a slot column for params not present in slots (fixed/held)', () => {
    const doc = buildAllKindsDoc()
    // hold everything except the two coincident points
    const slots: Slot[] = [{ kind: 'px', id: 'coi1' }, { kind: 'py', id: 'coi1' }, { kind: 'px', id: 'coi2' }, { kind: 'py', id: 'coi2' }]
    const analytic = buildJacobian(doc, slots)
    // the coincident constraint is the first constraint in the doc → rows 0,1
    expect(analytic[0]).toEqual([1, 0, -1, 0])
    expect(analytic[1]).toEqual([0, 1, 0, -1])
  })
})

describe('per-kind micro tests (trickier derivatives)', () => {
  it('tangentLineCircle: matches numerical partials', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 10, y: 2 },
        { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
        { id: 'cc', kind: 'point', x: 5, y: 8 },
        { id: 'C', kind: 'circle', center: 'cc', r: 3 },
      ],
      constraints: [{ id: 'k', kind: 'tangentLineCircle', refs: ['L', 'C'] }],
    }
    const slots = allSlots(doc)
    expectClose(buildJacobian(doc, slots), numericalJacobian(doc, slots))
  })

  it('rotatedFrom: matches numerical partials', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'ce', kind: 'point', x: 2, y: -1 },
        { id: 'og', kind: 'point', x: 6, y: 3 },
        { id: 'cp', kind: 'point', x: -5, y: 5 },
      ],
      constraints: [{ id: 'k', kind: 'rotatedFrom', refs: ['cp', 'og', 'ce'], value: 71 }],
    }
    const slots = allSlots(doc)
    expectClose(buildJacobian(doc, slots), numericalJacobian(doc, slots))
  })

  it('mirroredFrom: matches numerical partials (fallback-numeric kind)', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'axA', kind: 'point', x: -3, y: 1 },
        { id: 'axB', kind: 'point', x: 4, y: 6 },
        { id: 'ax', kind: 'line', p1: 'axA', p2: 'axB' },
        { id: 'og', kind: 'point', x: 8, y: -2 },
        { id: 'cp', kind: 'point', x: -6, y: 9 },
      ],
      constraints: [{ id: 'k', kind: 'mirroredFrom', refs: ['cp', 'og', 'ax'] }],
    }
    const slots = allSlots(doc)
    expectClose(buildJacobian(doc, slots), numericalJacobian(doc, slots))
  })

  it('distance: matches numerical partials', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'a', kind: 'point', x: 1, y: 2 },
        { id: 'b', kind: 'point', x: 9, y: -3 },
      ],
      constraints: [{ id: 'k', kind: 'distance', refs: ['a', 'b'], value: 5 }],
    }
    const slots = allSlots(doc)
    expectClose(buildJacobian(doc, slots), numericalJacobian(doc, slots))
  })

  it('radius: matches numerical partials', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'cc', kind: 'point', x: 1, y: 2 },
        { id: 'C', kind: 'circle', center: 'cc', r: 4 },
      ],
      constraints: [{ id: 'k', kind: 'radius', refs: ['C'], value: 6 }],
    }
    const slots = allSlots(doc)
    expectClose(buildJacobian(doc, slots), numericalJacobian(doc, slots))
  })

  it('collinear: matches numerical partials', () => {
    const doc: SketchDoc = {
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 4, y: 2 },
        { id: 'p', kind: 'point', x: -3, y: 7 },
      ],
      constraints: [{ id: 'k', kind: 'collinear', refs: ['a', 'b', 'p'] }],
    }
    const slots = allSlots(doc)
    expectClose(buildJacobian(doc, slots), numericalJacobian(doc, slots))
  })
})
