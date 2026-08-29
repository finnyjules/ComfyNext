# Sketch Solver — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a 2D geometric constraint solver on a standalone dev page — draw lines and circles, apply relationships (tangent, concentric, radius…), drag anything, and watch the whole drawing re-solve so every relationship stays true.

**Architecture:** A dependency-light library `frontend/app/lib/sketch/` holding a pure data model (entities + constraints with stable ids), a Gauss-Newton / Levenberg-Marquardt solver over a flat parameter vector, and an SVG path emitter. A hidden Nuxt page `app/pages/dev/sketch-solver-lab.vue` renders the doc as SVG and drives the solver interactively. No persistence, no Shape Studio, no agent — those are later phases.

**Tech Stack:** TypeScript, Vue 3 (`<script setup>`), Nuxt 4 pages, Vitest for unit tests, Playwright for one invariant smoke test.

## Global Constraints

- **No `paper` and no `three` imports anywhere in `lib/sketch/`.** The model and solver must run in plain Vitest and (later) in `studioTune.ts`. This mirrors the geoshape dependency-light tier. (Spec: Architecture › new library.)
- **Rules reference entity ids, never array positions.** All positional freedom lives in `point` entities; lines and circles reference point ids. (Spec: stable ids.)
- **The document stores already-solved positions. Rendering never solves.** Only interaction (drag / apply-constraint) invokes `solve()`. (Spec: model idea 1 & 3.)
- **The solver is deterministic** — no `Math.random()`, no `Date.now()`. Warm-started from current positions. (Spec: solver.)
- **The solver never emits a non-converged state to render** — on failure, positions revert to the last converged vector. (Spec: error handling.)
- Dev page uses `definePageMeta({ layout: false })` and carries a top comment `// Dev harness — not linked in the app.` (Repo convention: `app/pages/dev/*.vue`.)
- Unit tests: `frontend/tests/unit/<name>.unit.spec.ts`, run with `npm run test:unit` (alias for `vitest run`). Imports use the `~/lib/...` alias.
- Entity cap for the page: 120 (not enforced in the solver; a guard in the page). (Spec: perf guardrails.)

**Phase-1 entity kinds:** `point`, `line`, `circle` only. `arc` and freeform bezier are Phase 3+. **Phase-1 constraints:** coincident, pointOnLine, pointOnCircle, tangentLineCircle, tangentCircleCircle, concentric, horizontal, vertical, distance, radius. (midpoint / equal / symmetric / mirror are Phase 3 verbs.)

All paths below are relative to `frontend/`.

---

### Task 1: Vector-geometry primitives

The repo has no shared 2D vector-math module (confirmed by the codebase survey). Create the small pure kernel the solver and path emitter both need.

**Files:**
- Create: `app/lib/sketch/geom.ts`
- Test: `tests/unit/sketch-geom.unit.spec.ts`

**Interfaces:**
- Produces: `interface Vec2 { x: number; y: number }`; `sub(a,b): Vec2`; `add(a,b): Vec2`; `scale(a,k): Vec2`; `dot(a,b): number`; `cross(a,b): number`; `len(a): number`; `dist(a,b): number`; `distPointToLine(p: Vec2, a: Vec2, b: Vec2): number` (signed perpendicular distance from `p` to the infinite line through `a`→`b`; positive on the left of a→b, `0` when a≈b).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-geom.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { sub, dot, cross, len, dist, distPointToLine } from '~/lib/sketch/geom'

