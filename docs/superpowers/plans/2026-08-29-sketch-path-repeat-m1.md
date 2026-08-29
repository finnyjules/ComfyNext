# Sketch Construction Paths + Repeat/Mirror (M0+M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Paths (line + arc segments) join the sketch system, with Repeat…/Mirror… as live-copy rules — exit test: build an OpenAI-knot-style figure (one line+arc unit, repeated 6×, welded, still fully editable) on `/dev/sketch-draw`.

**Architecture:** Extend the dependency-light `frontend/app/lib/sketch/` kernel: `model.ts` gains a `path` entity + 4 constraint kinds; `residuals.ts` gains their residuals; `solve.ts` gets two overdue cleanups; `sketchPath.ts` learns arcs; `edit.ts` gains path authoring + repeat/mirror instantiation; `merge.ts`/`annotate.ts` follow. The page gains a Path tool + the new verbs. Milestone 2 (bezier pen) is a separate plan.

**Tech Stack:** TypeScript, Vue 3, Vitest, Playwright. No new dependencies.

## Global Constraints

- **No `paper`/`three` anywhere in `lib/sketch/`; deterministic** (no `Math.random`/`Date.now`).
- **Anchors, arc centers are `point` entities.** A path entity holds only structure (ordered point ids + segment specs); it contributes NO free scalars to the solver.
- **Doc stores solved positions; `solve` only on interaction** — never in a computed/render path.
- **refs orders (new kinds):** `equalDist`=[pA,pB,pC,pD] (residual dist(A,B)−dist(C,D)); `rotatedFrom`=[copy,orig,center] with `value`=angle DEGREES; `mirroredFrom`=[copy,orig,axisLine]; `collinear`=[pA,pB,pC].
- **Arc sweep convention:** `SegmentSpec.sweep` is the literal SVG sweep flag for path data emitted in DOC coordinates. A renderer that flips the y axis (the page's shadow doc) MUST flip sweep (`1 - sweep`) for arc segments. Mirroring geometry also flips sweep in the mirrored copy.
- Angles in `rotatedFrom.value` are degrees; convert with `Math.PI / 180` at use.
- **Staging:** parallel-session work + shared `lib/sketch/` dir (untouchable: `sketchIntent.ts`, `sketchPadPrompt.ts`, `sketchPile.ts`). Stage ONLY files each task names, by explicit path. NEVER `git add -A`.
- Unit tests `frontend/tests/unit/<name>.unit.spec.ts` via `npm run test:unit -- <name>`; E2E via `PW_BASE_URL=http://127.0.0.1:<live-port> npx playwright test <name> --project=chromium` against the ALREADY-RUNNING dev server (find the port by curl-probing 3000-3004 for `/dev/sketch-draw` → 200; NEVER start/stop/kill servers).
- Existing suites must stay green: after any task touching a shared file, run `npm run test:unit -- sketch` (all files) and report the total.

**Existing API recap** (import `~/lib/sketch/...`): `model` (`SketchDoc`, `EntityId`, `ConstraintKind`, `getEntity`, `getPoint`, `lineEndpoints`, `circleCenter`), `geom` (`Vec2`, `sub`, `add`, `scale`, `dot`, `cross`, `len`, `dist`, `distPointToLine`), `solve(doc,{maxIter,tol,drag})`, `sketchPath` (`entityPath`, `sketchPathData`), `edit` (`addPoint/addLine/addCircle/addConstraint/removeConstraint/deleteEntity`, all in-place, ids returned), `infer` (`snapPoint`, `inferCircleTangents`), `merge` (`mergeSketchDoc`), `annotate` (`constraintMarks`), `ids` (`freshId`).

All paths relative to `frontend/`.

---

### Task 1: M0 solver cleanups

Fix the two known solver defects: the dead in-loop early-break (burns full `maxIter` every call) and the `n===0` fast path (wrong threshold + skips the revert contract).

**Files:**
- Modify: `app/lib/sketch/solve.ts`
- Modify: `tests/unit/sketch-solve.unit.spec.ts` (append 2 tests)

**Interfaces:** unchanged (`solve`, `SolveOptions`, `SolveResult`, `DragTarget`).

- [ ] **Step 1: Append the failing tests**

```ts
// append to tests/unit/sketch-solve.unit.spec.ts (inside describe('solve'))
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
```

- [ ] **Step 2: Run to verify both fail**

Run: `npm run test:unit -- sketch-solve`
Expected: the two new tests FAIL (iterations === 60; b left at (3,4)); the original 3 still pass.

- [ ] **Step 3: Apply the two fixes in `solve.ts`**

(a) Replace the `n === 0` early-return block with:

```ts
  if (n === 0) {
    const hn = norm(constraintResiduals(doc))
    const converged = hn < 1e-3
    if (!converged) restore(doc, snap)
    return { converged, iterations: 0, residualNorm: hn }
  }
```

(b) In the iteration loop, replace the early-break check. Currently:

```ts
    const r = residualAt(q)
    rNorm = norm(r)
    if (rNorm < tol) break
```

becomes:

```ts
    const r = residualAt(q)
    rNorm = norm(r)
    // break on the HARD residual only — the regularization term keeps the
    // combined norm above tol forever once points have moved from q0.
    const hardNorm = norm(constraintResiduals(doc))
    if (hardNorm < tol) break
```

(`residualAt` leaves the doc written at the probed vector, so `constraintResiduals(doc)` reads the hard residuals at `q` — same state the old combined norm was computed from.)

- [ ] **Step 4: Run to verify all pass**

Run: `npm run test:unit -- sketch-solve`
Expected: PASS (5 tests). Then `npm run test:unit -- sketch` — everything else still green.

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/solve.ts tests/unit/sketch-solve.unit.spec.ts
git commit -m "fix(sketch): solver early-break on hard residual; n==0 path reverts + shared threshold"
```

---

### Task 2: Path entity in model + merge

**Files:**
- Modify: `app/lib/sketch/model.ts`
- Modify: `app/lib/sketch/merge.ts`
- Test: `tests/unit/sketch-path-model.unit.spec.ts`

**Interfaces:**
- Produces (model):
  ```ts
  export type SegmentSpec =
    | { kind: 'line' }
    | { kind: 'arc'; center: EntityId; sweep: 0 | 1 }
    | { kind: 'cubic'; h1: EntityId | null; h2: EntityId | null }   // reserved for M2
  export interface PathEntity {
    id: EntityId; kind: 'path'
    anchors: EntityId[]           // ordered point ids, length >= 2
    segments: SegmentSpec[]       // length == anchors.length - 1 (open) or anchors.length (closed)
    closed: boolean
    construction?: boolean
  }
  ```
  `SketchEntity` union gains `PathEntity`. `ConstraintKind` gains `'equalDist' | 'rotatedFrom' | 'mirroredFrom' | 'collinear'`.
- Merge rules: a path survives only if every anchor id and every arc `center` / cubic handle id resolves to a surviving **point**, anchors.length ≥ 2, and segments.length matches the open/closed contract; otherwise dropped. Paths are validated in a second pass (they may precede their points in the raw array). `NEEDS_VALUE` gains `rotatedFrom`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-path-model.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { mergeSketchDoc } from '~/lib/sketch/merge'

const pts = [
  { id: 'a', kind: 'point', x: 0, y: 0 },
  { id: 'b', kind: 'point', x: 10, y: 0 },
  { id: 'c', kind: 'point', x: 10, y: 8 },
  { id: 'ctr', kind: 'point', x: 10, y: 4 },
]

describe('path entity merge', () => {
  it('keeps a valid open path (line + arc)', () => {
    const d = mergeSketchDoc({
      entities: [
        // path listed BEFORE its points — must still survive (two-pass)
        { id: 'P', kind: 'path', anchors: ['a', 'b', 'c'], segments: [{ kind: 'line' }, { kind: 'arc', center: 'ctr', sweep: 1 }], closed: false },
        ...pts,
      ],
      constraints: [],
    })
    const p = d.entities.find(e => e.id === 'P') as any
    expect(p).toBeDefined()
    expect(p.anchors).toEqual(['a', 'b', 'c'])
    expect(p.segments[1]).toEqual({ kind: 'arc', center: 'ctr', sweep: 1 })
  })

  it('drops a path with a dangling anchor or bad segment count', () => {
    const d = mergeSketchDoc({
      entities: [
        ...pts,
        { id: 'P1', kind: 'path', anchors: ['a', 'GONE'], segments: [{ kind: 'line' }], closed: false },
        { id: 'P2', kind: 'path', anchors: ['a', 'b', 'c'], segments: [{ kind: 'line' }], closed: false }, // needs 2 segments
      ],
      constraints: [],
    })
    expect(d.entities.filter(e => (e as any).kind === 'path')).toHaveLength(0)
  })

  it('accepts a closed path with segments.length === anchors.length', () => {
    const d = mergeSketchDoc({
      entities: [...pts, { id: 'P', kind: 'path', anchors: ['a', 'b', 'c'], segments: [{ kind: 'line' }, { kind: 'line' }, { kind: 'line' }], closed: true }],
      constraints: [],
    })
    expect(d.entities.find(e => e.id === 'P')).toBeDefined()
  })

  it('accepts the new constraint kinds and requires value on rotatedFrom', () => {
    const d = mergeSketchDoc({
      entities: pts,
      constraints: [
        { id: 'k1', kind: 'equalDist', refs: ['a', 'b', 'a', 'c'] },
        { id: 'k2', kind: 'rotatedFrom', refs: ['b', 'c', 'a'], value: 60 },
        { id: 'k3', kind: 'rotatedFrom', refs: ['b', 'c', 'a'] },          // no value → dropped
        { id: 'k4', kind: 'collinear', refs: ['a', 'b', 'c'] },
      ],
    })
    expect(d.constraints.map(c => c.id)).toEqual(['k1', 'k2', 'k4'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- sketch-path-model`
Expected: FAIL (unknown kind 'path' dropped; unknown constraint kinds dropped).

- [ ] **Step 3: Extend `model.ts`**

Add after `CircleEntity`:

```ts
export type SegmentSpec =
  | { kind: 'line' }
  | { kind: 'arc'; center: EntityId; sweep: 0 | 1 }
  | { kind: 'cubic'; h1: EntityId | null; h2: EntityId | null }

export interface PathEntity {
  id: EntityId
  kind: 'path'
  anchors: EntityId[]
  segments: SegmentSpec[]
  closed: boolean
  construction?: boolean
}
```

Change the union to `export type SketchEntity = PointEntity | LineEntity | CircleEntity | PathEntity` and extend `ConstraintKind` with `| 'equalDist' | 'rotatedFrom' | 'mirroredFrom' | 'collinear'`.

- [ ] **Step 4: Extend `merge.ts`**

Add `'equalDist', 'rotatedFrom', 'mirroredFrom', 'collinear'` to `CONSTRAINT_KINDS`; add `'rotatedFrom'` to `NEEDS_VALUE`. Then restructure `mergeSketchDoc`'s entity pass into two passes:

```ts
  // pass 1: non-path entities (unchanged logic)
  const rawPaths: any[] = []
  if (Array.isArray(r.entities)) {
    for (const e of r.entities) {
      if (e && e.kind === 'path') { rawPaths.push(e); continue }
      const m = mergeEntity(e)
      if (m && !seen.has(m.id)) { seen.add(m.id); doc.entities.push(m) }
    }
  }
  // pass 2: paths, validated against surviving points
  const pointIds = new Set(doc.entities.filter(e => e.kind === 'point').map(e => e.id))
  for (const p of rawPaths) {
    if (!isStr(p.id) || seen.has(p.id)) continue
    if (!Array.isArray(p.anchors) || p.anchors.length < 2) continue
    if (!p.anchors.every((a: unknown) => isStr(a) && pointIds.has(a as string))) continue
    const need = p.closed ? p.anchors.length : p.anchors.length - 1
    if (!Array.isArray(p.segments) || p.segments.length !== need) continue
    const segs: any[] = []
    let ok = true
    for (const s of p.segments) {
      if (s && s.kind === 'line') segs.push({ kind: 'line' })
      else if (s && s.kind === 'arc' && isStr(s.center) && pointIds.has(s.center) && (s.sweep === 0 || s.sweep === 1)) segs.push({ kind: 'arc', center: s.center, sweep: s.sweep })
      else if (s && s.kind === 'cubic' && (s.h1 == null || (isStr(s.h1) && pointIds.has(s.h1))) && (s.h2 == null || (isStr(s.h2) && pointIds.has(s.h2)))) segs.push({ kind: 'cubic', h1: s.h1 ?? null, h2: s.h2 ?? null })
      else { ok = false; break }
    }
    if (!ok) continue
    seen.add(p.id)
    doc.entities.push({ id: p.id, kind: 'path', anchors: [...p.anchors], segments: segs, closed: !!p.closed, ...(p.construction ? { construction: true } : {}) } as any)
  }
```

(Keep the constraints pass as-is — it already checks refs against ALL surviving entity ids, which now include paths.)

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:unit -- sketch-path-model` → PASS (4). Then `npm run test:unit -- sketch` → all green (existing merge tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add app/lib/sketch/model.ts app/lib/sketch/merge.ts tests/unit/sketch-path-model.unit.spec.ts
git commit -m "feat(sketch): path entity (line/arc/cubic segments) + new constraint kinds in model/merge"
```

---

### Task 3: New residuals — equalDist, rotatedFrom, mirroredFrom, collinear

**Files:**
- Modify: `app/lib/sketch/residuals.ts`
- Test: `tests/unit/sketch-residuals2.unit.spec.ts`

**Interfaces:** `constraintResiduals` unchanged; four new cases per the Global Constraints refs orders.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-residuals2.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintResiduals } from '~/lib/sketch/residuals'

