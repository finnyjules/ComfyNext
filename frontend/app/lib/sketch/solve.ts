import type { SketchDoc, EntityId } from './model'
import { constraintResiduals } from './residuals'
import { solveLinear } from './linalg'

export interface DragTarget { point: EntityId; x: number; y: number }
export interface SolveOptions { maxIter?: number; tol?: number; drag?: DragTarget }
export interface SolveResult { converged: boolean; iterations: number; residualNorm: number }

type Slot = { kind: 'px' | 'py'; id: EntityId } | { kind: 'r'; id: EntityId }

const W_REG = 1e-4

// Which scalars are free to move. Fixed points and the dragged point are held.
function buildSlots(doc: SketchDoc, held: Set<EntityId>): Slot[] {
  const slots: Slot[] = []
  for (const e of doc.entities) {
    if (e.kind === 'point') {
      if (e.fixed || held.has(e.id)) continue
      slots.push({ kind: 'px', id: e.id }, { kind: 'py', id: e.id })
    } else if (e.kind === 'circle') {
      slots.push({ kind: 'r', id: e.id })
    }
  }
  return slots
}

function readSlots(doc: SketchDoc, slots: Slot[]): number[] {
  return slots.map(s => {
    const e = doc.entities.find(x => x.id === s.id)!
    if (s.kind === 'px') return (e as any).x
    if (s.kind === 'py') return (e as any).y
    return (e as any).r
  })
}

function writeSlots(doc: SketchDoc, slots: Slot[], q: number[]): void {
  slots.forEach((s, i) => {
    const e = doc.entities.find(x => x.id === s.id)! as any
    if (s.kind === 'px') e.x = q[i]
    else if (s.kind === 'py') e.y = q[i]
    else e.r = q[i]
  })
}

// Snapshot / restore all mutable scalars (for revert-on-failure).
function snapshot(doc: SketchDoc): Map<EntityId, number[]> {
  const m = new Map<EntityId, number[]>()
  for (const e of doc.entities) {
    if (e.kind === 'point') m.set(e.id, [e.x, e.y])
    else if (e.kind === 'circle') m.set(e.id, [e.r])
  }
  return m
}
function restore(doc: SketchDoc, snap: Map<EntityId, number[]>): void {
  for (const e of doc.entities) {
    const v = snap.get(e.id); if (!v) continue
    if (e.kind === 'point') { e.x = v[0]!; e.y = v[1]! }
    else if (e.kind === 'circle') { e.r = v[0]! }
  }
}

const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))

export function solve(doc: SketchDoc, opts: SolveOptions = {}): SolveResult {
  const maxIter = opts.maxIter ?? 60
  const tol = opts.tol ?? 1e-6
  const snap = snapshot(doc)

  const held = new Set<EntityId>()
  if (opts.drag) {
    held.add(opts.drag.point)
    const p = doc.entities.find(x => x.id === opts.drag!.point) as any
    if (p && p.kind === 'point') { p.x = opts.drag.x; p.y = opts.drag.y }
  }

  const slots = buildSlots(doc, held)
  const q0 = readSlots(doc, slots)     // reference for regularization (warm start)
  let q = q0.slice()
  const n = slots.length

  // full residual vector at parameter q: hard constraints + regularization
  const residualAt = (qv: number[]): number[] => {
    writeSlots(doc, slots, qv)
    const hard = constraintResiduals(doc)
    const reg = qv.map((v, i) => W_REG * (v - q0[i]!))
    return [...hard, ...reg]
  }

  let lambda = 1e-3
  let iterations = 0
  let rNorm = norm(residualAt(q))

  if (n === 0) {
    return { converged: rNorm < tol, iterations: 0, residualNorm: rNorm }
  }

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1
    const r = residualAt(q)
    rNorm = norm(r)
    if (rNorm < tol) break

    // numerical Jacobian J (m x n) via forward differences
    const m = r.length
    const h = 1e-6
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0))
    for (let j = 0; j < n; j++) {
      const qj = q.slice(); qj[j]! += h
      const rj = residualAt(qj)
      for (let i = 0; i < m; i++) J[i]![j] = (rj[i]! - r[i]!) / h
    }
    writeSlots(doc, slots, q) // restore q after probing

    // Gauss-Newton normal equations with LM damping: (JᵀJ + λI) δ = −Jᵀr
    const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    const Jtr: number[] = new Array(n).fill(0)
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let s = 0
        for (let i = 0; i < m; i++) s += J[i]![a]! * J[i]![b]!
        JtJ[a]![b] = s + (a === b ? lambda : 0)
      }
      let s = 0
      for (let i = 0; i < m; i++) s += J[i]![a]! * r[i]!
      Jtr[a] = -s
    }

    const delta = solveLinear(JtJ, Jtr)
    if (!delta) { lambda *= 10; continue }

    const qNew = q.map((v, i) => v + delta[i]!)
    const rNew = norm(residualAt(qNew))
    if (rNew < rNorm) { q = qNew; lambda = Math.max(lambda * 0.5, 1e-9) } // accept, less damping
    else { lambda *= 4 }                                                  // reject, more damping
    writeSlots(doc, slots, q)
  }

  writeSlots(doc, slots, q)
  rNorm = norm(constraintResiduals(doc)) // report HARD residual only
  const converged = rNorm < 1e-3
  if (!converged) restore(doc, snap)
  return { converged, iterations, residualNorm: rNorm }
}