describe('sketch geom', () => {
  it('does basic vector algebra', () => {
    expect(sub({ x: 3, y: 5 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 3 })
    expect(dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0)
    expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1)
    expect(len({ x: 3, y: 4 })).toBe(5)
    expect(dist({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4)
  })

  it('measures signed distance from a point to an infinite line', () => {
    // line along the x-axis, point one unit above → +1 (left of →x)
    expect(distPointToLine({ x: 5, y: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(1, 9)
    expect(distPointToLine({ x: 5, y: -3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(-3, 9)
    // degenerate line (a≈b) → 0, never NaN
    expect(distPointToLine({ x: 5, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- sketch-geom`
Expected: FAIL — cannot resolve `~/lib/sketch/geom`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/sketch/geom.ts
export interface Vec2 { x: number; y: number }

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

// Signed perpendicular distance from p to the infinite line through a→b.
// Positive when p is to the left of a→b. Returns 0 for a degenerate line.
export function distPointToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a)
  const L = len(d)
  if (L < 1e-12) return 0
  return cross(d, sub(p, a)) / L
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- sketch-geom`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/geom.ts tests/unit/sketch-geom.unit.spec.ts
git commit -m "feat(sketch): 2D vector-geometry primitives for the constraint solver"
```

---

### Task 2: Document model and accessors

The typed document plus the accessors the solver needs to resolve a line/circle's concrete points from ids.

**Files:**
- Create: `app/lib/sketch/model.ts`
- Test: `tests/unit/sketch-model.unit.spec.ts`

**Interfaces:**
- Consumes: `Vec2` from `~/lib/sketch/geom`.
- Produces:
  - `type EntityId = string`
  - `interface PointEntity { id: EntityId; kind: 'point'; x: number; y: number; construction?: boolean; fixed?: boolean }`
  - `interface LineEntity { id: EntityId; kind: 'line'; p1: EntityId; p2: EntityId; construction?: boolean }`
  - `interface CircleEntity { id: EntityId; kind: 'circle'; center: EntityId; r: number; construction?: boolean }`
  - `type SketchEntity = PointEntity | LineEntity | CircleEntity`
  - `type ConstraintKind = 'coincident' | 'pointOnLine' | 'pointOnCircle' | 'tangentLineCircle' | 'tangentCircleCircle' | 'concentric' | 'horizontal' | 'vertical' | 'distance' | 'radius'`
  - `interface SketchConstraint { id: EntityId; kind: ConstraintKind; refs: EntityId[]; value?: number }`
  - `interface SketchDoc { entities: SketchEntity[]; constraints: SketchConstraint[] }`
  - `getEntity(doc, id): SketchEntity | undefined`
  - `getPoint(doc, id): PointEntity | undefined`
  - `lineEndpoints(doc, line: LineEntity): { a: Vec2; b: Vec2 } | null` (null if either point id is missing)
  - `circleCenter(doc, circle: CircleEntity): Vec2 | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-model.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { getEntity, getPoint, lineEndpoints, circleCenter } from '~/lib/sketch/model'

const doc: SketchDoc = {
  entities: [
    { id: 'p1', kind: 'point', x: 0, y: 0 },
    { id: 'p2', kind: 'point', x: 10, y: 0 },
    { id: 'pc', kind: 'point', x: 5, y: 5 },
    { id: 'l1', kind: 'line', p1: 'p1', p2: 'p2' },
    { id: 'c1', kind: 'circle', center: 'pc', r: 3 },
  ],
  constraints: [],
}

describe('sketch model', () => {
  it('resolves entities and points by id', () => {
    expect(getEntity(doc, 'l1')?.kind).toBe('line')
    expect(getPoint(doc, 'pc')).toMatchObject({ x: 5, y: 5 })
    expect(getPoint(doc, 'l1')).toBeUndefined() // not a point
  })

  it('resolves concrete endpoints and centers, null when a ref dangles', () => {
    const l1 = getEntity(doc, 'l1') as any
    expect(lineEndpoints(doc, l1)).toEqual({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } })
    const c1 = getEntity(doc, 'c1') as any
    expect(circleCenter(doc, c1)).toEqual({ x: 5, y: 5 })
    const dangling = { id: 'lx', kind: 'line', p1: 'p1', p2: 'nope' } as any
    expect(lineEndpoints(doc, dangling)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- sketch-model`
Expected: FAIL — cannot resolve `~/lib/sketch/model`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/sketch/model.ts
import type { Vec2 } from './geom'

export type EntityId = string

export interface PointEntity { id: EntityId; kind: 'point'; x: number; y: number; construction?: boolean; fixed?: boolean }
export interface LineEntity { id: EntityId; kind: 'line'; p1: EntityId; p2: EntityId; construction?: boolean }
export interface CircleEntity { id: EntityId; kind: 'circle'; center: EntityId; r: number; construction?: boolean }
export type SketchEntity = PointEntity | LineEntity | CircleEntity

export type ConstraintKind =
  | 'coincident' | 'pointOnLine' | 'pointOnCircle'
  | 'tangentLineCircle' | 'tangentCircleCircle' | 'concentric'
  | 'horizontal' | 'vertical' | 'distance' | 'radius'

export interface SketchConstraint {
  id: EntityId
  kind: ConstraintKind
  refs: EntityId[]     // entity ids the constraint relates, order defined per kind
  value?: number       // for 'distance' and 'radius'
}

export interface SketchDoc { entities: SketchEntity[]; constraints: SketchConstraint[] }

export function getEntity(doc: SketchDoc, id: EntityId): SketchEntity | undefined {
  return doc.entities.find(e => e.id === id)
}

export function getPoint(doc: SketchDoc, id: EntityId): PointEntity | undefined {
  const e = getEntity(doc, id)
  return e && e.kind === 'point' ? e : undefined
}

export function lineEndpoints(doc: SketchDoc, line: LineEntity): { a: Vec2; b: Vec2 } | null {
  const a = getPoint(doc, line.p1)
  const b = getPoint(doc, line.p2)
  if (!a || !b) return null
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
}

export function circleCenter(doc: SketchDoc, circle: CircleEntity): Vec2 | null {
  const c = getPoint(doc, circle.center)
  return c ? { x: c.x, y: c.y } : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- sketch-model`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/model.ts tests/unit/sketch-model.unit.spec.ts
git commit -m "feat(sketch): constraint document model with id-based accessors"
```

---

### Task 3: Constraint residuals

Each constraint becomes a set of scalar residuals — numbers that read `0` exactly when the rule is satisfied. This is the mathematical heart; test every kind against analytic values.

**Files:**
- Create: `app/lib/sketch/residuals.ts`
- Test: `tests/unit/sketch-residuals.unit.spec.ts`

**Interfaces:**
- Consumes: model types + accessors; `dist`, `distPointToLine` from geom.
- Produces: `constraintResiduals(doc: SketchDoc): number[]` — flattens every constraint's residuals into one vector, in `doc.constraints` order. A constraint whose refs don't resolve contributes **no** residuals (skipped), never `NaN`.

**Residual definitions (refs order):**
- `coincident` refs `[pA, pB]` → `[Ax-Bx, Ay-By]`
- `pointOnLine` refs `[p, line]` → `[distPointToLine(p, a, b)]`
- `pointOnCircle` refs `[p, circle]` → `[dist(p, center) - r]`
- `tangentLineCircle` refs `[line, circle]` → `[|distPointToLine(center,a,b)| - r]`
- `tangentCircleCircle` refs `[cA, cB]` → `[dist(centerA, centerB) - (rA + rB)]` (external tangency)
- `concentric` refs `[cA, cB]` → `[centerAx-centerBx, centerAy-centerBy]`
- `horizontal` refs `[line]` → `[Ay - By]`
- `vertical` refs `[line]` → `[Ax - Bx]`
- `distance` refs `[pA, pB]`, value `d` → `[dist(A,B) - d]`
- `radius` refs `[circle]`, value `r0` → `[circle.r - r0]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-residuals.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintResiduals } from '~/lib/sketch/residuals'

function base(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 10, y: 0 },
      { id: 'cc', kind: 'point', x: 5, y: 4 },
      { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
      { id: 'C', kind: 'circle', center: 'cc', r: 3 },
    ],
    constraints: [],
  }
}

describe('constraint residuals', () => {
  it('tangentLineCircle residual is (perp distance − r)', () => {
    const d = base()
    d.constraints = [{ id: 'k', kind: 'tangentLineCircle', refs: ['L', 'C'] }]
    // center is 4 above the x-axis line, r=3 → residual 4-3 = 1
    expect(constraintResiduals(d)).toEqual([1])
  })

  it('radius and distance use their value', () => {
    const d = base()
    d.constraints = [
      { id: 'r', kind: 'radius', refs: ['C'], value: 5 },       // 3-5 = -2
      { id: 'd', kind: 'distance', refs: ['a', 'b'], value: 8 }, // 10-8 = 2
    ]
    expect(constraintResiduals(d)).toEqual([-2, 2])
  })

  it('horizontal/vertical read endpoint deltas', () => {
    const d = base()
    d.entities[1] = { id: 'b', kind: 'point', x: 10, y: 3 } // b now above a
    d.constraints = [{ id: 'h', kind: 'horizontal', refs: ['L'] }]
    expect(constraintResiduals(d)).toEqual([0 - 3]) // Ay - By = -3
  })

  it('skips constraints with dangling refs, never NaN', () => {
    const d = base()
    d.constraints = [{ id: 'k', kind: 'tangentLineCircle', refs: ['L', 'GONE'] }]
    expect(constraintResiduals(d)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- sketch-residuals`
Expected: FAIL — cannot resolve `~/lib/sketch/residuals`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/sketch/residuals.ts
import type { SketchDoc, SketchConstraint, LineEntity, CircleEntity } from './model'
import { getEntity, getPoint, lineEndpoints, circleCenter } from './model'
import { dist, distPointToLine, type Vec2 } from './geom'

function circleOf(doc: SketchDoc, id: string): CircleEntity | null {
  const e = getEntity(doc, id)
  return e && e.kind === 'circle' ? e : null
}
function lineOf(doc: SketchDoc, id: string): LineEntity | null {
  const e = getEntity(doc, id)
  return e && e.kind === 'line' ? e : null
}

function residualsFor(doc: SketchDoc, c: SketchConstraint): number[] | null {
  switch (c.kind) {
    case 'coincident': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!)
      if (!a || !b) return null
      return [a.x - b.x, a.y - b.y]
    }
    case 'concentric': {
      const a = circleOf(doc, c.refs[0]!); const b = circleOf(doc, c.refs[1]!)
      if (!a || !b) return null
      const ca = circleCenter(doc, a); const cb = circleCenter(doc, b)
      if (!ca || !cb) return null
      return [ca.x - cb.x, ca.y - cb.y]
    }
    case 'pointOnLine': {
      const p = getPoint(doc, c.refs[0]!); const l = lineOf(doc, c.refs[1]!)
      if (!p || !l) return null
      const e = lineEndpoints(doc, l); if (!e) return null
      return [distPointToLine({ x: p.x, y: p.y }, e.a, e.b)]
    }
    case 'pointOnCircle': {
      const p = getPoint(doc, c.refs[0]!); const cir = circleOf(doc, c.refs[1]!)
      if (!p || !cir) return null
      const cen = circleCenter(doc, cir); if (!cen) return null
      return [dist({ x: p.x, y: p.y }, cen) - cir.r]
    }
    case 'tangentLineCircle': {
      const l = lineOf(doc, c.refs[0]!); const cir = circleOf(doc, c.refs[1]!)
      if (!l || !cir) return null
      const e = lineEndpoints(doc, l); const cen = circleCenter(doc, cir)
      if (!e || !cen) return null
      return [Math.abs(distPointToLine(cen, e.a, e.b)) - cir.r]
    }
    case 'tangentCircleCircle': {
      const a = circleOf(doc, c.refs[0]!); const b = circleOf(doc, c.refs[1]!)
      if (!a || !b) return null
      const ca = circleCenter(doc, a); const cb = circleCenter(doc, b)
      if (!ca || !cb) return null
      return [dist(ca, cb) - (a.r + b.r)]
    }
    case 'horizontal': {
      const l = lineOf(doc, c.refs[0]!); if (!l) return null
      const e = lineEndpoints(doc, l); if (!e) return null
      return [e.a.y - e.b.y]
    }
    case 'vertical': {
      const l = lineOf(doc, c.refs[0]!); if (!l) return null
      const e = lineEndpoints(doc, l); if (!e) return null
      return [e.a.x - e.b.x]
    }
    case 'distance': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!)
      if (!a || !b || c.value == null) return null
      return [dist({ x: a.x, y: a.y }, { x: b.x, y: b.y }) - c.value]
    }
    case 'radius': {
      const cir = circleOf(doc, c.refs[0]!)
      if (!cir || c.value == null) return null
      return [cir.r - c.value]
    }
    default:
      return null
  }
}

export function constraintResiduals(doc: SketchDoc): number[] {
  const out: number[] = []
  for (const c of doc.constraints) {
    const r = residualsFor(doc, c)
    if (r) out.push(...r)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- sketch-residuals`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/residuals.ts tests/unit/sketch-residuals.unit.spec.ts
git commit -m "feat(sketch): constraint residual functions with analytic tests"
```

---

### Task 4: The solver

Map the doc's free scalars to a parameter vector, then drive the residuals to zero with damped Gauss-Newton (Levenberg-Marquardt). A small regularization term keeps under-constrained freedom near where it was (so unpinned geometry stays put — the thing that makes it "feel right"). A drag temporarily pins one point.

**Files:**
- Create: `app/lib/sketch/linalg.ts` (tiny dense linear solver)
- Create: `app/lib/sketch/solve.ts`
- Test: `tests/unit/sketch-linalg.unit.spec.ts`
- Test: `tests/unit/sketch-solve.unit.spec.ts`

**Interfaces:**
- Consumes: `constraintResiduals`, model types + accessors.
- Produces from `linalg.ts`: `solveLinear(A: number[][], b: number[]): number[] | null` (Gaussian elimination with partial pivoting; `null` if singular).
- Produces from `solve.ts`:
  - `interface DragTarget { point: EntityId; x: number; y: number }`
  - `interface SolveOptions { maxIter?: number; tol?: number; drag?: DragTarget }`
  - `interface SolveResult { converged: boolean; iterations: number; residualNorm: number }`
  - `solve(doc: SketchDoc, opts?: SolveOptions): SolveResult` — **mutates** point `x`/`y` and circle `r` in place. On non-convergence, restores the pre-call positions.

**Free-parameter rule:** every non-`fixed` point contributes `x` and `y`; every circle contributes `r`. `fixed` points and (during a drag) the dragged point are held constant. Regularization weight `wReg = 0.01`; LM damping starts at `1e-3`.

- [ ] **Step 1: Write the failing linalg test**

```ts
// tests/unit/sketch-linalg.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { solveLinear } from '~/lib/sketch/linalg'

describe('solveLinear', () => {
  it('solves a 2x2 system', () => {
    // 2x + y = 5 ; x + 3y = 10  → x=1, y=3
    const x = solveLinear([[2, 1], [1, 3]], [5, 10])!
    expect(x[0]).toBeCloseTo(1, 9)
    expect(x[1]).toBeCloseTo(3, 9)
  })
  it('returns null for a singular matrix', () => {
    expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- sketch-linalg`
Expected: FAIL — cannot resolve `~/lib/sketch/linalg`.

- [ ] **Step 3: Implement the linear solver**

```ts
// app/lib/sketch/linalg.ts
// Dense Gaussian elimination with partial pivoting. Solves A x = b.
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]!]) // augmented
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r
    if (Math.abs(M[piv]![col]!) < 1e-12) return null
    ;[M[col], M[piv]] = [M[piv]!, M[col]!]
    const d = M[col]![col]!
    for (let c = col; c <= n; c++) M[col]![c]! /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r]![col]!
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!
    }
  }
  return M.map(row => row[n]!)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- sketch-linalg`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing solver test**

```ts
// tests/unit/sketch-solve.unit.spec.ts
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
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test:unit -- sketch-solve`
Expected: FAIL — cannot resolve `~/lib/sketch/solve`.

- [ ] **Step 7: Implement the solver**

```ts
// app/lib/sketch/solve.ts
import type { SketchDoc, EntityId } from './model'
import { constraintResiduals } from './residuals'
import { solveLinear } from './linalg'

export interface DragTarget { point: EntityId; x: number; y: number }
export interface SolveOptions { maxIter?: number; tol?: number; drag?: DragTarget }
export interface SolveResult { converged: boolean; iterations: number; residualNorm: number }

type Slot = { kind: 'px' | 'py'; id: EntityId } | { kind: 'r'; id: EntityId }

const W_REG = 0.01

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
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm run test:unit -- sketch-solve`
Expected: PASS (3 tests). If the rotate-drag case is marginally off, raise `maxIter` to 120 — do not loosen the `toBeCloseTo(3, 3)` invariant.

- [ ] **Step 9: Commit**

```bash
git add app/lib/sketch/linalg.ts app/lib/sketch/solve.ts tests/unit/sketch-linalg.unit.spec.ts tests/unit/sketch-solve.unit.spec.ts
git commit -m "feat(sketch): LM constraint solver — tangency holds under drag, reverts when over-constrained"
```

---

### Task 5: SVG path emitter

Turn a solved doc into SVG path data so the page (and later Shape Studio) can render it. Circles emit as two half-arcs (the standard closed-circle `A` trick); lines emit as `M…L`.

**Files:**
- Create: `app/lib/sketch/sketchPath.ts`
- Test: `tests/unit/sketch-path.unit.spec.ts`

**Interfaces:**
- Consumes: model types + accessors.
- Produces:
  - `entityPath(doc: SketchDoc, id: EntityId): string` — path data for one line/circle (`''` for a point, a construction entity, or an unresolved ref).
  - `sketchPathData(doc: SketchDoc, opts?: { includeConstruction?: boolean }): string` — concatenation of every renderable entity's path, space-joined. Construction entities are excluded unless `includeConstruction` is true.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-path.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { entityPath, sketchPathData } from '~/lib/sketch/sketchPath'

const doc: SketchDoc = {
  entities: [
    { id: 'a', kind: 'point', x: 0, y: 0 },
    { id: 'b', kind: 'point', x: 10, y: 0 },
    { id: 'cc', kind: 'point', x: 5, y: 5 },
    { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
    { id: 'C', kind: 'circle', center: 'cc', r: 3 },
    { id: 'G', kind: 'line', p1: 'a', p2: 'cc', construction: true },
  ],
  constraints: [],
}

describe('sketch path', () => {
  it('emits a line as M…L', () => {
    expect(entityPath(doc, 'L')).toBe('M 0 0 L 10 0')
  })
  it('emits a circle as two half-arcs', () => {
    // center (5,5) r=3 → left point (2,5), right point (8,5)
    expect(entityPath(doc, 'C')).toBe('M 2 5 A 3 3 0 0 1 8 5 A 3 3 0 0 1 2 5 Z')
  })
  it('a point emits nothing', () => {
    expect(entityPath(doc, 'a')).toBe('')
  })
  it('excludes construction geometry by default, includes on request', () => {
    const def = sketchPathData(doc)
    expect(def).toContain('M 0 0 L 10 0')      // L rendered
    expect(def).not.toContain('M 0 0 L 5 5')   // G (construction) hidden
    const withC = sketchPathData(doc, { includeConstruction: true })
    expect(withC).toContain('M 0 0 L 5 5')     // G now present
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- sketch-path`
Expected: FAIL — cannot resolve `~/lib/sketch/sketchPath`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/sketch/sketchPath.ts
import type { SketchDoc, EntityId } from './model'
import { getEntity, lineEndpoints, circleCenter } from './model'

const num = (n: number) => (Object.is(n, -0) ? 0 : n)

export function entityPath(doc: SketchDoc, id: EntityId): string {
  const e = getEntity(doc, id)
  if (!e || e.kind === 'point') return ''
  if (e.kind === 'line') {
    const pts = lineEndpoints(doc, e); if (!pts) return ''
    return `M ${num(pts.a.x)} ${num(pts.a.y)} L ${num(pts.b.x)} ${num(pts.b.y)}`
  }
  // circle: two half-arcs from the left point, sweeping through the right and back
  const cen = circleCenter(doc, e); if (!cen) return ''
  const r = e.r
  const lx = num(cen.x - r), rx = num(cen.x + r), cy = num(cen.y)
  return `M ${lx} ${cy} A ${r} ${r} 0 0 1 ${rx} ${cy} A ${r} ${r} 0 0 1 ${lx} ${cy} Z`
}

export function sketchPathData(doc: SketchDoc, opts: { includeConstruction?: boolean } = {}): string {
  const parts: string[] = []
  for (const e of doc.entities) {
    if (e.kind === 'point') continue
    if (e.construction && !opts.includeConstruction) continue
    const d = entityPath(doc, e.id)
    if (d) parts.push(d)
  }
  return parts.join(' ')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- sketch-path`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/sketchPath.ts tests/unit/sketch-path.unit.spec.ts
git commit -m "feat(sketch): SVG path emitter for lines and circles"
```

---

### Task 6: Interactive dev page

The proving ground. An SVG canvas that renders the doc, lets you add a demo construction, drag points (calling `solve` each move), and apply constraints from buttons. It exposes `window.__sketchLab` so verification is forced-synchronous and never fights a paused rAF (per the browser-pane-hidden lesson).

**Files:**
- Create: `app/pages/dev/sketch-solver-lab.vue`
- Test: `tests/sketch-solver-lab.spec.ts` (Playwright)

**Interfaces:**
- Consumes: `solve`, `sketchPathData`, model types.
- Produces (on `window`): `__sketchLab = { doc: SketchDoc, solve(drag?): SolveResult, loadTangentDemo(): void, setPoint(id, x, y): void, pathData(): string }`. `solve(drag?)` re-solves and returns the `SolveResult`; `setPoint` moves a point then solves with that point dragged.

- [ ] **Step 1: Write the page**

```vue
<!-- app/pages/dev/sketch-solver-lab.vue -->
<script setup lang="ts">
// Dev harness — not linked in the app. Proving ground for the sketch constraint solver.
definePageMeta({ layout: false })
import { ref, computed, onMounted } from 'vue'
import type { SketchDoc, EntityId } from '~/lib/sketch/model'
import { getPoint } from '~/lib/sketch/model'
import { solve, type DragTarget, type SolveResult } from '~/lib/sketch/solve'
import { sketchPathData } from '~/lib/sketch/sketchPath'

const doc = ref<SketchDoc>({ entities: [], constraints: [] })
const status = ref('empty')

// world→screen: 40px per unit, origin near lower-left of a 640x420 board
const S = 34, OX = 60, OY = 360
const sx = (x: number) => OX + x * S
const sy = (y: number) => OY - y * S
const wx = (px: number) => (px - OX) / S
const wy = (py: number) => (OY - py) / S

const pathScreen = computed(() => {
  // re-emit in screen space by remapping: build a transformed shadow doc
  const d = doc.value
  const shadow: SketchDoc = {
    entities: d.entities.map(e => e.kind === 'point'
      ? { ...e, x: sx(e.x), y: sy(e.y) }
      : e.kind === 'circle' ? { ...e, r: e.r * S } : { ...e }),
    constraints: [],
  }
  return sketchPathData(shadow)
})
const points = computed(() => doc.value.entities.filter(e => e.kind === 'point') as any[])

function loadTangentDemo() {
  doc.value = {
    entities: [
      { id: 'a', kind: 'point', x: 1, y: 2, fixed: true },
      { id: 'b', kind: 'point', x: 12, y: 2 },
      { id: 'cc', kind: 'point', x: 6, y: 9 },
      { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
      { id: 'C', kind: 'circle', center: 'cc', r: 3 },
    ],
    constraints: [
      { id: 'k', kind: 'tangentLineCircle', refs: ['L', 'C'] },
      { id: 'rr', kind: 'radius', refs: ['C'], value: 3 },
    ],
  }
  runSolve()
}

function runSolve(drag?: DragTarget): SolveResult {
  const res = solve(doc.value, { maxIter: 120, drag })
  status.value = res.converged ? `solved (${res.iterations} it)` : `NOT converged (${res.residualNorm.toFixed(2)})`
  return res
}

// pointer drag
let dragId: EntityId | null = null
function onDown(id: EntityId) { dragId = id }
function onMove(ev: PointerEvent) {
  if (!dragId) return
  const svg = (ev.currentTarget as SVGSVGElement).getBoundingClientRect()
  runSolve({ point: dragId, x: wx(ev.clientX - svg.left), y: wy(ev.clientY - svg.top) })
}
function onUp() { dragId = null }

onMounted(() => {
  ;(window as any).__sketchLab = {
    get doc() { return doc.value },
    solve: (drag?: DragTarget) => runSolve(drag),
    loadTangentDemo,
    setPoint: (id: EntityId, x: number, y: number) => runSolve({ point: id, x, y }),
    pathData: () => sketchPathData(doc.value),
  }
})
</script>

<template>
  <div style="font-family: ui-sans-serif, system-ui; padding: 12px; color: #e5e5e5; background: #111; min-height: 100vh">
    <h1 style="font-size: 14px; margin: 0 0 8px">Sketch Solver Lab</h1>
    <div style="display: flex; gap: 8px; margin-bottom: 8px">
      <button data-act="demo" @click="loadTangentDemo" style="padding: 4px 10px">Tangent demo</button>
      <span data-status style="align-self: center; font-size: 12px; color: #9ca3af">{{ status }}</span>
    </div>
    <svg width="640" height="420" style="background: #fafafa; border-radius: 8px; touch-action: none"
         @pointermove="onMove" @pointerup="onUp" @pointerleave="onUp">
      <path :d="pathScreen" fill="none" stroke="#3730a3" stroke-width="1.5" />
      <circle v-for="p in points" :key="p.id" :cx="sx(p.x)" :cy="sy(p.y)"
              :r="p.fixed ? 5 : 6" :fill="p.fixed ? '#9ca3af' : '#2563eb'"
              style="cursor: grab" @pointerdown="onDown(p.id)" :data-point="p.id" />
    </svg>
  </div>
</template>
```

- [ ] **Step 2: Start the dev server and eyeball it**

Use the Browser pane: `preview_start` the `frontend` dev server, then navigate to `/dev/sketch-solver-lab`. Click **Tangent demo**. Drag the blue endpoint of the line up and down. The circle must roll along the line, staying visually tangent, and the status must stay "solved". This is the phase's real exit test — it must *feel* right, not just pass an assertion.

- [ ] **Step 3: Write the invariant smoke test**

```ts
// tests/sketch-solver-lab.spec.ts
import { test, expect } from '@playwright/test'

// Distance from a circle center to the line, read straight from the solved doc.
test('circle stays tangent to the line as the endpoint moves', async ({ page }) => {
  await page.goto('/dev/sketch-solver-lab')
  await page.getByRole('button', { name: 'Tangent demo' }).click()

  const perp = async () => page.evaluate(() => {
    const d = (window as any).__sketchLab.doc
    const p = (id: string) => d.entities.find((e: any) => e.id === id)
    const a = p('a'), b = p('b'), c = p('cc'), C = d.entities.find((e: any) => e.id === 'C')
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy)
    const dPerp = Math.abs((dx * (c.y - a.y) - dy * (c.x - a.x)) / L)
    return { perp: dPerp, r: C.r }
  })

  const before = await perp()
  expect(Math.abs(before.perp - before.r)).toBeLessThan(0.05)

  // rotate the line by moving endpoint b, via the exposed forced-sync API
  await page.evaluate(() => (window as any).__sketchLab.setPoint('b', 12, 7))
  const after = await perp()
  expect(after.perp).toBeCloseTo(after.r, 1) // still tangent after the move
})
```

- [ ] **Step 4: Run the smoke test**

Run: `npm run test -- sketch-solver-lab`
Expected: PASS (1 test). (The Playwright config serves the dev app; if the base URL differs, follow the repo's existing E2E convention for the dev server.)

- [ ] **Step 5: Commit**

```bash
git add app/pages/dev/sketch-solver-lab.vue tests/sketch-solver-lab.spec.ts
git commit -m "feat(sketch): interactive solver dev page + tangency invariant E2E"
```

---

### Task 7: Phase close-out

- [ ] **Step 1: Run the full sketch unit suite**

Run: `npm run test:unit -- sketch`
Expected: PASS — geom, model, residuals, linalg, solve, path (6 files).

- [ ] **Step 2: Typecheck the new library**

Run the repo's typecheck (per the sailor-dev-environment convention). Expected: no new errors naming `lib/sketch/*` or the dev page. Fix any that do; a pre-existing baseline error elsewhere is not this phase's concern.

- [ ] **Step 3: Update the build dashboard**

Per the standing "update dashboard on every commit" rule, read the LIVE dashboard first, then add a "Sketch constraints — Phase 1 (solver) LANDED" entry with a one-line hook (solver proven on `/dev/sketch-solver-lab`; tangency holds under drag). Update both the artifact and the docs copy.

- [ ] **Step 4: Write the memory**

Add a memory file recording: `lib/sketch/` is the dependency-light constraint kernel (model → residuals → LM solve → sketchPath); points hold all positional DOF, lines/circles reference point ids; solver reverts on non-convergence; dev page at `/dev/sketch-solver-lab` exposes `window.__sketchLab` for forced-sync verification. Link `[[shared-catalog-two-consumers]]` and the geoshape memories. Add the one-line pointer to `MEMORY.md`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "docs(sketch): dashboard + memory for Phase 1 solver landing"
```

---

## Self-Review

**Spec coverage (Phase 1 slice):**
- Dependency-light `lib/sketch/` model + solver + path emitter → Tasks 1–5. ✓
- Stable ids, positional DOF in points → model (Task 2), enforced by solver slots (Task 4). ✓
- Solver deterministic, warm-started, reverts on failure → Task 4 (`snapshot`/`restore`, `W_REG` toward `q0`). ✓
- "Solve live, render never solves" → page calls `solve` only on interaction; `pathScreen` is pure emit (Task 6). ✓
- Over-constrained handling (flag, don't explode) → Task 4 test 3 + status readout on page. ✓
- Curated v1 vocabulary → residuals cover the 10 Phase-1 constraint kinds (Task 3). ✓ (midpoint/equal/symmetric/mirror deferred to Phase 3 per Global Constraints — intentional.)
- Standalone dev page, forced-sync verification, deliberately-real invariant (not synthetic pointers) → Task 6 exposes doc state; E2E checks the tangency invariant, not a fake event. ✓
- Perf guardrail note (entity cap) → Global Constraints; page-level, not solver-level, as scoped. ✓
- **Deferred to later phases (not gaps):** `arc` entity, `merge.ts` (needed only when persisting in Phase 2), Shape Studio integration, agent verbs, draw-time inference chips/badges, curvature comb. Called out in Global Constraints and the spec's build order.

**Placeholder scan:** No TBD/TODO; every code step is complete and runnable. ✓

**Type consistency:** `SketchDoc`, `SketchConstraint { refs, value }`, `SolveResult { converged, iterations, residualNorm }`, `DragTarget { point, x, y }`, `solve(doc, opts)`, `constraintResiduals(doc)`, `sketchPathData(doc, opts)`, `entityPath(doc, id)`, `solveLinear(A, b)` are used identically across tasks and tests. Circle stores `center` (point id) + `r` throughout. ✓