function d(): SketchDoc {
  return {
    entities: [
      { id: 'o', kind: 'point', x: 0, y: 0 },
      { id: 'p', kind: 'point', x: 1, y: 0 },
      { id: 'q', kind: 'point', x: 0, y: 1 },
      { id: 'r', kind: 'point', x: 2, y: 3 },
      { id: 'ax1', kind: 'point', x: 0, y: 0 },
      { id: 'ax2', kind: 'point', x: 10, y: 0 },
      { id: 'AX', kind: 'line', p1: 'ax1', p2: 'ax2' },   // the x-axis
    ],
    constraints: [],
  }
}

describe('new residuals', () => {
  it('equalDist = dist(A,B) − dist(C,D)', () => {
    const doc = d()
    // dist(o,p)=1, dist(o,q)=1 → 0 ; dist(o,r)=√13
    doc.constraints = [
      { id: 'k1', kind: 'equalDist', refs: ['o', 'p', 'o', 'q'] },
      { id: 'k2', kind: 'equalDist', refs: ['o', 'p', 'o', 'r'] },
    ]
    const res = constraintResiduals(doc)
    expect(res[0]).toBeCloseTo(0, 9)
    expect(res[1]).toBeCloseTo(1 - Math.sqrt(13), 9)
  })

  it('rotatedFrom: copy equals orig rotated by value° about center', () => {
    const doc = d()
    // rotate p(1,0) by 90° about o → (0,1) = q exactly → residuals [0,0]
    doc.constraints = [{ id: 'k', kind: 'rotatedFrom', refs: ['q', 'p', 'o'], value: 90 }]
    const res = constraintResiduals(doc)
    expect(res[0]).toBeCloseTo(0, 9)
    expect(res[1]).toBeCloseTo(0, 9)
    // and a wrong copy: r(2,3) vs rotate(p,90)=(0,1) → [2-0, 3-1]
    doc.constraints = [{ id: 'k', kind: 'rotatedFrom', refs: ['r', 'p', 'o'], value: 90 }]
    expect(constraintResiduals(doc)).toEqual([2, 2])
  })

  it('mirroredFrom: copy equals orig reflected across the axis line', () => {
    const doc = d()
    // reflect r(2,3) across the x-axis → (2,−3); the "copy" q(0,1) is wrong by [0−2, 1−(−3)]
    doc.constraints = [{ id: 'k', kind: 'mirroredFrom', refs: ['q', 'r', 'AX'] }]
    const res = constraintResiduals(doc)
    expect(res[0]).toBeCloseTo(-2, 9)
    expect(res[1]).toBeCloseTo(4, 9)
  })

  it('collinear: cross(B−A, C−A) is 0 on a line, nonzero off it', () => {
    const doc = d()
    doc.constraints = [{ id: 'k', kind: 'collinear', refs: ['o', 'p', 'ax2'] }] // (0,0),(1,0),(10,0) → 0
    expect(constraintResiduals(doc)).toEqual([0])
    doc.constraints = [{ id: 'k', kind: 'collinear', refs: ['o', 'p', 'q'] }]   // cross((1,0),(0,1)) = 1
    expect(constraintResiduals(doc)).toEqual([1])
  })

  it('degenerate mirror axis (zero length) contributes nothing', () => {
    const doc = d()
    ;(doc.entities.find(e => e.id === 'ax2') as any).x = 0
    ;(doc.entities.find(e => e.id === 'ax2') as any).y = 0
    doc.constraints = [{ id: 'k', kind: 'mirroredFrom', refs: ['q', 'r', 'AX'] }]
    expect(constraintResiduals(doc)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- sketch-residuals2` → FAIL (unknown kinds skipped → empty arrays).

- [ ] **Step 3: Add the four cases to `residualsFor` in `residuals.ts`**

```ts
    case 'equalDist': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!)
      const p = getPoint(doc, c.refs[2]!); const q = getPoint(doc, c.refs[3]!)
      if (!a || !b || !p || !q) return null
      return [dist({ x: a.x, y: a.y }, { x: b.x, y: b.y }) - dist({ x: p.x, y: p.y }, { x: q.x, y: q.y })]
    }
    case 'rotatedFrom': {
      const cp = getPoint(doc, c.refs[0]!); const og = getPoint(doc, c.refs[1]!); const ce = getPoint(doc, c.refs[2]!)
      if (!cp || !og || !ce || c.value == null) return null
      const a = c.value * Math.PI / 180
      const co = Math.cos(a), si = Math.sin(a)
      const dx = og.x - ce.x, dy = og.y - ce.y
      const rx = ce.x + co * dx - si * dy
      const ry = ce.y + si * dx + co * dy
      return [cp.x - rx, cp.y - ry]
    }
    case 'mirroredFrom': {
      const cp = getPoint(doc, c.refs[0]!); const og = getPoint(doc, c.refs[1]!); const l = lineOf(doc, c.refs[2]!)
      if (!cp || !og || !l) return null
      const e = lineEndpoints(doc, l); if (!e) return null
      const dirx = e.b.x - e.a.x, diry = e.b.y - e.a.y
      const L = Math.hypot(dirx, diry)
      if (L < 1e-12) return null
      const nx = -diry / L, ny = dirx / L                       // unit normal
      const s = (og.x - e.a.x) * nx + (og.y - e.a.y) * ny       // signed distance to axis
      const rx = og.x - 2 * s * nx
      const ry = og.y - 2 * s * ny
      return [cp.x - rx, cp.y - ry]
    }
    case 'collinear': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!); const p = getPoint(doc, c.refs[2]!)
      if (!a || !b || !p) return null
      return [(b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)]
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- sketch-residuals2` → PASS (5). Then `npm run test:unit -- sketch` → all green.

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/residuals.ts tests/unit/sketch-residuals2.unit.spec.ts
git commit -m "feat(sketch): equalDist / rotatedFrom / mirroredFrom / collinear residuals"
```

---

### Task 4: Path rendering in sketchPath

**Files:**
- Modify: `app/lib/sketch/sketchPath.ts`
- Test: `tests/unit/sketch-path-render.unit.spec.ts`

**Interfaces:** `entityPath` handles `kind === 'path'`; `sketchPathData` includes paths (construction rule unchanged). Arc emission: radius = dist(center, startAnchor); large-arc from the traversed span in the emitted frame; degenerate (r < 1e-6 or coincident endpoints-with-center issues) → fall back to `L`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-path-render.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { entityPath } from '~/lib/sketch/sketchPath'

function doc(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 4, y: 0 },
      { id: 'c', kind: 'point', x: 4, y: 4 },
      { id: 'ctr', kind: 'point', x: 4, y: 2 },   // center of the b→c arc, r = 2
      { id: 'P', kind: 'path', anchors: ['a', 'b', 'c'], segments: [{ kind: 'line' }, { kind: 'arc', center: 'ctr', sweep: 1 }], closed: false },
    ],
    constraints: [],
  }
}

