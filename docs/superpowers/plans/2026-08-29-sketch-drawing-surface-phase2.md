# Sketch Drawing Surface — Phase 2 (standalone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the sketch solver into a real drawing tool on an isolated dev page — place points, lines, and circles; snap-to-geometry while drawing so relationships are captured automatically; select things and apply constraints (tangent, coincident, concentric…); drag to edit with live re-solving; see constraint badges and dimension chips.

**Architecture:** Extend the dependency-light `frontend/app/lib/sketch/` kernel from Phase 1 with pure authoring (`edit.ts`), fresh-id generation (`ids.ts`), draw-time snapping/inference (`infer.ts`), and a tolerant validator (`merge.ts`). A new hidden page `app/pages/dev/sketch-draw.vue` composes them into an interactive surface. Phase 1's `sketch-solver-lab.vue` stays untouched. NOT mounted in Shape Studio (later phase, deliberate).

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Nuxt pages, Vitest, Playwright.

## Global Constraints

- **No `paper`/`three` imports anywhere in `lib/sketch/`.** Pure TypeScript; runs in Vitest.
- **Deterministic:** no `Math.random()`, no `Date.now()` in any `lib/sketch/` file. Fresh ids come from a doc-scanning counter, not randomness.
- **The document stores solved positions; rendering never solves.** Only interaction (place / drag / apply-constraint / delete) calls `solve`.
- **Rules reference entity ids, never array positions.** All positional freedom lives in `point` entities; lines/circles reference point ids. (Inherited from Phase 1.)
- **Phase 1 files are frozen.** Do not edit `geom.ts`, `model.ts`, `residuals.ts`, `linalg.ts`, `solve.ts`, `sketchPath.ts`, `sketch-solver-lab.vue`, or their tests. Only ADD new files, except where a task explicitly extends one.
- **Staging:** uncommitted parallel-session work + a shared `lib/sketch/` directory (parallel `sketchIntent.ts`/`sketchPadPrompt.ts`/`sketchPile.ts` — do not touch). Stage ONLY the files each task names, by explicit path. NEVER `git add -A` / `git add .`.
- Dev page: `definePageMeta({ layout: false })` + top comment `// Dev harness — not linked in the app.`
- Unit tests: `frontend/tests/unit/<name>.unit.spec.ts`, run `npm run test:unit -- <name>`. E2E: `frontend/tests/<name>.spec.ts`, run against the already-running dev server (find the live port; do NOT start/stop/kill any dev server).

**Phase-1 API available (import from `~/lib/sketch/...`):**
- `model`: types `SketchDoc`, `SketchEntity`, `PointEntity`, `LineEntity`, `CircleEntity`, `SketchConstraint`, `ConstraintKind`, `EntityId`; `getEntity`, `getPoint`, `lineEndpoints`, `circleCenter`.
- `geom`: `Vec2`, `sub`, `add`, `scale`, `dot`, `cross`, `len`, `dist`, `distPointToLine`.
- `solve`: `solve(doc, opts)`, `SolveOptions`, `SolveResult`, `DragTarget`.
- `sketchPath`: `entityPath`, `sketchPathData`.

All paths relative to `frontend/`.

---

### Task 1: Fresh ids + pure authoring ops (`ids.ts`, `edit.ts`)

Authoring functions that add and delete entities/constraints on a doc, with collision-free ids and cascading delete.

**Files:**
- Create: `app/lib/sketch/ids.ts`
- Create: `app/lib/sketch/edit.ts`
- Test: `tests/unit/sketch-edit.unit.spec.ts`

**Interfaces:**
- Produces (`ids.ts`): `freshId(doc: SketchDoc, prefix?: string): string` — an id not present on any entity or constraint in `doc` (scans; deterministic; no randomness).
- Produces (`edit.ts`):
  - `addPoint(doc, x: number, y: number, opts?: { fixed?: boolean; construction?: boolean }): EntityId`
  - `addLine(doc, p1: EntityId, p2: EntityId, opts?: { construction?: boolean }): EntityId`
  - `addCircle(doc, center: EntityId, r: number, opts?: { construction?: boolean }): EntityId`
  - `addConstraint(doc, kind: ConstraintKind, refs: EntityId[], value?: number): EntityId`
  - `removeConstraint(doc, id: EntityId): void`
  - `deleteEntity(doc, id: EntityId): void` — cascades: deleting a point removes any line/circle referencing it (recursively) and any constraint referencing it; deleting a line/circle removes constraints referencing it.
  All mutate `doc` in place; the `add*` functions return the new id.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-edit.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { freshId } from '~/lib/sketch/ids'
import { addPoint, addLine, addCircle, addConstraint, removeConstraint, deleteEntity } from '~/lib/sketch/edit'

const emptyDoc = (): SketchDoc => ({ entities: [], constraints: [] })

describe('freshId', () => {
  it('never collides with existing ids and is deterministic', () => {
    const d = emptyDoc()
    const a = freshId(d); d.entities.push({ id: a, kind: 'point', x: 0, y: 0 })
    const b = freshId(d)
    expect(b).not.toBe(a)
    // deterministic: same doc state → same next id
    const d2 = emptyDoc(); d2.entities.push({ id: a, kind: 'point', x: 0, y: 0 })
    expect(freshId(d2)).toBe(b)
  })
})

