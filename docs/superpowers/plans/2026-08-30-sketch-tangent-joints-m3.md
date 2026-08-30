# Sketch Tangent-at-Joints (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Arcs chain **tangent-continuous** at shared joints while drawing — bow an arc off the previous segment and it snaps to flow smoothly (no kink), with a tangent chip, persisted as a constraint so it stays smooth through edits. This is the top feel-backlog item (the flowing-curve magic from the Opacity videos). Ships on `/dev/sketch-draw`, path tool.

**Architecture:** Two new residual kinds (`perpendicular`, `parallel` — also the missing Fusion verbs) enable line↔arc tangency; arc↔arc reuses `collinear`. A pure `tangentJointArc` helper in `infer.ts` decides free-arc vs snapped-tangent-arc during the drag. The page's drag-to-arc gesture consults it, shows a chip, and persists the joint constraint on commit.

**Tech Stack:** unchanged. No new dependencies.

## Global Constraints

- All prior sketch global constraints apply (no paper/three in lib/sketch; deterministic; solve only on interaction; staging discipline — NEVER `git add -A`; shared `lib/sketch/` dir untouchable files `sketchIntent.ts`/`sketchPadPrompt.ts`/`sketchPile.ts`; find the live dev port by curl-probing 3000-3004 for `/dev/sketch-draw`→200, NEVER start/stop servers; full sketch suite green after every task).
- **New residual refs orders (verbatim):** `perpendicular`=[a,b,c,d] → `dot(b−a, d−c)` (direction a→b ⊥ direction c→d); `parallel`=[a,b,c,d] → `cross(b−a, d−c)` (a→b ∥ c→d). Both take 4 point refs; degenerate (either direction near-zero-length) → contribute nothing (null), never NaN.
- **Tangent-joint constraint choice (page):** previous segment is an ARC (center Cprev) → `collinear[Cprev, J, Cnew]` (radii align at the joint J); previous segment is a LINE (endpoints La,Lb) → `perpendicular[La, Lb, J, Cnew]` (line ⊥ radius at J). J = the shared anchor; Cnew = the new arc's center point.
- HMR-stale trap: hard-reload the page before any live verification after a lib edit.

All paths relative to `frontend/`.

---

### Task 1: `perpendicular` + `parallel` residuals

**Files:**
- Modify: `app/lib/sketch/model.ts` (extend `ConstraintKind`)
- Modify: `app/lib/sketch/merge.ts` (register the two kinds)
- Modify: `app/lib/sketch/residuals.ts` (two new cases)
- Test: `tests/unit/sketch-perp-parallel.unit.spec.ts`

**Interfaces:** `ConstraintKind` gains `| 'perpendicular' | 'parallel'`. Neither needs a `value`. `constraintResiduals` unchanged in signature.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-perp-parallel.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { constraintResiduals } from '~/lib/sketch/residuals'
import { mergeSketchDoc } from '~/lib/sketch/merge'

function d(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 4, y: 0 },   // a→b points +x
      { id: 'c', kind: 'point', x: 1, y: 1 },
      { id: 'e', kind: 'point', x: 1, y: 5 },    // c→e points +y  (⊥ to a→b)
      { id: 'f', kind: 'point', x: 3, y: 3 },    // c→f points +x (∥ a→b)
    ],
    constraints: [],
  }
}