describe('path rendering', () => {
  it('emits line then arc with radius from the center distance', () => {
    const d = entityPath(doc(), 'P')
    expect(d).toBe('M 0 0 L 4 0 A 2 2 0 0 1 4 4')
  })

  it('closed path emits Z and the wrap-around segment', () => {
    const dd = doc()
    ;(dd.entities.find(e => e.id === 'P') as any).closed = true
    ;(dd.entities.find(e => e.id === 'P') as any).segments = [{ kind: 'line' }, { kind: 'arc', center: 'ctr', sweep: 1 }, { kind: 'line' }]
    const d = entityPath(dd, 'P')
    expect(d).toBe('M 0 0 L 4 0 A 2 2 0 0 1 4 4 L 0 0 Z')
  })

  it('large-arc flag: sweep=0 for the same endpoints takes the long way', () => {
    const dd = doc()
    ;(dd.entities.find(e => e.id === 'P') as any).segments = [{ kind: 'line' }, { kind: 'arc', center: 'ctr', sweep: 0 }]
    // b→c around (4,2): CCW span (sweep-1 frame) is π → not large; the sweep=0 direction traverses 2π−π=π too.
    // Move c to make the spans unequal: c=(6,2) → start angle −90°, end 0° ; ccw span=π/2 ; sweep0 span=3π/2 → large
    ;(dd.entities.find(e => e.id === 'c') as any).x = 6
    ;(dd.entities.find(e => e.id === 'c') as any).y = 2
    const d = entityPath(dd, 'P')
    expect(d).toBe('M 0 0 L 4 0 A 2 2 0 1 0 6 2')
  })

  it('degenerate arc (radius ~ 0) falls back to a line', () => {
    const dd = doc()
    const ctr = dd.entities.find(e => e.id === 'ctr') as any
    const b = dd.entities.find(e => e.id === 'b') as any
    ctr.x = b.x; ctr.y = b.y   // center collapsed onto the start anchor
    const d = entityPath(dd, 'P')
    expect(d).toBe('M 0 0 L 4 0 L 4 4')
  })

  it('a dangling anchor makes the path emit nothing', () => {
    const dd = doc()
    ;(dd.entities.find(e => e.id === 'P') as any).anchors = ['a', 'b', 'GONE']
    expect(entityPath(dd, 'P')).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- sketch-path-render` → FAIL (`entityPath` returns `''` for unknown kind).

- [ ] **Step 3: Implement path emission in `sketchPath.ts`**

Add to `entityPath` (after the circle branch), plus a helper:

```ts
function pathD(doc: SketchDoc, p: Extract<SketchEntity, { kind: 'path' }>): string {
  const pts = p.anchors.map(id => getPoint(doc, id))
  if (pts.some(x => !x)) return ''
  const segCount = p.closed ? p.anchors.length : p.anchors.length - 1
  if (p.segments.length !== segCount) return ''
  let d = `M ${num(pts[0]!.x)} ${num(pts[0]!.y)}`
  for (let i = 0; i < segCount; i++) {
    const from = pts[i]!
    const to = pts[(i + 1) % p.anchors.length]!
    const seg = p.segments[i]!
    if (seg.kind === 'arc') {
      const c = getPoint(doc, seg.center)
      const r = c ? Math.hypot(from.x - c.x, from.y - c.y) : 0
      if (!c || r < 1e-6) { d += ` L ${num(to.x)} ${num(to.y)}`; continue }
      const a0 = Math.atan2(from.y - c.y, from.x - c.x)
      const a1 = Math.atan2(to.y - c.y, to.x - c.x)
      const TAU = Math.PI * 2
      const ccw = ((a1 - a0) % TAU + TAU) % TAU
      const span = seg.sweep === 1 ? ccw : TAU - ccw
      const large = span > Math.PI ? 1 : 0
      d += ` A ${num(r)} ${num(r)} 0 ${large} ${seg.sweep} ${num(to.x)} ${num(to.y)}`
    } else {
      // 'line' and (until M2 renders curves) 'cubic' both emit straight
      d += ` L ${num(to.x)} ${num(to.y)}`
    }
  }
  if (p.closed) d += ' Z'
  return d
}
```

In `entityPath`, before the circle logic's final return path, add `if (e.kind === 'path') return pathD(doc, e)`. Import `getPoint` and `SketchEntity` as needed. `sketchPathData` already iterates all non-point entities — paths flow through with the existing construction gate.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- sketch-path-render` → PASS (5). `npm run test:unit -- sketch` → all green.

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/sketchPath.ts tests/unit/sketch-path-render.unit.spec.ts
git commit -m "feat(sketch): path SVG emission — lines, arcs with computed large-arc, closed paths"
```

---

### Task 5: Authoring — addPath, repeatEntities, mirrorEntities

**Files:**
- Modify: `app/lib/sketch/edit.ts`
- Test: `tests/unit/sketch-structural.unit.spec.ts`

**Interfaces:**
- `addPath(doc, anchors: EntityId[], segments: SegmentSpec[], closed?: boolean, opts?: { construction?: boolean }): EntityId` — validates lengths (throws on mismatch is NOT wanted; return `''` and add nothing on invalid input). For every arc segment, auto-adds `equalDist` [center, startAnchor, center, endAnchor].
- `repeatEntities(doc, ids: EntityId[], center: EntityId, count: number): EntityId[][]` — for k=1..count−1 creates a full copy of the point-closure of `ids` (points referenced by selected lines/circles/paths, incl. arc centers, plus selected points), each copy point placed AT its rotated position and given `rotatedFrom` [copy, orig, center] value k·(360/count); copies each selected non-point entity referencing the mapped points (arc `sweep` preserved). Constraints whose refs are entirely inside the closure are copied with mapped refs. Returns the per-k arrays of created entity ids.
- `mirrorEntities(doc, ids: EntityId[], axisLine: EntityId): EntityId[]` — same shape, one copy, `mirroredFrom` [copy, orig, axisLine]; copied arc segments FLIP sweep (mirror reverses orientation). Points placed at reflected positions.
- `deleteEntity` unchanged. (Deleting an original leaves copies detached — their `rotatedFrom` rules drop as dangling. Documented deviation from the spec's cascade wording; noted for the spec.)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-structural.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { addPoint, addLine, addPath, addConstraint, repeatEntities, mirrorEntities } from '~/lib/sketch/edit'
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- sketch-structural` → FAIL (functions don't exist).

- [ ] **Step 3: Implement in `edit.ts`**

```ts
import type { SegmentSpec, PathEntity } from './model'

export function addPath(doc: SketchDoc, anchors: EntityId[], segments: SegmentSpec[], closed = false, opts: { construction?: boolean } = {}): EntityId {
  const need = closed ? anchors.length : anchors.length - 1
  if (anchors.length < 2 || segments.length !== need) return ''
  const id = freshId(doc, 'P')
  doc.entities.push({ id, kind: 'path', anchors: [...anchors], segments: segments.map(s => ({ ...s })), closed, ...(opts.construction ? { construction: true } : {}) })
  // arcs stay true circular arcs: both ends equidistant from the center
  segments.forEach((s, i) => {
    if (s.kind === 'arc') {
      const a = anchors[i]!
      const b = anchors[(i + 1) % anchors.length]!
      addConstraint(doc, 'equalDist', [s.center, a, s.center, b])
    }
  })
  return id
}

// all point ids referenced by an entity (itself if a point)
function pointClosure(doc: SketchDoc, ids: EntityId[]): EntityId[] {
  const out = new Set<EntityId>()
  for (const id of ids) {
    const e = getEntity(doc, id)
    if (!e) continue
    if (e.kind === 'point') out.add(e.id)
    else if (e.kind === 'line') { out.add(e.p1); out.add(e.p2) }
    else if (e.kind === 'circle') out.add(e.center)
    else if (e.kind === 'path') {
      for (const a of e.anchors) out.add(a)
      for (const s of e.segments) {
        if (s.kind === 'arc') out.add(s.center)
        else if (s.kind === 'cubic') { if (s.h1) out.add(s.h1); if (s.h2) out.add(s.h2) }
      }
    }
  }
  return [...out]
}

// copy the selected non-point entities with point ids remapped; returns created ids
function copyStructure(doc: SketchDoc, ids: EntityId[], map: Map<EntityId, EntityId>, flipSweep: boolean): EntityId[] {
  const created: EntityId[] = []
  for (const id of ids) {
    const e = getEntity(doc, id)
    if (!e || e.kind === 'point') continue
    if (e.kind === 'line') created.push(addLine(doc, map.get(e.p1)!, map.get(e.p2)!, e.construction ? { construction: true } : {}))
    else if (e.kind === 'circle') created.push(addCircle(doc, map.get(e.center)!, e.r, e.construction ? { construction: true } : {}))
    else if (e.kind === 'path') {
      const segs: SegmentSpec[] = e.segments.map(s =>
        s.kind === 'arc' ? { kind: 'arc', center: map.get(s.center)!, sweep: (flipSweep ? (1 - s.sweep) as 0 | 1 : s.sweep) }
        : s.kind === 'cubic' ? { kind: 'cubic', h1: s.h1 ? map.get(s.h1)! : null, h2: s.h2 ? map.get(s.h2)! : null }
        : { kind: 'line' })
      // addPath would re-add equalDist for arcs; constraints are copied separately below,
      // so push the raw path entity instead:
      const pid = freshId(doc, 'P')
      doc.entities.push({ id: pid, kind: 'path', anchors: e.anchors.map(a => map.get(a)!), segments: segs, closed: e.closed, ...(e.construction ? { construction: true } : {}) })
      created.push(pid)
    }
  }
  return created
}

// constraints fully inside the closure get copied with mapped refs
function copyClosureConstraints(doc: SketchDoc, map: Map<EntityId, EntityId>): void {
  const source = new Set(map.keys())
  for (const c of [...doc.constraints]) {
    if (c.refs.length > 0 && c.refs.every(r => source.has(r))) {
      addConstraint(doc, c.kind, c.refs.map(r => map.get(r)!), c.value)
    }
  }
}

export function repeatEntities(doc: SketchDoc, ids: EntityId[], center: EntityId, count: number): EntityId[][] {
  const ce = getPoint(doc, center)
  if (!ce || count < 2) return []
  const pts = pointClosure(doc, ids)
  const all: EntityId[][] = []
  for (let k = 1; k < count; k++) {
    const angle = k * (360 / count)
    const rad = angle * Math.PI / 180
    const co = Math.cos(rad), si = Math.sin(rad)
    const map = new Map<EntityId, EntityId>()
    const created: EntityId[] = []
    for (const pid of pts) {
      const p = getPoint(doc, pid)!
      const dx = p.x - ce.x, dy = p.y - ce.y
      const nid = addPoint(doc, ce.x + co * dx - si * dy, ce.y + si * dx + co * dy)
      map.set(pid, nid)
      created.push(nid)
      addConstraint(doc, 'rotatedFrom', [nid, pid, center], angle)
    }
    created.push(...copyStructure(doc, ids, map, false))
    copyClosureConstraints(doc, new Map([...map])) // point-level map; entity-level constraints (radius etc.) referencing non-points aren't copied in v1
    all.push(created)
  }
  return all
}

export function mirrorEntities(doc: SketchDoc, ids: EntityId[], axisLine: EntityId): EntityId[] {
  const ax = getEntity(doc, axisLine)
  if (!ax || ax.kind !== 'line') return []
  const a = getPoint(doc, ax.p1); const b = getPoint(doc, ax.p2)
  if (!a || !b) return []
  const dirx = b.x - a.x, diry = b.y - a.y
  const L = Math.hypot(dirx, diry)
  if (L < 1e-12) return []
  const nx = -diry / L, ny = dirx / L
  const pts = pointClosure(doc, ids)
  const map = new Map<EntityId, EntityId>()
  const created: EntityId[] = []
  for (const pid of pts) {
    const p = getPoint(doc, pid)!
    const s = (p.x - a.x) * nx + (p.y - a.y) * ny
    const nid = addPoint(doc, p.x - 2 * s * nx, p.y - 2 * s * ny)
    map.set(pid, nid)
    created.push(nid)
    addConstraint(doc, 'mirroredFrom', [nid, pid, axisLine])
  }
  created.push(...copyStructure(doc, ids, map, true))
  copyClosureConstraints(doc, map)
  return created
}
```

(`getEntity`, `addLine`, `addCircle`, `addConstraint`, `addPoint`, `freshId` are already imported/local in `edit.ts` — extend imports as needed.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- sketch-structural` → PASS (5). `npm run test:unit -- sketch` → all green.

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/edit.ts tests/unit/sketch-structural.unit.spec.ts
git commit -m "feat(sketch): addPath + repeatEntities/mirrorEntities as live-copy rules"
```

---

### Task 6: Page — Path tool, Repeat…/Mirror…, construction, Flip, Copy as SVG, badges

**Files:**
- Modify: `app/pages/dev/sketch-draw.vue`
- Modify: `app/lib/sketch/annotate.ts` (4 new glyphs + path anchor support)
- Modify: `tests/unit/sketch-annotate.unit.spec.ts` (extend)
- Modify: `tests/sketch-draw.spec.ts` (append the knot E2E)

**Interfaces (window.__sketchDraw additions):**
- `setTool('path')` — path drawing: each canvas click adds an anchor (snapping applies). `setNextSegment('line'|'arc')` chooses the upcoming segment kind (arc centers start at the segment midpoint offset perpendicular by half the chord, sweep 1). `finishPath(close?: boolean)` ends the in-progress path (close welds last→first with a closing segment of the current kind).
- `repeat(ids: EntityId[], centerId: EntityId, count: number)`, `mirror(ids: EntityId[], axisId: EntityId)` — thin wrappers over the edit ops + `runSolve()`.
- `flipH()`, `flipV()` — one-shot: reflect the selected points about the selection's bbox center (mutate coords, then solve).
- `makeConstruction()` — toggle `construction` on selected entities.
- `copySvg(): string` — returns `sketchPathData(doc)` (and writes to clipboard when available).

**Annotate:** GLYPH map gains `equalDist: 'E'`, `rotatedFrom: '↻'`, `mirroredFrom: '⇄'`, `collinear: 'S'`; `anchor()` handles `path` refs (midpoint of first segment's endpoints).

**UI:** a `path` tool button; while the path tool is active a second row shows `line | arc` next-segment toggle + `close` + `finish` buttons; verbs bar gains Repeat… (needs ≥1 entity + exactly one selected point as center — the point is the center; prompts for count), Mirror (needs ≥1 entity + exactly one selected line as axis), Make construction, Flip H, Flip V, Copy SVG. Construction entities render dashed (`stroke-dasharray="4 3"`, lighter stroke) via a second `<path>` fed by construction-only path data; normal path excludes construction (already the default).

**Shadow-doc sweep flip:** the screen-space remap flips y, so in BOTH `pathScreen` and `entityPathScreen` the shadow doc must flip arc sweeps: when copying a path entity, map `segments` with `s.kind === 'arc' ? { ...s, sweep: (1 - s.sweep) } : s`.

- [ ] **Step 1: Extend annotate + its test** (TDD: add test expectations for a `rotatedFrom` mark glyph `↻` anchored at the copy point and an `equalDist` mark `E`; then add the glyphs + a `path` branch in `anchor()` returning the midpoint of the first two resolvable anchors). Run `npm run test:unit -- sketch-annotate` → PASS.

- [ ] **Step 2: Implement the page additions**

In `<script setup>` add (imports: `addPath`, `repeatEntities`, `mirrorEntities` from edit; `SegmentSpec` type):

```ts
type PendingPath = { anchors: EntityId[]; segments: SegmentSpec[] } | null
const pendingPath = ref<PendingPath>(null)
const nextSegment = ref<'line' | 'arc'>('line')

function pathClick(x: number, y: number) {
  const id = placePoint(x, y, pendingPath.value ? [pendingPath.value.anchors[pendingPath.value.anchors.length - 1]!] : [])
  if (!pendingPath.value) { pendingPath.value = { anchors: [id], segments: [] }; return }
  const pp = pendingPath.value
  const prev = doc.value.entities.find(e => e.id === pp.anchors[pp.anchors.length - 1]) as any
  if (id === pp.anchors[0] && pp.anchors.length >= 2) { finishPath(true); return }  // clicked first anchor → close
  if (id === pp.anchors[pp.anchors.length - 1]) return                               // ignore double-click same point
  if (nextSegment.value === 'arc') {
    const cur = doc.value.entities.find(e => e.id === id) as any
    // center: midpoint pushed perpendicular by half the chord
    const mx = (prev.x + cur.x) / 2, my = (prev.y + cur.y) / 2
    const dx = cur.x - prev.x, dy = cur.y - prev.y
    const c = addPoint(doc.value, mx - dy / 2, my + dx / 2)
    pp.segments.push({ kind: 'arc', center: c, sweep: 1 })
  } else {
    pp.segments.push({ kind: 'line' })
  }
  pp.anchors.push(id)
}

function finishPath(close = false) {
  const pp = pendingPath.value
  pendingPath.value = null
  if (!pp || pp.anchors.length < 2) return
  if (close) {
    // closing segment of the current kind between last and first anchors
    if (nextSegment.value === 'arc') {
      const a = doc.value.entities.find(e => e.id === pp.anchors[pp.anchors.length - 1]) as any
      const b = doc.value.entities.find(e => e.id === pp.anchors[0]) as any
      const c = addPoint(doc.value, (a.x + b.x) / 2 - (b.y - a.y) / 2, (a.y + b.y) / 2 + (b.x - a.x) / 2)
      pp.segments.push({ kind: 'arc', center: c, sweep: 1 })
    } else pp.segments.push({ kind: 'line' })
  }
  addPath(doc.value, pp.anchors, pp.segments, close)
  runSolve()
}

function doRepeat(count: number) {
  const ptSel = selection.value.filter(id => (doc.value.entities.find(e => e.id === id) as any)?.kind === 'point')
  const entSel = selection.value.filter(id => !ptSel.includes(id))
  if (ptSel.length !== 1 || entSel.length === 0 || !Number.isFinite(count) || count < 2) return
  repeatEntities(doc.value, entSel, ptSel[0]!, Math.round(count))
  clearSel(); runSolve()
}
function repeatPrompt() {
  const raw = window.prompt('Repeat count?', '6')
  if (raw == null) return
  doRepeat(Number(raw))
}
function doMirror() {
  const lineSel = selection.value.filter(id => (doc.value.entities.find(e => e.id === id) as any)?.kind === 'line')
  const entSel = selection.value.filter(id => !lineSel.includes(id))
  if (lineSel.length !== 1 || entSel.length === 0) return
  mirrorEntities(doc.value, entSel, lineSel[0]!)
  clearSel(); runSolve()
}
function flip(axis: 'h' | 'v') {
  const pts = selection.value.map(id => doc.value.entities.find(e => e.id === id)).filter((e: any) => e?.kind === 'point') as any[]
  if (!pts.length) return
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  for (const p of pts) { if (axis === 'h') p.x = 2 * cx - p.x; else p.y = 2 * cy - p.y }
  runSolve()
}
function makeConstruction() {
  for (const id of selection.value) {
    const e = doc.value.entities.find(x => x.id === id) as any
    if (e && e.kind !== 'point') e.construction = !e.construction
  }
  clearSel(); runSolve()
}
function copySvg(): string {
  const d = sketchPathData(doc.value)
  try { navigator.clipboard?.writeText(d) } catch {}
  return d
}
```

Wire `pathClick` into `onPointerDownSvg` (`tool==='path'` → `pathClick(x,y)`), add `'path'` to the tool list, add the next-segment toggle row (`v-if="tool === 'path'"` with buttons `data-seg="line"`, `data-seg="arc"`, `data-act="close"` → `finishPath(true)`, `data-act="finish"` → `finishPath(false)`), add verb buttons (Repeat… `data-verb="repeat"` → `repeatPrompt()`; Mirror `data-verb="mirror"` → `doMirror()`; Make construction; Flip H/V; Copy SVG). Construction rendering: add a computed `constructionScreen` (same shadow transform, entities filtered to `construction`, emitted with `includeConstruction: true` per-entity via `entityPath`) rendered as `<path ... stroke="#9ca3af" stroke-dasharray="4 3" />`. **Apply the sweep flip in the shadow transforms** (both `pathScreen` and `entityPathScreen`): when cloning a `path` entity into the shadow doc, `segments: e.segments.map(s => s.kind === 'arc' ? { ...s, sweep: (1 - s.sweep) as 0|1 } : s)`.

Expose the new API members in `onMounted` (`setNextSegment`, `finishPath`, `repeat: (ids, c, n) => { repeatEntities(doc.value, ids, c, n); runSolve() }`, `mirror`, `flipH: () => flip('h')`, `flipV: () => flip('v')`, `makeConstruction`, `copySvg`).

- [ ] **Step 3: Append the knot E2E**

```ts
// append to tests/sketch-draw.spec.ts
test('knot: unit path repeated 6x stays symmetric and welded under drag', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const result = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    // center (fixed) via point tool then fix through the doc
    D.setTool('point'); D.place(8, 6)
    const ctr = D.doc.entities.find((e: any) => e.kind === 'point').id
    D.doc.entities.find((e: any) => e.id === ctr).fixed = true
    // unit: line up + arc over — drawn with the path tool API
    D.setTool('path')
    D.place(8, 1); D.place(8, 3)                     // line segment
    D.setNextSegment('arc'); D.place(10.5, 4.5)      // arc segment
    D.finishPath(false)
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    // repeat 6x about the center
    D.repeat([path.id], ctr, 6)
    const paths = D.doc.entities.filter((e: any) => e.kind === 'path')
    const rotCount = D.doc.constraints.filter((c: any) => c.kind === 'rotatedFrom').length
    // drag the unit's outer anchor; symmetry must hold through the rules
    const outer = path.anchors[2]
    D.drag(outer, 11, 5.5)
    // check: every 60° copy of `outer` equals rotate(outer, k*60) about ctr
    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const o = P(outer), c = P(ctr)
    let maxErr = 0
    for (const k of [1, 2, 3, 4, 5]) {
      const con = D.doc.constraints.find((x: any) => x.kind === 'rotatedFrom' && x.refs[1] === outer && Math.round(x.value) === k * 60)
      const cp = P(con.refs[0])
      const a = k * 60 * Math.PI / 180
      const rx = c.x + Math.cos(a) * (o.x - c.x) - Math.sin(a) * (o.y - c.y)
      const ry = c.y + Math.sin(a) * (o.x - c.x) + Math.cos(a) * (o.y - c.y)
      maxErr = Math.max(maxErr, Math.hypot(cp.x - rx, cp.y - ry))
    }
    return { paths: paths.length, rotCount, maxErr, status: D.status(), svg: D.copySvg().length }
  })

  expect(result.paths).toBe(6)
  expect(result.rotCount).toBeGreaterThanOrEqual(15)   // ≥3 pts × 5 copies
  expect(result.maxErr).toBeLessThan(0.01)             // symmetry held under drag
  expect(result.svg).toBeGreaterThan(50)               // real SVG came out
})
```

- [ ] **Step 4: Run the E2E**

Find the live port; run `PW_BASE_URL=http://127.0.0.1:<port> npx playwright test sketch-draw --project=chromium`. Expected: 3 passed (2 existing + knot). Can't-load → DONE_WITH_CONCERNS; invariant fails → BLOCKED with numbers, don't weaken.

- [ ] **Step 5: Commit**

```bash
git add app/pages/dev/sketch-draw.vue app/lib/sketch/annotate.ts tests/unit/sketch-annotate.unit.spec.ts tests/sketch-draw.spec.ts
git commit -m "feat(sketch): path tool + Repeat/Mirror verbs + construction/flip/copy-svg on the drawing surface"
```

---

### Task 7: Close-out

- [ ] **Step 1:** `npm run test:unit -- sketch` → all green; record totals.
- [ ] **Step 2:** Controller live-verification in the Browser pane: hand-build the knot (path tool clicks, Repeat…, weld two unit endpoints Coincident, drag a point and a dimension), screenshot or numeric sweep. This is the milestone's real exit test.
- [ ] **Step 3:** Update `docs/STATE.md` (entry near the Phase-2 one: construction paths + Repeat/Mirror landed dev-only, knot exit test passed; bezier pen M2 next) and the memory file + `MEMORY.md` pointer (path model, sweep-flip gotcha, repeat-as-rules design, deviation note: deleting an original detaches copies rather than cascading). Note the spec deviation in the spec file itself (one-line edit under Repeat).
- [ ] **Step 4:** Commit docs: `git add docs/STATE.md docs/superpowers/specs/2026-08-29-sketch-path-pen-design.md && git commit -m "docs(sketch): STATE + spec note for construction paths landing"`.

---

## Self-Review

**Spec coverage (M0+M1):** M0 fixes → Task 1. Path entity + arc integrity → Tasks 2/5. New rules → Task 3. Arc rendering + closed paths + degenerate clamp → Task 4. Repeat/Mirror as live copies incl. sweep flip on mirror + intra-closure constraint copying → Task 5. Path tool + segment toggle + close + construction rendering + Flip + Copy as SVG + badges + knot E2E → Task 6. Welding uses the existing Coincident verb (no new work). Trim = M1.5 stretch, deliberately not in this plan; bezier = M2 plan. Deviation documented: original-delete detaches copies (Task 5 + close-out spec note).

**Placeholder scan:** all code steps complete; no TBDs.

**Type consistency:** `SegmentSpec`/`PathEntity` shapes identical across model/merge/sketchPath/edit/page; `repeatEntities(doc, ids, center, count)` / `mirrorEntities(doc, ids, axisLine)` consistent between edit, page wrappers, and E2E; refs orders match residuals (`rotatedFrom`=[copy,orig,center]+value°, `mirroredFrom`=[copy,orig,axisLine], `equalDist`=[c,a,c,b]); sweep-flip rule stated once in Global Constraints and applied in Task 5 (mirror) and Task 6 (shadow render).