describe('authoring ops', () => {
  it('adds points, a line, a circle, and a constraint', () => {
    const d = emptyDoc()
    const p1 = addPoint(d, 0, 0)
    const p2 = addPoint(d, 10, 0)
    const L = addLine(d, p1, p2)
    const pc = addPoint(d, 5, 5)
    const C = addCircle(d, pc, 3)
    const k = addConstraint(d, 'tangentLineCircle', [L, C])
    expect(d.entities.map(e => e.kind)).toEqual(['point', 'point', 'line', 'point', 'circle'])
    expect(d.constraints).toHaveLength(1)
    expect(d.constraints[0]).toMatchObject({ id: k, kind: 'tangentLineCircle', refs: [L, C] })
  })

  it('removeConstraint drops just that constraint', () => {
    const d = emptyDoc()
    const p1 = addPoint(d, 0, 0), p2 = addPoint(d, 1, 1)
    const k = addConstraint(d, 'coincident', [p1, p2])
    removeConstraint(d, k)
    expect(d.constraints).toHaveLength(0)
    expect(d.entities).toHaveLength(2) // entities untouched
  })

  it('deleteEntity on a point cascades to dependent line + constraints', () => {
    const d = emptyDoc()
    const p1 = addPoint(d, 0, 0), p2 = addPoint(d, 10, 0)
    const L = addLine(d, p1, p2)
    addConstraint(d, 'horizontal', [L])
    deleteEntity(d, p1)
    // p1 gone, the line that referenced it gone, the constraint on that line gone
    expect(d.entities.find(e => e.id === p1)).toBeUndefined()
    expect(d.entities.find(e => e.id === L)).toBeUndefined()
    expect(d.entities.find(e => e.id === p2)).toBeDefined() // unrelated point stays
    expect(d.constraints).toHaveLength(0)
  })

  it('deleteEntity on a circle removes its constraints but keeps its center point', () => {
    const d = emptyDoc()
    const pc = addPoint(d, 5, 5)
    const C = addCircle(d, pc, 3)
    addConstraint(d, 'radius', [C], 3)
    deleteEntity(d, C)
    expect(d.entities.find(e => e.id === C)).toBeUndefined()
    expect(d.entities.find(e => e.id === pc)).toBeDefined() // center point not auto-removed
    expect(d.constraints).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- sketch-edit`
Expected: FAIL — cannot resolve `~/lib/sketch/ids` / `~/lib/sketch/edit`.

- [ ] **Step 3: Write `ids.ts`**

```ts
// app/lib/sketch/ids.ts
import type { SketchDoc } from './model'

// A fresh id not present on any entity or constraint in doc. Deterministic
// (scans the doc), no randomness — safe for the dependency-light tier.
export function freshId(doc: SketchDoc, prefix = 'e'): string {
  const has = (x: string) =>
    doc.entities.some(e => e.id === x) || doc.constraints.some(c => c.id === x)
  let n = doc.entities.length + doc.constraints.length + 1
  let id = `${prefix}${n}`
  while (has(id)) { n++; id = `${prefix}${n}` }
  return id
}
```

- [ ] **Step 4: Write `edit.ts`**

```ts
// app/lib/sketch/edit.ts
import type { SketchDoc, EntityId, ConstraintKind, LineEntity, CircleEntity } from './model'
import { getEntity } from './model'
import { freshId } from './ids'

export function addPoint(doc: SketchDoc, x: number, y: number, opts: { fixed?: boolean; construction?: boolean } = {}): EntityId {
  const id = freshId(doc, 'p')
  doc.entities.push({ id, kind: 'point', x, y, ...(opts.fixed ? { fixed: true } : {}), ...(opts.construction ? { construction: true } : {}) })
  return id
}

export function addLine(doc: SketchDoc, p1: EntityId, p2: EntityId, opts: { construction?: boolean } = {}): EntityId {
  const id = freshId(doc, 'l')
  doc.entities.push({ id, kind: 'line', p1, p2, ...(opts.construction ? { construction: true } : {}) })
  return id
}

export function addCircle(doc: SketchDoc, center: EntityId, r: number, opts: { construction?: boolean } = {}): EntityId {
  const id = freshId(doc, 'c')
  doc.entities.push({ id, kind: 'circle', center, r, ...(opts.construction ? { construction: true } : {}) })
  return id
}

export function addConstraint(doc: SketchDoc, kind: ConstraintKind, refs: EntityId[], value?: number): EntityId {
  const id = freshId(doc, 'k')
  doc.constraints.push({ id, kind, refs: [...refs], ...(value != null ? { value } : {}) })
  return id
}

export function removeConstraint(doc: SketchDoc, id: EntityId): void {
  doc.constraints = doc.constraints.filter(c => c.id !== id)
}

// Delete an entity and everything that structurally depends on it.
export function deleteEntity(doc: SketchDoc, id: EntityId): void {
  const e = getEntity(doc, id)
  if (!e) return
  // entities that reference this one and must go too (only points have dependents)
  const dependents: EntityId[] = []
  if (e.kind === 'point') {
    for (const other of doc.entities) {
      if (other.kind === 'line' && (other.p1 === id || other.p2 === id)) dependents.push(other.id)
      else if (other.kind === 'circle' && other.center === id) dependents.push(other.id)
    }
  }
  // remove this entity
  doc.entities = doc.entities.filter(x => x.id !== id)
  // drop constraints that reference the removed entity
  doc.constraints = doc.constraints.filter(c => !c.refs.includes(id))
  // recurse into dependents
  for (const depId of dependents) deleteEntity(doc, depId)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- sketch-edit`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/sketch/ids.ts app/lib/sketch/edit.ts tests/unit/sketch-edit.unit.spec.ts
git commit -m "feat(sketch): fresh-id generator + pure authoring ops with cascading delete"
```

---

### Task 2: Draw-time snapping / inference (`infer.ts`)

When drawing, propose relationships from proximity: snap a new point onto an existing point (coincident), onto a line (point-on-line), or onto a circle (point-on-circle); and when a circle is finished, detect approximate tangency to lines and other circles. Pure functions — the page decides whether to commit them.

**Files:**
- Create: `app/lib/sketch/infer.ts`
- Test: `tests/unit/sketch-infer.unit.spec.ts`

**Interfaces:**
- Consumes: model + accessors; `dist`, `distPointToLine`, `sub`, `len`, `scale`, `add` from geom.
- Produces:
  - `interface PointSnap { kind: 'coincident' | 'pointOnLine' | 'pointOnCircle'; targetId: EntityId; x: number; y: number; dist: number }`
  - `snapPoint(doc, x: number, y: number, opts?: { tol?: number; exclude?: EntityId[] }): { x: number; y: number; snap: PointSnap | null }` — returns the best snap within `tol` (default 0.6 world units) and the adjusted coordinates (exact for coincident; the projected/closest point for line/circle). Points win ties over curves; nearer wins among same class. Entities listed in `exclude` (and construction entities' own points if excluded) are ignored.
  - `interface TangentInfer { kind: 'tangentLineCircle' | 'tangentCircleCircle'; targetId: EntityId }`
  - `inferCircleTangents(doc, centerX: number, centerY: number, r: number, opts?: { tol?: number; exclude?: EntityId[] }): TangentInfer[]` — lines where `|perpDist(center, line) - r| < tol`, and circles where `|dist(centers) - (rThis + rOther)| < tol` (external tangency), default `tol` 0.6.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-infer.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { snapPoint, inferCircleTangents } from '~/lib/sketch/infer'

function doc(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 10, y: 0 },
      { id: 'L', kind: 'line', p1: 'a', p2: 'b' },      // x-axis segment
      { id: 'cc', kind: 'point', x: 5, y: 10 },
      { id: 'C', kind: 'circle', center: 'cc', r: 3 },   // circle at (5,10) r3
    ],
    constraints: [],
  }
}

describe('snapPoint', () => {
  it('snaps to a nearby existing point (coincident) with exact coords', () => {
    const r = snapPoint(doc(), 0.2, -0.1)
    expect(r.snap?.kind).toBe('coincident')
    expect(r.snap?.targetId).toBe('a')
    expect(r).toMatchObject({ x: 0, y: 0 })
  })

  it('snaps onto a line (point-on-line) projecting to the line', () => {
    const r = snapPoint(doc(), 4, 0.3) // just above the x-axis, far from endpoints
    expect(r.snap?.kind).toBe('pointOnLine')
    expect(r.snap?.targetId).toBe('L')
    expect(r.y).toBeCloseTo(0, 6)   // projected onto the axis
    expect(r.x).toBeCloseTo(4, 6)
  })

  it('snaps onto a circle (point-on-circle) at the nearest circumference point', () => {
    // near the bottom of circle C (center 5,10 r3 → bottom point (5,7))
    const r = snapPoint(doc(), 5, 7.3)
    expect(r.snap?.kind).toBe('pointOnCircle')
    expect(r.snap?.targetId).toBe('C')
    expect(r.x).toBeCloseTo(5, 6)
    expect(r.y).toBeCloseTo(7, 6)
  })

  it('returns no snap when nothing is within tolerance', () => {
    const r = snapPoint(doc(), 50, 50)
    expect(r.snap).toBeNull()
    expect(r).toMatchObject({ x: 50, y: 50 })
  })
})

describe('inferCircleTangents', () => {
  it('detects tangency to a line when |perpDist - r| is tiny', () => {
    // a circle centered at (5,3) radius 3 is tangent to the x-axis line L
    const t = inferCircleTangents(doc(), 5, 3, 3)
    expect(t.some(x => x.kind === 'tangentLineCircle' && x.targetId === 'L')).toBe(true)
  })

  it('detects external tangency to another circle', () => {
    // existing C at (5,10) r3; a new circle at (5,16) r3 → centers 6 apart = 3+3 → tangent
    const t = inferCircleTangents(doc(), 5, 16, 3)
    expect(t.some(x => x.kind === 'tangentCircleCircle' && x.targetId === 'C')).toBe(true)
  })

  it('returns nothing when clearly not tangent', () => {
    expect(inferCircleTangents(doc(), 50, 50, 1)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- sketch-infer`
Expected: FAIL — cannot resolve `~/lib/sketch/infer`.

- [ ] **Step 3: Write `infer.ts`**

```ts
// app/lib/sketch/infer.ts
import type { SketchDoc, EntityId, PointEntity, LineEntity, CircleEntity } from './model'
import { lineEndpoints, circleCenter } from './model'
import { dist, distPointToLine, sub, add, scale, len, dot, type Vec2 } from './geom'

export interface PointSnap {
  kind: 'coincident' | 'pointOnLine' | 'pointOnCircle'
  targetId: EntityId
  x: number
  y: number
  dist: number
}

// closest point on the infinite line through a→b to p
function projectOnLine(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a)
  const L2 = dot(ab, ab)
  if (L2 < 1e-12) return { x: a.x, y: a.y }
  const t = dot(sub(p, a), ab) / L2
  return add(a, scale(ab, t))
}

export function snapPoint(
  doc: SketchDoc,
  x: number,
  y: number,
  opts: { tol?: number; exclude?: EntityId[] } = {},
): { x: number; y: number; snap: PointSnap | null } {
  const tol = opts.tol ?? 0.6
  const exclude = new Set(opts.exclude ?? [])
  const p = { x, y }
  let best: PointSnap | null = null
  const consider = (s: PointSnap) => {
    if (s.dist > tol) return
    // points beat curves; otherwise nearer wins
    if (!best) { best = s; return }
    const rank = (k: PointSnap['kind']) => (k === 'coincident' ? 0 : 1)
    if (rank(s.kind) < rank(best.kind) || (rank(s.kind) === rank(best.kind) && s.dist < best.dist)) best = s
  }
  for (const e of doc.entities) {
    if (exclude.has(e.id)) continue
    if (e.kind === 'point') {
      const d = dist(p, { x: e.x, y: e.y })
      consider({ kind: 'coincident', targetId: e.id, x: e.x, y: e.y, dist: d })
    } else if (e.kind === 'line') {
      const ep = lineEndpoints(doc, e); if (!ep) continue
      const proj = projectOnLine(p, ep.a, ep.b)
      consider({ kind: 'pointOnLine', targetId: e.id, x: proj.x, y: proj.y, dist: dist(p, proj) })
    } else if (e.kind === 'circle') {
      const cen = circleCenter(doc, e); if (!cen) continue
      const toC = sub(p, cen)
      const l = len(toC)
      if (l < 1e-9) continue // center itself — no meaningful circumference direction
      const on = add(cen, scale(toC, e.r / l))
      consider({ kind: 'pointOnCircle', targetId: e.id, x: on.x, y: on.y, dist: Math.abs(l - e.r) })
    }
  }
  if (best) return { x: best.x, y: best.y, snap: best }
  return { x, y, snap: null }
}

export interface TangentInfer {
  kind: 'tangentLineCircle' | 'tangentCircleCircle'
  targetId: EntityId
}

export function inferCircleTangents(
  doc: SketchDoc,
  centerX: number,
  centerY: number,
  r: number,
  opts: { tol?: number; exclude?: EntityId[] } = {},
): TangentInfer[] {
  const tol = opts.tol ?? 0.6
  const exclude = new Set(opts.exclude ?? [])
  const c = { x: centerX, y: centerY }
  const out: TangentInfer[] = []
  for (const e of doc.entities) {
    if (exclude.has(e.id)) continue
    if (e.kind === 'line') {
      const ep = lineEndpoints(doc, e); if (!ep) continue
      if (Math.abs(Math.abs(distPointToLine(c, ep.a, ep.b)) - r) < tol) {
        out.push({ kind: 'tangentLineCircle', targetId: e.id })
      }
    } else if (e.kind === 'circle') {
      const cen = circleCenter(doc, e); if (!cen) continue
      if (Math.abs(dist(c, cen) - (r + e.r)) < tol) {
        out.push({ kind: 'tangentCircleCircle', targetId: e.id })
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- sketch-infer`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/infer.ts tests/unit/sketch-infer.unit.spec.ts
git commit -m "feat(sketch): draw-time snapping + circle tangency inference"
```

---

### Task 3: Tolerant validator (`merge.ts`)

A defensive `mergeSketchDoc(raw)` so a doc from anywhere (a saved blob, a hand-built object) is clamped to a valid `SketchDoc`: bad entities/constraints dropped, dangling constraints dropped, `r` non-negative, ids de-duplicated.

**Files:**
- Create: `app/lib/sketch/merge.ts`
- Test: `tests/unit/sketch-merge.unit.spec.ts`

**Interfaces:**
- Produces: `mergeSketchDoc(raw: unknown): SketchDoc` — always returns a valid doc (empty if `raw` is unusable). Rules: entity must have a string `id` and a known `kind` with its required fields (`point`: numeric x,y; `line`: string p1,p2; `circle`: string center + numeric r≥0); duplicate ids dropped (first wins); constraint must have string id, known kind, a `refs` array of strings all resolving to surviving entities, and a numeric `value` when the kind requires one (`distance`, `radius`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-merge.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { mergeSketchDoc } from '~/lib/sketch/merge'

describe('mergeSketchDoc', () => {
  it('returns an empty doc for garbage', () => {
    expect(mergeSketchDoc(null)).toEqual({ entities: [], constraints: [] })
    expect(mergeSketchDoc(42)).toEqual({ entities: [], constraints: [] })
    expect(mergeSketchDoc({})).toEqual({ entities: [], constraints: [] })
  })

  it('keeps valid entities, drops malformed ones, clamps negative r', () => {
    const d = mergeSketchDoc({
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 'nope', y: 0 },        // bad coord → dropped
        { id: 'cc', kind: 'point', x: 5, y: 5 },
        { id: 'C', kind: 'circle', center: 'cc', r: -3 },   // r clamped to 0
        { kind: 'point', x: 1, y: 1 },                       // no id → dropped
      ],
      constraints: [],
    })
    expect(d.entities.map(e => e.id)).toEqual(['a', 'cc', 'C'])
    expect((d.entities.find(e => e.id === 'C') as any).r).toBe(0)
  })

  it('drops dangling constraints and value-less dimensions', () => {
    const d = mergeSketchDoc({
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 10, y: 0 },
      ],
      constraints: [
        { id: 'k1', kind: 'coincident', refs: ['a', 'b'] },       // ok
        { id: 'k2', kind: 'coincident', refs: ['a', 'GONE'] },    // dangling → dropped
        { id: 'k3', kind: 'distance', refs: ['a', 'b'] },         // missing value → dropped
        { id: 'k4', kind: 'distance', refs: ['a', 'b'], value: 5 }, // ok
      ],
    })
    expect(d.constraints.map(c => c.id)).toEqual(['k1', 'k4'])
  })

  it('drops duplicate entity ids (first wins)', () => {
    const d = mergeSketchDoc({
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'a', kind: 'point', x: 9, y: 9 },
      ],
      constraints: [],
    })
    expect(d.entities).toHaveLength(1)
    expect((d.entities[0] as any).x).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- sketch-merge`
Expected: FAIL — cannot resolve `~/lib/sketch/merge`.

- [ ] **Step 3: Write `merge.ts`**

```ts
// app/lib/sketch/merge.ts
import type { SketchDoc, SketchEntity, SketchConstraint, ConstraintKind } from './model'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

const CONSTRAINT_KINDS: ConstraintKind[] = [
  'coincident', 'pointOnLine', 'pointOnCircle', 'tangentLineCircle', 'tangentCircleCircle',
  'concentric', 'horizontal', 'vertical', 'distance', 'radius',
]
const NEEDS_VALUE = new Set<ConstraintKind>(['distance', 'radius'])

function mergeEntity(raw: any): SketchEntity | null {
  if (!raw || !isStr(raw.id)) return null
  const base = { id: raw.id, ...(raw.construction ? { construction: true } : {}) }
  if (raw.kind === 'point') {
    if (!isNum(raw.x) || !isNum(raw.y)) return null
    return { ...base, kind: 'point', x: raw.x, y: raw.y, ...(raw.fixed ? { fixed: true } : {}) }
  }
  if (raw.kind === 'line') {
    if (!isStr(raw.p1) || !isStr(raw.p2)) return null
    return { ...base, kind: 'line', p1: raw.p1, p2: raw.p2 }
  }
  if (raw.kind === 'circle') {
    if (!isStr(raw.center) || !isNum(raw.r)) return null
    return { ...base, kind: 'circle', center: raw.center, r: Math.max(0, raw.r) }
  }
  return null
}

export function mergeSketchDoc(raw: unknown): SketchDoc {
  const doc: SketchDoc = { entities: [], constraints: [] }
  if (!raw || typeof raw !== 'object') return doc
  const r = raw as any

  const seen = new Set<string>()
  if (Array.isArray(r.entities)) {
    for (const e of r.entities) {
      const m = mergeEntity(e)
      if (m && !seen.has(m.id)) { seen.add(m.id); doc.entities.push(m) }
    }
  }

  const ids = new Set(doc.entities.map(e => e.id))
  const seenK = new Set<string>()
  if (Array.isArray(r.constraints)) {
    for (const c of r.constraints) {
      if (!c || !isStr(c.id) || seenK.has(c.id)) continue
      if (!CONSTRAINT_KINDS.includes(c.kind)) continue
      if (!Array.isArray(c.refs) || !c.refs.every((x: unknown) => isStr(x) && ids.has(x as string))) continue
      if (NEEDS_VALUE.has(c.kind) && !isNum(c.value)) continue
      seenK.add(c.id)
      doc.constraints.push({ id: c.id, kind: c.kind, refs: [...c.refs], ...(isNum(c.value) ? { value: c.value } : {}) } as SketchConstraint)
    }
  }
  return doc
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- sketch-merge`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/merge.ts tests/unit/sketch-merge.unit.spec.ts
git commit -m "feat(sketch): tolerant SketchDoc validator (merge)"
```

---

### Task 4: Drawing page — tools, placement, drag (core)

The interactive surface. Point/Line/Circle tools place geometry (snapping via `infer`), Select drags points (solving live). Exposes `window.__sketchDraw` so an E2E can draw without pixel math. Constraint application and badges come in Tasks 5–6.

**Files:**
- Create: `app/pages/dev/sketch-draw.vue`
- Test: `tests/sketch-draw.spec.ts`

**Interfaces:**
- Consumes: `edit` (addPoint/addLine/addCircle/addConstraint/deleteEntity), `infer` (snapPoint/inferCircleTangents), `solve`, `sketchPathData`, model types.
- Produces (on `window`): `__sketchDraw` with:
  - `get doc()`, `get tool()`, `get selection()` (string[]), `status()`, `pathData()`, `entityCount()`, `constraintCount()`
  - `setTool(t: 'select'|'point'|'line'|'circle')`, `reset()`
  - `place(x: number, y: number)` — perform the current tool's placement at world (x,y) (the same code path the SVG click uses)
  - `drag(id: EntityId, x: number, y: number)` — move a point to world (x,y) and solve
  - (Tasks 5 add `pick`, `apply`, `del`.)

- [ ] **Step 1: Write the page**

```vue
<!-- app/pages/dev/sketch-draw.vue -->
<script setup lang="ts">
// Dev harness — not linked in the app. Interactive constraint drawing surface.
definePageMeta({ layout: false })
import { ref, computed, onMounted } from 'vue'
import type { SketchDoc, EntityId } from '~/lib/sketch/model'
import { addPoint, addLine, addCircle, addConstraint } from '~/lib/sketch/edit'
import { snapPoint, inferCircleTangents } from '~/lib/sketch/infer'
import { solve, type DragTarget } from '~/lib/sketch/solve'
import { sketchPathData } from '~/lib/sketch/sketchPath'
import { dist } from '~/lib/sketch/geom'

type Tool = 'select' | 'point' | 'line' | 'circle'

const doc = ref<SketchDoc>({ entities: [], constraints: [] })
const tool = ref<Tool>('select')
const status = ref('ready')
const ready = ref(false)

// world→screen: 34px/unit, origin lower-left of a 680x460 board
const S = 34, OX = 40, OY = 400
const sx = (x: number) => OX + x * S
const sy = (y: number) => OY - y * S
const wx = (px: number) => (px - OX) / S
const wy = (py: number) => (OY - py) / S

// in-progress multi-click draws
type Pending =
  | { kind: 'line'; p1: EntityId }
  | { kind: 'circle'; center: EntityId; cx: number; cy: number }
  | null
const pending = ref<Pending>(null)

function runSolve(drag?: DragTarget) {
  const res = solve(doc.value, { maxIter: 120, drag })
  status.value = res.converged ? `solved · ${doc.value.entities.length} ent · ${doc.value.constraints.length} con` : `NOT converged (${res.residualNorm.toFixed(2)})`
  return res
}

// place a point, honoring a snap: reuse the snapped point (coincident) or create
// a new point and the on-line/on-circle constraint the snap implies.
function placePoint(x: number, y: number, exclude: EntityId[] = []): EntityId {
  const snapped = snapPoint(doc.value, x, y, { exclude })
  if (snapped.snap?.kind === 'coincident') return snapped.snap.targetId
  const id = addPoint(doc.value, snapped.x, snapped.y)
  if (snapped.snap?.kind === 'pointOnLine') addConstraint(doc.value, 'pointOnLine', [id, snapped.snap.targetId])
  else if (snapped.snap?.kind === 'pointOnCircle') addConstraint(doc.value, 'pointOnCircle', [id, snapped.snap.targetId])
  return id
}

// the current tool's action at world (x,y)
function place(x: number, y: number) {
  if (tool.value === 'point') {
    placePoint(x, y)
    runSolve()
  } else if (tool.value === 'line') {
    if (!pending.value || pending.value.kind !== 'line') {
      const p1 = placePoint(x, y)
      pending.value = { kind: 'line', p1 }
    } else {
      const p2 = placePoint(x, y, [pending.value.p1])
      if (p2 !== pending.value.p1) addLine(doc.value, pending.value.p1, p2)
      pending.value = null
      runSolve()
    }
  } else if (tool.value === 'circle') {
    if (!pending.value || pending.value.kind !== 'circle') {
      const center = placePoint(x, y)
      const c = doc.value.entities.find(e => e.id === center) as any
      pending.value = { kind: 'circle', center, cx: c.x, cy: c.y }
    } else {
      const r = Math.max(0.2, dist({ x, y }, { x: pending.value.cx, y: pending.value.cy }))
      const cid = addCircle(doc.value, pending.value.center, r)
      // auto-capture tangency to existing geometry
      for (const t of inferCircleTangents(doc.value, pending.value.cx, pending.value.cy, r, { exclude: [cid] })) {
        addConstraint(doc.value, t.kind, t.kind === 'tangentLineCircle' ? [t.targetId, cid] : [cid, t.targetId])
      }
      pending.value = null
      runSolve()
    }
  }
  // 'select' does nothing on empty-space click
}

// rendering: remap to screen via a shadow doc (points scaled, radii * S)
const pathScreen = computed(() => {
  const d = doc.value
  const shadow: SketchDoc = {
    entities: d.entities.map(e => e.kind === 'point'
      ? { ...e, x: sx(e.x), y: sy(e.y) }
      : e.kind === 'circle' ? { ...e, r: e.r * S } : { ...e }),
    constraints: [],
  }
  return sketchPathData(shadow)
})
const pts = computed(() => doc.value.entities.filter(e => e.kind === 'point') as any[])

// pointer handling
let dragId: EntityId | null = null
function svgXY(ev: PointerEvent) {
  const r = (ev.currentTarget as SVGSVGElement).getBoundingClientRect()
  return { x: wx(ev.clientX - r.left), y: wy(ev.clientY - r.top) }
}
function onPointerDownPoint(id: EntityId, ev: PointerEvent) {
  if (tool.value === 'select') { dragId = id; ev.stopPropagation() }
}
function onPointerDownSvg(ev: PointerEvent) {
  if (tool.value === 'select') return
  const { x, y } = svgXY(ev)
  place(x, y)
}
function onPointerMove(ev: PointerEvent) {
  if (!dragId) return
  const { x, y } = svgXY(ev)
  runSolve({ point: dragId, x, y })
}
function onPointerUp() { dragId = null }

function reset() { doc.value = { entities: [], constraints: [] }; pending.value = null; status.value = 'ready' }

onMounted(() => {
  ;(window as any).__sketchDraw = {
    get doc() { return doc.value },
    get tool() { return tool.value },
    get selection() { return [] as string[] },
    status: () => status.value,
    pathData: () => sketchPathData(doc.value),
    entityCount: () => doc.value.entities.length,
    constraintCount: () => doc.value.constraints.length,
    setTool: (t: Tool) => { tool.value = t; pending.value = null },
    reset,
    place: (x: number, y: number) => place(x, y),
    drag: (id: EntityId, x: number, y: number) => runSolve({ point: id, x, y }),
  }
  ready.value = true
})
</script>

<template>
  <div :data-ready="ready ? '' : undefined" style="font-family: ui-sans-serif, system-ui; padding: 12px; color: #e5e5e5; background: #0b0b0b; min-height: 100vh">
    <h1 style="font-size: 14px; margin: 0 0 8px">Sketch Draw</h1>
    <div style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center">
      <button v-for="t in (['select','point','line','circle'] as Tool[])" :key="t"
              :data-tool="t" @click="() => { tool = t; pending = null }"
              :style="{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #333', cursor: 'pointer',
                        background: tool === t ? '#2563eb' : '#1a1a1a', color: '#fff' }">{{ t }}</button>
      <button data-act="reset" @click="reset" style="padding: 4px 10px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer">reset</button>
      <span data-status style="margin-left: 8px; font-size: 12px; color: #9ca3af">{{ status }}</span>
    </div>
    <svg width="680" height="460" style="background: #fafafa; border-radius: 8px; touch-action: none; cursor: crosshair"
         @pointerdown="onPointerDownSvg" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointerleave="onPointerUp">
      <path :d="pathScreen" fill="none" stroke="#3730a3" stroke-width="1.5" />
      <circle v-for="p in pts" :key="p.id" :cx="sx(p.x)" :cy="sy(p.y)" :r="6"
              :fill="p.fixed ? '#9ca3af' : '#2563eb'"
              :style="{ cursor: tool === 'select' ? 'grab' : 'crosshair' }"
              @pointerdown="(e) => onPointerDownPoint(p.id, e)" :data-point="p.id" />
    </svg>
    <p style="font-size: 12px; color: #6b7280; margin-top: 8px">
      Pick a tool. Point/Line/Circle click to place (snaps to nearby geometry). Select drags points; the drawing re-solves.
    </p>
  </div>
</template>
```

- [ ] **Step 2: Eyeball in the Browser pane**

Find the live dev-server port (`for p in 3000 3001 3002 3003 3004; do curl -s -o /dev/null -w "$p:%{http_code}\n" http://127.0.0.1:$p/dev/sketch-draw --max-time 3; done` — the 200 one). Open `/dev/sketch-draw`. Select **circle**, click a center then click to set radius. Select **line**, draw a line under it so the circle sits tangent. Switch to **select**, drag a line endpoint — the circle should ride the line. Do NOT start/stop any dev server.

- [ ] **Step 3: Write the E2E**

```ts
// tests/sketch-draw.spec.ts
import { test, expect } from '@playwright/test'

test('draw a line and a tangent circle via the API, then drag keeps it solved', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    // draw a horizontal-ish line: two clicks
    D.setTool('line'); D.place(1, 2); D.place(12, 2)
    // draw a circle whose radius lands it tangent to that line:
    // center at (6,5), then a radius click 3 below → r≈3, bottom touches y=2 line
    D.setTool('circle'); D.place(6, 5); D.place(6, 2)
  })

  const info = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    return { ents: D.entityCount(), cons: D.constraintCount(), doc: D.doc }
  })
  // line(1) + its 2 pts + circle(1) + its center pt = 5 entities; at least the tangent constraint exists
  expect(info.ents).toBeGreaterThanOrEqual(5)
  expect(info.cons).toBeGreaterThanOrEqual(1)

  // perpendicular distance from the circle's center to the line == radius (tangent)
  const perp = () => page.evaluate(() => {
    const d = (window as any).__sketchDraw.doc
    const line = d.entities.find((e: any) => e.kind === 'line')
    const circle = d.entities.find((e: any) => e.kind === 'circle')
    const P = (id: string) => d.entities.find((e: any) => e.id === id)
    const a = P(line.p1), b = P(line.p2), c = P(circle.center)
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy)
    return { perp: Math.abs((dx * (c.y - a.y) - dy * (c.x - a.x)) / L), r: circle.r }
  })
  const before = await perp()
  expect(Math.abs(before.perp - before.r)).toBeLessThan(0.05)

  // drag the second line endpoint; tangency must survive
  await page.evaluate(() => {
    const d = (window as any).__sketchDraw.doc
    const line = d.entities.find((e: any) => e.kind === 'line')
    ;(window as any).__sketchDraw.drag(line.p2, 12, 6)
  })
  const after = await perp()
  expect(after.perp).toBeCloseTo(after.r, 1)
})
```

- [ ] **Step 4: Run the E2E**

Find the live port; run `PW_BASE_URL=http://127.0.0.1:<port> npx playwright test sketch-draw --project=chromium` from `frontend/`. Expected: 1 passed. If it can't LOAD (server/tree mismatch), report DONE_WITH_CONCERNS (controller verifies live). If it LOADS but the invariant fails, report BLOCKED with numbers — do not weaken assertions.

- [ ] **Step 5: Commit**

```bash
git add app/pages/dev/sketch-draw.vue tests/sketch-draw.spec.ts
git commit -m "feat(sketch): drawing surface — point/line/circle tools with snapping + drag-solve"
```

---

### Task 5: Selection + constraint verbs + delete

Add the select-and-constrain model: click entities to select, a context-sensitive constraint bar applies verbs (Coincident, Tangent, Concentric, Horizontal, Vertical, Fix, Radius=, Distance=, PointOn…), and Delete removes selection. Extends the page and the exposed API.

**Files:**
- Modify: `app/pages/dev/sketch-draw.vue`
- Modify: `tests/sketch-draw.spec.ts` (add a second test)

**Interfaces:**
- Extends `window.__sketchDraw` with: `pick(id: EntityId)` (toggle-select), `clearSel()`, `apply(kind: ConstraintKind, value?: number)` (apply to current selection, then solve + clear), `del()` (delete selected entities + solve), and `get selection()` returns the live selected-id array.
- `availableConstraints(): { kind: ConstraintKind; label: string; value?: boolean }[]` — the verbs valid for the current selection (drives the bar and lets the E2E assert context-sensitivity).

- [ ] **Step 1: Add selection state + verb logic to the page**

Add to `<script setup>` (after `pending`):

```ts
import type { ConstraintKind } from '~/lib/sketch/model'
import { deleteEntity } from '~/lib/sketch/edit'

const selection = ref<EntityId[]>([])
function pick(id: EntityId) {
  const i = selection.value.indexOf(id)
  if (i >= 0) selection.value.splice(i, 1)
  else selection.value.push(id)
}
function clearSel() { selection.value = [] }

function selKinds(): string[] {
  return selection.value.map(id => doc.value.entities.find(e => e.id === id)?.kind ?? '?')
}

// which verbs apply to the current selection (order = display order)
function availableConstraints(): { kind: ConstraintKind; label: string; value?: boolean }[] {
  const ids = selection.value
  const kinds = selKinds()
  const out: { kind: ConstraintKind; label: string; value?: boolean }[] = []
  const count = (k: string) => kinds.filter(x => x === k).length
  if (ids.length === 2 && count('point') === 2) {
    out.push({ kind: 'coincident', label: 'Coincident' }, { kind: 'distance', label: 'Distance…', value: true })
  }
  if (ids.length === 2 && count('circle') === 2) {
    out.push({ kind: 'concentric', label: 'Concentric' }, { kind: 'tangentCircleCircle', label: 'Tangent' })
  }
  if (ids.length === 2 && count('line') === 1 && count('circle') === 1) {
    out.push({ kind: 'tangentLineCircle', label: 'Tangent' })
  }
  if (ids.length === 2 && count('point') === 1 && count('line') === 1) {
    out.push({ kind: 'pointOnLine', label: 'Point on line' })
  }
  if (ids.length === 2 && count('point') === 1 && count('circle') === 1) {
    out.push({ kind: 'pointOnCircle', label: 'Point on circle' })
  }
  if (ids.length === 1 && count('line') === 1) {
    out.push({ kind: 'horizontal', label: 'Horizontal' }, { kind: 'vertical', label: 'Vertical' })
  }
  if (ids.length === 1 && count('circle') === 1) {
    out.push({ kind: 'radius', label: 'Radius…', value: true })
  }
  return out
}

// refs order per kind (matches residuals.ts contract)
function orderRefs(kind: ConstraintKind, ids: EntityId[]): EntityId[] {
  const ent = (id: EntityId) => doc.value.entities.find(e => e.id === id)!
  if (kind === 'tangentLineCircle' || kind === 'pointOnLine') {
    // [line|point-then-line]: for tangentLineCircle → [line, circle]; for pointOnLine → [point, line]
    if (kind === 'tangentLineCircle') return ids.slice().sort(a => (ent(a).kind === 'line' ? -1 : 1))
    return ids.slice().sort(a => (ent(a).kind === 'point' ? -1 : 1))
  }
  if (kind === 'pointOnCircle') return ids.slice().sort(a => (ent(a).kind === 'point' ? -1 : 1))
  return ids.slice()
}

function apply(kind: ConstraintKind, value?: number) {
  const refs = orderRefs(kind, selection.value)
  addConstraint(doc.value, kind, refs, value)
  clearSel()
  runSolve()
}

function del() {
  for (const id of [...selection.value]) deleteEntity(doc.value, id)
  clearSel()
  runSolve()
}
```

- [ ] **Step 2: Wire selection into pointer handling + template**

Change `onPointerDownPoint` so Select-clicking a point toggles selection when not starting a drag — replace the existing function with:

```ts
function onPointerDownPoint(id: EntityId, ev: PointerEvent) {
  if (tool.value === 'select') { dragId = id; ev.stopPropagation() }
}
function onPointerUpPoint(id: EntityId, ev: PointerEvent) {
  // a click without a drag toggles selection
  if (tool.value === 'select' && dragId === id) { pick(id); ev.stopPropagation() }
}
```

Add entity-selection for lines/circles by rendering invisible hit paths. In the template, before the point handles, add clickable outlines and a constraint bar. Add to the toolbar row (after the status span) nothing; instead add a new bar below the svg:

```html
<div style="display: flex; gap: 6px; margin: 8px 0; min-height: 28px; align-items: center">
  <span style="font-size: 12px; color: #9ca3af">sel: {{ selection.length }}</span>
  <button v-for="v in availableConstraints()" :key="v.kind" :data-verb="v.kind"
          @click="() => v.value ? apply(v.kind, Number(prompt(v.label + ' value?', '3')) || undefined) : apply(v.kind)"
          style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">{{ v.label }}</button>
  <button v-if="selection.length" data-verb="fix" @click="() => { for (const id of selection) { const e = doc.entities.find(x => x.id === id); if (e && e.kind === 'point') (e as any).fixed = true } clearSel(); runSolve() }"
          style="padding: 3px 9px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 12px">Fix</button>
  <button v-if="selection.length" data-act="delete" @click="del"
          style="padding: 3px 9px; border-radius: 6px; border: 1px solid #7f1d1d; background: #1a1a1a; color: #fca5a5; cursor: pointer; font-size: 12px">Delete</button>
</div>
```

In the svg, make lines/circles pickable with transparent wide hit strokes rendered per entity (add before the point `<circle>` handles):

```html
<template v-for="e in doc.entities" :key="'hit-' + e.id">
  <path v-if="e.kind !== 'point'" :d="entityPathScreen(e.id)" fill="none" stroke="transparent" stroke-width="12"
        :style="{ cursor: 'pointer' }" @pointerdown="(ev) => { if (tool==='select') { pick(e.id); ev.stopPropagation() } }" :data-ent="e.id" />
  <path v-if="e.kind !== 'point' && selection.includes(e.id)" :d="entityPathScreen(e.id)" fill="none" stroke="#f59e0b" stroke-width="2.5" pointer-events="none" />
</template>
```

Add the per-entity screen path helper + update the point handle to show selection + call the up handler:

```ts
import { entityPath } from '~/lib/sketch/sketchPath'
function entityPathScreen(id: EntityId): string {
  const d = doc.value
  const shadow: SketchDoc = {
    entities: d.entities.map(e => e.kind === 'point' ? { ...e, x: sx(e.x), y: sy(e.y) } : e.kind === 'circle' ? { ...e, r: e.r * S } : { ...e }),
    constraints: [],
  }
  return entityPath(shadow, id)
}
```

Update the point `<circle>` in the template to reflect selection and handle click-up:

```html
<circle v-for="p in pts" :key="p.id" :cx="sx(p.x)" :cy="sy(p.y)" :r="6"
        :fill="selection.includes(p.id) ? '#f59e0b' : (p.fixed ? '#9ca3af' : '#2563eb')"
        :style="{ cursor: tool === 'select' ? 'grab' : 'crosshair' }"
        @pointerdown="(e) => onPointerDownPoint(p.id, e)" @pointerup="(e) => onPointerUpPoint(p.id, e)" :data-point="p.id" />
```

Extend the exposed API in `onMounted`:

```ts
    get selection() { return selection.value.slice() },
    pick: (id: EntityId) => pick(id),
    clearSel: () => clearSel(),
    apply: (kind: ConstraintKind, value?: number) => apply(kind, value),
    del: () => del(),
    availableConstraints: () => availableConstraints(),
```

(Replace the placeholder `get selection() { return [] }` line from Task 4 with the real one above.)

- [ ] **Step 3: Add the E2E for constraints**

Append to `tests/sketch-draw.spec.ts`:

```ts
test('select two circles and apply concentric via the API', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('circle'); D.place(3, 5); D.place(3, 7)   // circle A, center (3,5)
    D.setTool('circle'); D.place(9, 5); D.place(9, 6)   // circle B, center (9,5) elsewhere
  })

  // select both circles, assert 'concentric' is an available verb, apply it
  const verbs = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    const circles = D.doc.entities.filter((e: any) => e.kind === 'circle')
    D.clearSel(); D.pick(circles[0].id); D.pick(circles[1].id)
    return D.availableConstraints().map((v: any) => v.kind)
  })
  expect(verbs).toContain('concentric')

  await page.evaluate(() => (window as any).__sketchDraw.apply('concentric'))

  const centers = await page.evaluate(() => {
    const d = (window as any).__sketchDraw.doc
    const cs = d.entities.filter((e: any) => e.kind === 'circle')
    const C = (id: string) => d.entities.find((e: any) => e.id === id)
    return cs.map((c: any) => C(c.center))
  })
  // concentric ⇒ the two centers coincide
  expect(Math.hypot(centers[0].x - centers[1].x, centers[0].y - centers[1].y)).toBeLessThan(0.01)
})
```

- [ ] **Step 4: Run both E2E tests**

Find the live port; `PW_BASE_URL=http://127.0.0.1:<port> npx playwright test sketch-draw --project=chromium`. Expected: 2 passed. Same load-vs-logic reporting rule as Task 4.

- [ ] **Step 5: Commit**

```bash
git add app/pages/dev/sketch-draw.vue tests/sketch-draw.spec.ts
git commit -m "feat(sketch): selection + context-sensitive constraint verbs + delete"
```

---

### Task 6: Visual layer — constraint badges + dimension chips

Make the constraints visible on the drawing (the Opacity feel): a small glyph near each constrained entity, and a value chip for radius/distance. Read-only rendering — no new logic, no solving.

**Files:**
- Modify: `app/pages/dev/sketch-draw.vue`
- Create: `app/lib/sketch/annotate.ts` (pure: where to place each badge/chip)
- Test: `tests/unit/sketch-annotate.unit.spec.ts`

**Interfaces:**
- Produces (`annotate.ts`): `constraintMarks(doc: SketchDoc): { id: EntityId; kind: ConstraintKind; glyph: string; x: number; y: number; text?: string }[]` — one mark per constraint, positioned in WORLD coords near its primary entity, with a short glyph (e.g. `⊥`-style ascii is fine: `tangent`→`T`, `coincident`→`=`, `concentric`→`◎`, `horizontal`→`H`, `vertical`→`V`, `pointOnLine`→`—`, `pointOnCircle`→`o`, `distance`→`↔` with `text` = value, `radius`→`R` with `text` = value). A mark whose refs don't resolve is skipped.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-annotate.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintMarks } from '~/lib/sketch/annotate'

const doc: SketchDoc = {
  entities: [
    { id: 'a', kind: 'point', x: 0, y: 0 },
    { id: 'b', kind: 'point', x: 10, y: 0 },
    { id: 'L', kind: 'line', p1: 'a', p2: 'b' },
    { id: 'cc', kind: 'point', x: 5, y: 3 },
    { id: 'C', kind: 'circle', center: 'cc', r: 3 },
  ],
  constraints: [
    { id: 'k1', kind: 'tangentLineCircle', refs: ['L', 'C'] },
    { id: 'k2', kind: 'radius', refs: ['C'], value: 3 },
    { id: 'k3', kind: 'horizontal', refs: ['L'] },
    { id: 'k4', kind: 'coincident', refs: ['a', 'GONE'] }, // dangling → skipped
  ],
}

describe('constraintMarks', () => {
  it('emits one positioned mark per resolvable constraint', () => {
    const marks = constraintMarks(doc)
    expect(marks.map(m => m.id)).toEqual(['k1', 'k2', 'k3']) // k4 skipped
    const tan = marks.find(m => m.id === 'k1')!
    expect(tan.glyph).toBe('T')
    expect(Number.isFinite(tan.x) && Number.isFinite(tan.y)).toBe(true)
    const rad = marks.find(m => m.id === 'k2')!
    expect(rad.glyph).toBe('R')
    expect(rad.text).toBe('3')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- sketch-annotate`
Expected: FAIL — cannot resolve `~/lib/sketch/annotate`.

- [ ] **Step 3: Write `annotate.ts`**

```ts
// app/lib/sketch/annotate.ts
import type { SketchDoc, SketchConstraint, EntityId, ConstraintKind } from './model'
import { getEntity, getPoint, lineEndpoints, circleCenter } from './model'
import type { Vec2 } from './geom'

export interface ConstraintMark { id: EntityId; kind: ConstraintKind; glyph: string; x: number; y: number; text?: string }

const GLYPH: Record<ConstraintKind, string> = {
  tangentLineCircle: 'T', tangentCircleCircle: 'T', coincident: '=', concentric: '◎',
  horizontal: 'H', vertical: 'V', pointOnLine: '—', pointOnCircle: 'o', distance: '↔', radius: 'R',
}

// a representative world point to anchor the badge near, for the first resolvable ref
function anchor(doc: SketchDoc, c: SketchConstraint): Vec2 | null {
  for (const ref of c.refs) {
    const e = getEntity(doc, ref)
    if (!e) continue
    if (e.kind === 'point') return { x: e.x, y: e.y }
    if (e.kind === 'line') { const ep = lineEndpoints(doc, e); if (ep) return { x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 } }
    if (e.kind === 'circle') { const cen = circleCenter(doc, e); if (cen) return { x: cen.x + e.r, y: cen.y } }
  }
  return null
}

export function constraintMarks(doc: SketchDoc): ConstraintMark[] {
  const out: ConstraintMark[] = []
  for (const c of doc.constraints) {
    // require every ref to resolve, matching residuals' skip behavior
    if (!c.refs.every(r => getEntity(doc, r))) continue
    const at = anchor(doc, c)
    if (!at) continue
    out.push({ id: c.id, kind: c.kind, glyph: GLYPH[c.kind], x: at.x, y: at.y, ...(c.value != null ? { text: String(c.value) } : {}) })
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- sketch-annotate`
Expected: PASS (1 test).

- [ ] **Step 5: Render the marks on the page**

In `sketch-draw.vue`, import and render. Add to `<script setup>`:

```ts
import { constraintMarks } from '~/lib/sketch/annotate'
const marks = computed(() => constraintMarks(doc.value))
```

In the template, after the point handles (last children of the `<svg>`), add:

```html
<g v-for="m in marks" :key="m.id" pointer-events="none">
  <rect :x="sx(m.x) + 6" :y="sy(m.y) - 16" :width="m.text ? 30 : 16" height="14" rx="3" fill="#111827" opacity="0.85" />
  <text :x="sx(m.x) + 9" :y="sy(m.y) - 5" fill="#e5e7eb" font-size="10" font-family="ui-monospace, monospace">{{ m.glyph }}{{ m.text ? ' ' + m.text : '' }}</text>
</g>
```

- [ ] **Step 6: Verify badges render (DOM check via Browser pane)**

Find the live port, open `/dev/sketch-draw`, and via the console (javascript_tool) build a tangent circle + line and assert badge `<text>` elements exist:

```js
const D = window.__sketchDraw; D.reset();
D.setTool('line'); D.place(1,2); D.place(12,2);
D.setTool('circle'); D.place(6,5); D.place(6,2);
// after Vue paints, there should be at least one badge <text> containing 'T'
[...document.querySelectorAll('svg text')].map(t => t.textContent)
```

Expected: an array including a `T` badge (tangent). Note it in the report.

- [ ] **Step 7: Commit**

```bash
git add app/lib/sketch/annotate.ts tests/unit/sketch-annotate.unit.spec.ts app/pages/dev/sketch-draw.vue
git commit -m "feat(sketch): constraint badges + dimension chips on the drawing surface"
```

---

### Task 7: Phase close-out

- [ ] **Step 1: Full sketch unit suite**

Run: `npm run test:unit -- sketch`
Expected: PASS — Phase 1 (6 files) + Phase 2 (edit, infer, merge, annotate = 4 files), plus any parallel `sketch-*` specs. No failures in our files.

- [ ] **Step 2: Controller live-verification**

In the Browser pane, drive `window.__sketchDraw` through: draw two tangent circles + a line, apply a constraint, drag, confirm invariants hold (forced-sync via the API, per the paused-rAF lesson). Record the numbers.

- [ ] **Step 3: Update STATE.md**

Add a "Sketch drawing surface — Phase 2 (standalone) LANDED" entry near the Phase 1 entry: tools + snapping + verbs + badges on `/dev/sketch-draw`; still NOT in Shape Studio (deliberate — mount is the next decision).

- [ ] **Step 4: Update memory**

Extend `sketch-constraint-solver-phase1-landed.md` (or add a Phase 2 memory) noting: `edit.ts`/`ids.ts`/`infer.ts`/`merge.ts`/`annotate.ts` added; `/dev/sketch-draw` is the drawing surface; snapping captures on-line/on-circle/coincident, circle-finish captures tangency; verbs are context-sensitive by selection; Shape Studio mount still owed. Update the `MEMORY.md` pointer.

- [ ] **Step 5: Final commit** (controller stages explicitly — never `git add -A`)

```bash
git add docs/STATE.md
git commit -m "docs(sketch): STATE entry for Phase 2 drawing surface"
```

---

## Self-Review

**Spec coverage (Phase 2 = spec's "Phase 3 interaction polish", built standalone):**
- Draw-time inference (snap on-line/on-circle/coincident; tangency on circle finish) → Task 2 + wired in Task 4. ✓
- Selection verbs (coincident, tangent, concentric, horizontal, vertical, point-on, radius, distance, fix) → Task 5. ✓
- Persistent constraint badges + dimension chips → Task 6. ✓
- Authoring + cascade delete + tolerant validator → Tasks 1, 3. ✓
- Construction geometry, freeform bezier, agent verbs, curvature comb, and the **Shape Studio mount** → deferred (later phases), stated in Global Constraints. Not gaps.

**Placeholder scan:** every code step is complete. The Task 4 `get selection() { return [] }` placeholder is explicitly replaced in Task 5 Step 2. ✓

**Type consistency:** `EntityId`, `ConstraintKind`, `SketchDoc` used identically; `addConstraint(doc, kind, refs, value?)`, `deleteEntity(doc, id)`, `snapPoint(doc,x,y,opts)→{x,y,snap}`, `inferCircleTangents(...)→TangentInfer[]`, `mergeSketchDoc(raw)→SketchDoc`, `constraintMarks(doc)→ConstraintMark[]`, `window.__sketchDraw` API surface consistent across tasks. `orderRefs` respects the residuals refs-order contract from Phase 1 (tangentLineCircle=[line,circle]; pointOnLine/pointOnCircle=[point,entity]). ✓