describe('perpendicular / parallel residuals', () => {
  it('perpendicular residual is the dot of the two directions', () => {
    const doc = d()
    // a→b = (4,0); c→e = (0,4) → dot 0 (perpendicular)
    doc.constraints = [{ id: 'k', kind: 'perpendicular', refs: ['a', 'b', 'c', 'e'] }]
    expect(constraintResiduals(doc)).toEqual([0])
    // a→b = (4,0); c→f = (2,2) → dot 8 (not perpendicular)
    doc.constraints = [{ id: 'k', kind: 'perpendicular', refs: ['a', 'b', 'c', 'f'] }]
    expect(constraintResiduals(doc)).toEqual([8])
  })
  it('parallel residual is the cross of the two directions', () => {
    const doc = d()
    // a→b = (4,0); c→f = (2,2) → cross 4*2 − 0*2 = 8 (not parallel)
    doc.constraints = [{ id: 'k', kind: 'parallel', refs: ['a', 'b', 'c', 'f'] }]
    expect(constraintResiduals(doc)).toEqual([8])
    // move f so c→f = (2,0), parallel to (4,0) → cross 0
    ;(doc.entities.find(e => e.id === 'f') as any).y = 1  // c=(1,1), f=(3,1) → c→f=(2,0)
    expect(constraintResiduals(doc)).toEqual([0])
  })
  it('degenerate direction (zero length) contributes nothing', () => {
    const doc = d()
    ;(doc.entities.find(e => e.id === 'b') as any).x = 0 // a==b → a→b zero length
    doc.constraints = [{ id: 'k', kind: 'perpendicular', refs: ['a', 'b', 'c', 'e'] }]
    expect(constraintResiduals(doc)).toEqual([])
  })
  it('merge accepts the new kinds', () => {
    const m = mergeSketchDoc({
      entities: [{ id: 'a', kind: 'point', x: 0, y: 0 }, { id: 'b', kind: 'point', x: 1, y: 0 }, { id: 'c', kind: 'point', x: 0, y: 0 }, { id: 'e', kind: 'point', x: 0, y: 1 }],
      constraints: [
        { id: 'k1', kind: 'perpendicular', refs: ['a', 'b', 'c', 'e'] },
        { id: 'k2', kind: 'parallel', refs: ['a', 'b', 'c', 'e'] },
      ],
    })
    expect(m.constraints.map(c => c.kind)).toEqual(['perpendicular', 'parallel'])
  })
})
```

(Final file has 4 tests: perpendicular, parallel, degenerate-skip, merge.)

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit -- sketch-perp-parallel` → FAIL (unknown kinds → empty residuals).

- [ ] **Step 3: Extend `model.ts`** — add `| 'perpendicular' | 'parallel'` to `ConstraintKind`.

- [ ] **Step 4: Extend `merge.ts`** — add `'perpendicular', 'parallel'` to `CONSTRAINT_KINDS`.

- [ ] **Step 5: Add the two cases to `residualsFor` in `residuals.ts`**

```ts
    case 'perpendicular': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!)
      const p = getPoint(doc, c.refs[2]!); const q = getPoint(doc, c.refs[3]!)
      if (!a || !b || !p || !q) return null
      const ux = b.x - a.x, uy = b.y - a.y, vx = q.x - p.x, vy = q.y - p.y
      if (Math.hypot(ux, uy) < 1e-9 || Math.hypot(vx, vy) < 1e-9) return null
      return [ux * vx + uy * vy]
    }
    case 'parallel': {
      const a = getPoint(doc, c.refs[0]!); const b = getPoint(doc, c.refs[1]!)
      const p = getPoint(doc, c.refs[2]!); const q = getPoint(doc, c.refs[3]!)
      if (!a || !b || !p || !q) return null
      const ux = b.x - a.x, uy = b.y - a.y, vx = q.x - p.x, vy = q.y - p.y
      if (Math.hypot(ux, uy) < 1e-9 || Math.hypot(vx, vy) < 1e-9) return null
      return [ux * vy - uy * vx]
    }
```

- [ ] **Step 6: Run to verify it passes** — `npm run test:unit -- sketch-perp-parallel` → PASS (4). Then `npm run test:unit -- sketch` → all green.

- [ ] **Step 7: Commit**

```bash
git add app/lib/sketch/model.ts app/lib/sketch/merge.ts app/lib/sketch/residuals.ts tests/unit/sketch-perp-parallel.unit.spec.ts
git commit -m "feat(sketch): perpendicular + parallel residuals (Fusion verbs; enable tangent joints)"
```

---

### Task 2: `tangentJointArc` inference helper

**Files:**
- Modify: `app/lib/sketch/infer.ts`
- Test: `tests/unit/sketch-tangent-joint.unit.spec.ts`

**Interfaces:**
- `arcThroughTangent(J: Vec2, end: Vec2, tangentDir: Vec2): { center: Vec2; radius: number } | null` — the unique circular arc passing through `J` and `end`, tangent to line `tangentDir` (undirected) at `J`. Center lies on the perpendicular to `tangentDir` through `J`: `C = J + s·N`, `N = unit ⊥ tangentDir`, `s = |d|² / (2 · N·d)` where `d = end − J`. `null` if `|N·d| < 1e-9` (end lies along the tangent → straight).
- `interface JointArc { center: Vec2; radius: number; sweep: 0 | 1; snappedTangent: boolean }`
- `tangentJointArc(J: Vec2, end: Vec2, pointer: Vec2, tangentDir: Vec2 | null, tolDeg = 12): JointArc | null` — compute the free circumcircle arc through (J, end, pointer); `null` if the three are collinear (caller draws a line). If `tangentDir` given and the free arc's tangent at `J` (= `⊥(J − freeCenter)`) is within `tolDeg` of `tangentDir` (undirected), replace with `arcThroughTangent(J, end, tangentDir)` and set `snappedTangent = true`. Sweep flag computed in doc-coords (matching `sketchPath.ts`): with center `C`, `a0 = atan2(J − C)`, `a1 = atan2(end − C)`, `aQ = atan2(pointer − C)`; `ccw = ((a1−a0) mod 2π + 2π) mod 2π`; `qccw = ((aQ−a0) mod 2π + 2π) mod 2π`; **for the snapped arc use the point `end`'s mirror across the chord as the bulge reference is unnecessary — instead** pick sweep so the arc bulges to the same side as the free arc did (carry the free arc's sweep). Keep it simple: compute sweep from the free arc; reuse it for the snapped arc.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-tangent-joint.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { arcThroughTangent, tangentJointArc } from '~/lib/sketch/infer'

describe('arcThroughTangent', () => {
  it('builds the arc tangent to a horizontal line at J, through end', () => {
    // J=(0,0), tangent horizontal (1,0), end=(0,4) straight up → semicircle bulging in x,
    // center on the vertical (perp to tangent) through J: C=(0,2), R=2
    const r = arcThroughTangent({ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 1, y: 0 })!
    expect(r.center.x).toBeCloseTo(0, 9)
    expect(r.center.y).toBeCloseTo(2, 9)
    expect(r.radius).toBeCloseTo(2, 9)
  })
  it('tangent at J really is tangentDir (radius ⊥ tangent)', () => {
    const J = { x: 1, y: 1 }, end = { x: 5, y: 3 }, T = { x: 1, y: 1 } // 45°
    const r = arcThroughTangent(J, end, T)!
    const radial = { x: J.x - r.center.x, y: J.y - r.center.y }
    expect(radial.x * T.x + radial.y * T.y).toBeCloseTo(0, 6) // radius ⊥ tangent
    // J and end both on the circle
    expect(Math.hypot(J.x - r.center.x, J.y - r.center.y)).toBeCloseTo(r.radius, 6)
    expect(Math.hypot(end.x - r.center.x, end.y - r.center.y)).toBeCloseTo(r.radius, 6)
  })
  it('end along the tangent → null (would be a straight line)', () => {
    expect(arcThroughTangent({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 1, y: 0 })).toBeNull()
  })
})

describe('tangentJointArc', () => {
  it('with no previous tangent, returns the free circumcircle arc', () => {
    const r = tangentJointArc({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 2 }, null)!
    expect(r.snappedTangent).toBe(false)
    // circumcircle of (0,0),(4,0),(2,2): center (2,0), R=2
    expect(r.center.x).toBeCloseTo(2, 6); expect(r.center.y).toBeCloseTo(0, 6)
    expect(r.radius).toBeCloseTo(2, 6)
  })
  it('snaps to tangent when the free drag is near-tangent-continuous', () => {
    // prev tangent horizontal at J=(0,0); pointer chosen so the free arc is ALMOST tangent
    const r = tangentJointArc({ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 0.1, y: 2 }, { x: 1, y: 0 })!
    expect(r.snappedTangent).toBe(true)
    expect(r.center.x).toBeCloseTo(0, 6)  // exact tangent arc center on the perpendicular
    expect(r.center.y).toBeCloseTo(2, 6)
  })
  it('does NOT snap when the free drag is far from tangent', () => {
    const r = tangentJointArc({ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 3, y: 2 }, { x: 1, y: 0 })!
    expect(r.snappedTangent).toBe(false)
  })
  it('collinear free drag → null', () => {
    expect(tangentJointArc({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit -- sketch-tangent-joint` → FAIL.

- [ ] **Step 3: Implement in `infer.ts`** (append; reuse existing `Vec2`, `sub`, `dot`, `len` imports — add any missing)

```ts
export function arcThroughTangent(J: Vec2, end: Vec2, tangentDir: Vec2): { center: Vec2; radius: number } | null {
  const tl = Math.hypot(tangentDir.x, tangentDir.y)
  if (tl < 1e-12) return null
  const tx = tangentDir.x / tl, ty = tangentDir.y / tl
  const nx = -ty, ny = tx                // unit normal to the tangent
  const dx = end.x - J.x, dy = end.y - J.y
  const nd = nx * dx + ny * dy           // N·d
  if (Math.abs(nd) < 1e-9) return null   // end lies along the tangent → straight
  const s = (dx * dx + dy * dy) / (2 * nd)
  const center = { x: J.x + s * nx, y: J.y + s * ny }
  return { center, radius: Math.abs(s) }
}

// circumcircle center of three points (null if collinear)
function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const dcp = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  if (Math.abs(dcp) < 1e-9) return null
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / (2 * dcp)
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / (2 * dcp)
  return { x: ux, y: uy }
}

function sweepFor(J: Vec2, end: Vec2, pointer: Vec2, C: Vec2): 0 | 1 {
  const TAU = Math.PI * 2
  const a0 = Math.atan2(J.y - C.y, J.x - C.x)
  const a1 = Math.atan2(end.y - C.y, end.x - C.x)
  const aQ = Math.atan2(pointer.y - C.y, pointer.x - C.x)
  const ccw = ((a1 - a0) % TAU + TAU) % TAU
  const qccw = ((aQ - a0) % TAU + TAU) % TAU
  return qccw <= ccw ? 1 : 0
}

export interface JointArc { center: Vec2; radius: number; sweep: 0 | 1; snappedTangent: boolean }

export function tangentJointArc(J: Vec2, end: Vec2, pointer: Vec2, tangentDir: Vec2 | null, tolDeg = 12): JointArc | null {
  const freeC = circumcenter(J, end, pointer)
  if (!freeC) return null
  const sweep = sweepFor(J, end, pointer, freeC)
  let center = freeC
  let snappedTangent = false
  if (tangentDir) {
    // free arc's tangent at J is perpendicular to (J − freeC)
    const rx = J.x - freeC.x, ry = J.y - freeC.y            // radial dir
    const ftx = -ry, fty = rx                               // free tangent = ⊥ radial
    const fl = Math.hypot(ftx, fty), tl = Math.hypot(tangentDir.x, tangentDir.y)
    if (fl > 1e-9 && tl > 1e-9) {
      // undirected angle between free tangent and desired tangent
      const cosang = Math.abs((ftx * tangentDir.x + fty * tangentDir.y) / (fl * tl))
      const ang = Math.acos(Math.min(1, cosang)) * 180 / Math.PI
      if (ang <= tolDeg) {
        const snap = arcThroughTangent(J, end, tangentDir)
        if (snap) { center = snap.center; snappedTangent = true }
      }
    }
  }
  const radius = Math.hypot(J.x - center.x, J.y - center.y)
  // recompute sweep for the (possibly moved) center, still biased by the pointer side
  return { center, radius, sweep: sweepFor(J, end, pointer, center), snappedTangent }
}
```

- [ ] **Step 4: Run to verify it passes** — `npm run test:unit -- sketch-tangent-joint` → PASS (7). Full sketch suite green.

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/infer.ts tests/unit/sketch-tangent-joint.unit.spec.ts
git commit -m "feat(sketch): tangentJointArc inference — snap arcs tangent-continuous at joints"
```

---

### Task 3: Wire tangent joints into the drag-to-arc gesture

**Files:**
- Modify: `app/pages/dev/sketch-draw.vue`
- Modify: `tests/sketch-draw.spec.ts` (append)

**Interfaces (page):** the path drag-to-arc gesture (`pathMove`/`pathUp` and the pointer handlers) consults `tangentJointArc` when the segment being bowed shares its start anchor `J` with a previous segment. The page computes `tangentDir` at `J`:
- previous segment is a LINE from `La`→`J`: `tangentDir = J − La`.
- previous segment is an ARC with center `Cprev`: `tangentDir = ⊥(J − Cprev)` (either sign; undirected).
When `snappedTangent` is true: show a **tangent chip** (glyph `T`) near `J` during the drag (reuse the radius-chip rendering pattern), and on `pathUp` commit, after creating the arc + its center `Cnew`, add the joint constraint: `collinear[Cprev, J, Cnew]` (prev arc) or `perpendicular[La, Lb, J, Cnew]` (prev line). Expose nothing new on `__sketchDraw` beyond what exists (the E2E drives `pathDown/pathMove/pathUp`).

Implementation notes:
- The "previous segment" is `pendingPath.segments[last]` if the pending path has ≥1 committed segment, i.e. the arc being drawn is at least the 2nd segment. `J` is the current pending path's last anchor (the start of the new segment); the new anchor is `Pnew` placed on `pathDown`. Determine prev seg kind from `pendingPath.segments[segIndex-1]` (line vs arc) and resolve its geometry from the doc.
- Replace the existing free-arc computation in the path bow path with a call to `tangentJointArc(J, Pnew, pointer, tangentDir)`; use its `center`/`sweep`. When `tangentDir` is null (first segment) behavior is identical to today (free arc).
- The committed arc's center point is created as today; the `equalDist` arc-integrity rule is still added by `addPath` at finish. The joint tangent constraint is added separately at `pathUp` and must reference the SAME center point id.
- Persist across finish: since `addPath` is called at `finishPath` with the accumulated segments, and the joint constraints were added during drawing referencing real point ids, they survive. Verify the tangent constraint's `Cnew` id matches the arc segment's `center` id in the finished path.

- [ ] **Step 1: Implement the wiring per the notes.** Then eyeball in the Browser pane (hard-reload; find live port): draw a line, then bow an arc off its end — as you drag near tangent-continuous, it snaps flush (no kink) and a `T` chip shows at the joint; release; the smoothness holds when you then drag the shared anchor.

- [ ] **Step 2: Append the E2E**

```ts
// append to tests/sketch-draw.spec.ts
test('tangent joint: arc snaps tangent to the previous line and stays smooth', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('path')
    // a horizontal line a→J
    D.pathDown(1, 3); D.pathUp(1, 3)
    D.pathDown(6, 3); D.pathUp(6, 3)              // J = (6,3), segment 0 = line
    // bow an arc off J, dragging near-tangent (pointer slightly above the horizontal)
    D.pathDown(6, 7)                               // Pnew above
    D.pathMove(6.2, 5)                             // near-tangent bulge
    D.pathUp(6.2, 5)
    D.finishPath(false)
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    const perpRule = D.doc.constraints.find((c: any) => c.kind === 'perpendicular')
    // tangent invariant: at J, the line direction ⊥ (arcCenter − J)
    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const arcSeg = path.segments[1]
    const J = P(path.anchors[1]), C = P(arcSeg.center), La = P(path.anchors[0])
    const lineDir = { x: J.x - La.x, y: J.y - La.y }
    const radial = { x: C.x - J.x, y: C.y - J.y }
    const dotBefore = Math.abs(lineDir.x * radial.x + lineDir.y * radial.y)
    // now drag the line's far endpoint; tangency must hold
    D.drag(path.anchors[0], 1, 5)
    const J2 = P(path.anchors[1]), C2 = P(arcSeg.center), La2 = P(path.anchors[0])
    const ld2 = { x: J2.x - La2.x, y: J2.y - La2.y }, rd2 = { x: C2.x - J2.x, y: C2.y - J2.y }
    const dotAfter = Math.abs(ld2.x * rd2.x + ld2.y * rd2.y)
    return { hasPerp: !!perpRule, segKinds: path.segments.map((s: any) => s.kind), dotBefore, dotAfter, d: D.pathData() }
  })

  expect(out.segKinds).toEqual(['line', 'arc'])
  expect(out.hasPerp).toBe(true)                 // tangent joint captured
  expect(out.dotBefore).toBeLessThan(0.01)       // tangent at commit (line ⊥ radius)
  expect(out.dotAfter).toBeLessThan(0.05)        // still tangent after dragging the line
  expect(out.d).toContain(' A ')
})
```

- [ ] **Step 3: Run the E2E** — `PW_BASE_URL=http://127.0.0.1:<port> npx playwright test sketch-draw --project=chromium` → expected 6 passed. Can't-load → DONE_WITH_CONCERNS; invariant fails → BLOCKED with numbers. Full unit suite green.

- [ ] **Step 4: Commit**

```bash
git add app/pages/dev/sketch-draw.vue tests/sketch-draw.spec.ts
git commit -m "feat(sketch): tangent-joint snapping in the drag-to-arc gesture (flowing chains)"
```

---

### Task 4: Close-out

- [ ] Full sketch unit suite + all E2E green; record totals.
- [ ] Controller live exit test (Browser pane, hard-reload): chain line→arc→arc, confirm each joint snaps tangent (chip shows, no kink), then drag a shared anchor and confirm the whole chain flexes while staying smooth. Numeric: joint dot-products ≈ 0.
- [ ] Update `docs/STATE.md` (tangent-joints entry) + memory (`opacity-pen-interaction-reference.md`: move tangent-at-joints from MISSING to HAVE; `sketch-constraint-solver-phase1-landed.md`: note perpendicular/parallel added, tangent-joint design) + `MEMORY.md` pointer if warranted.
- [ ] Commit docs.

---

## Self-Review

**Spec coverage:** tangent-at-joints (the top feel item) via draw-time snap + persisted constraint → Tasks 2/3. Enabling residuals `perpendicular`/`parallel` (also the missing Fusion verbs — bonus roadmap coverage) → Task 1. Arc↔arc joints reuse `collinear` (existing). Analytic Jacobian (mandala-scale perf) and delight cues remain separate next items — NOT in this plan.

**Placeholder scan:** all pure code (T1/T2) complete; T3 is notes+E2E (the page gesture is pattern-following against the existing drag-to-arc code). Note the T1 test has an intentional correction instruction (drop the mis-expected inline `it`).

**Type consistency:** `perpendicular`/`parallel` refs [a,b,c,d] identical across model/merge/residuals/page; `tangentJointArc(J,end,pointer,tangentDir,tolDeg)→JointArc|null` and `arcThroughTangent(J,end,tangentDir)→{center,radius}|null` consistent between infer and page; joint constraint choice (collinear for prev-arc, perpendicular for prev-line) stated once in Global Constraints and applied in Task 3.
