# Sketch Freeform Bezier Pen (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The classic pen on `/dev/sketch-draw`: click = corner anchor, click-drag = smooth anchor with symmetric handles; drag anchors/handles live-solved; a `collinear` "smooth" rule keeps curves kink-free; anchors snap to existing geometry. Exit test: draw a smooth closed blob, drag a handle and an anchor, the curve stays smooth; snap an anchor onto a circle and it sticks through solves.

**Architecture:** The model already reserves `cubic` segments (`h1`/`h2` handle point ids) and the `collinear` rule — M2 fills them in: `sketchPath` renders `C` segments; `edit.addPath` handles cubic auto-rules; the page's pen tool creates handles on click-drag and renders handle arms. No new constraint kinds, no new entities.

**Tech Stack:** unchanged. No new dependencies.

## Global Constraints

- All M1 global constraints apply verbatim (no paper/three; deterministic; solve only on interaction; staging discipline — NEVER `git add -A`; shared `lib/sketch/` dir; find the live dev port by curl probe, never start/stop servers; full sketch suite green after every task).
- **Handles are `point` entities**, marked `construction: true` so they never render in exports and never receive snap targets' constraints. A cubic segment's `h1` = outgoing handle of its start anchor, `h2` = incoming handle of its end anchor; `null` = that side is straight (control point collapses to the anchor).
- **Smooth rule:** `collinear` refs `[h_in, anchor, h_out]` — added automatically when BOTH handles exist at an anchor drawn as smooth; removable like any rule (that converts the anchor to a cusp).
- **Cubic rendering:** `C c1x c1y c2x c2y x y` where c1 = h1's coords (or the start anchor's when h1 null), c2 = h2's coords (or the end anchor's). Pure point reads — the y-flip shadow transform needs NO special casing for cubics (unlike arc sweep).
- Pen gesture state machine: pointerdown places the anchor (snapped); if the pointer MOVES > a threshold (0.15 world units) before pointerup, the anchor is smooth — the out-handle follows the drag position and the in-handle mirrors it through the anchor; pointerup commits. Click on the first anchor closes; the existing `finish`/`close` buttons still work.

All paths relative to `frontend/`.

---

### Task 1: Cubic rendering in sketchPath

**Files:**
- Modify: `app/lib/sketch/sketchPath.ts`
- Test: `tests/unit/sketch-cubic-render.unit.spec.ts`

**Interfaces:** `pathD` renders `cubic` segments as `C` per the Global Constraints (null handle → control point = adjacent anchor). Dangling handle id (non-null but unresolvable) → treat as null (straight side), not ''.

- [ ] **Step 1: Failing test**

```ts
// tests/unit/sketch-cubic-render.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { entityPath } from '~/lib/sketch/sketchPath'

function doc(): SketchDoc {
  return {
    entities: [
      { id: 'a', kind: 'point', x: 0, y: 0 },
      { id: 'b', kind: 'point', x: 10, y: 0 },
      { id: 'ha', kind: 'point', x: 2, y: 3, construction: true },   // out-handle of a
      { id: 'hb', kind: 'point', x: 8, y: 3, construction: true },   // in-handle of b
      { id: 'P', kind: 'path', anchors: ['a', 'b'], segments: [{ kind: 'cubic', h1: 'ha', h2: 'hb' }], closed: false },
    ],
    constraints: [],
  }
}

describe('cubic rendering', () => {
  it('emits C with both handle coords', () => {
    expect(entityPath(doc(), 'P')).toBe('M 0 0 C 2 3 8 3 10 0')
  })
  it('null h1 collapses the first control point onto the start anchor', () => {
    const d = doc()
    ;(d.entities.find(e => e.id === 'P') as any).segments = [{ kind: 'cubic', h1: null, h2: 'hb' }]
    expect(entityPath(d, 'P')).toBe('M 0 0 C 0 0 8 3 10 0')
  })
  it('dangling handle id degrades to a straight side, not empty output', () => {
    const d = doc()
    ;(d.entities.find(e => e.id === 'P') as any).segments = [{ kind: 'cubic', h1: 'GONE', h2: 'hb' }]
    expect(entityPath(d, 'P')).toBe('M 0 0 C 0 0 8 3 10 0')
  })
})
```

- [ ] **Step 2:** Run `npm run test:unit -- sketch-cubic-render` → FAIL (cubic currently emits `L`).

- [ ] **Step 3:** In `pathD`, replace the `else` (line/cubic) branch with:

```ts
    } else if (seg.kind === 'cubic') {
      const h1 = seg.h1 ? getPoint(doc, seg.h1) : undefined
      const h2 = seg.h2 ? getPoint(doc, seg.h2) : undefined
      const c1 = h1 ?? from
      const c2 = h2 ?? to
      d += ` C ${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(to.x)} ${num(to.y)}`
    } else {
      d += ` L ${num(to.x)} ${num(to.y)}`
    }
```

- [ ] **Step 4:** Run → PASS (3). Full `npm run test:unit -- sketch` green (the M1 render test that pinned cubic→`L` must be UPDATED if it exists — check `sketch-path-render.unit.spec.ts`; if it asserts cubic-as-line, update that one assertion to the new `C` behavior and say so in the report).

- [ ] **Step 5:** Commit:
```bash
git add app/lib/sketch/sketchPath.ts tests/unit/sketch-cubic-render.unit.spec.ts
git commit -m "feat(sketch): cubic bezier segment rendering"
```
(If `sketch-path-render.unit.spec.ts` needed the one-assertion update, stage it too and mention it in the commit body.)

---

### Task 2: Pen authoring in edit — smooth anchors + handle helpers

**Files:**
- Modify: `app/lib/sketch/edit.ts`
- Test: `tests/unit/sketch-pen-edit.unit.spec.ts`

**Interfaces:**
- `addSmoothHandles(doc, anchor: EntityId, hx: number, hy: number): { hOut: EntityId; hIn: EntityId }` — creates two construction points: `hOut` at (hx,hy) and `hIn` mirrored through the anchor (2·anchor − h), plus the `collinear` rule `[hIn, anchor, hOut]`. Returns both ids.
- `setAnchorSmooth(doc, path: EntityId, anchorIndex: number): boolean` — for an EXISTING anchor of a path: if the two adjacent segments exist, ensure both sides have handles (create at 1/3 of each adjacent chord if missing, wiring them into the segments' h1/h2) and add the collinear rule if absent. Returns success.
- `pointClosure` (already exported) must include cubic handles — verify it does (M1 wrote that branch); if the guard skips nulls correctly nothing changes.

- [ ] **Step 1: Failing test**

```ts
// tests/unit/sketch-pen-edit.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { addPoint, addPath, addSmoothHandles, setAnchorSmooth } from '~/lib/sketch/edit'
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
```

- [ ] **Step 2:** Run `npm run test:unit -- sketch-pen-edit` → FAIL.

- [ ] **Step 3: Implement in `edit.ts`**

```ts
export function addSmoothHandles(doc: SketchDoc, anchor: EntityId, hx: number, hy: number): { hOut: EntityId; hIn: EntityId } {
  const a = getPoint(doc, anchor)!
  const hOut = addPoint(doc, hx, hy, { construction: true })
  const hIn = addPoint(doc, 2 * a.x - hx, 2 * a.y - hy, { construction: true })
  addConstraint(doc, 'collinear', [hIn, anchor, hOut])
  return { hOut, hIn }
}

export function setAnchorSmooth(doc: SketchDoc, pathId: EntityId, anchorIndex: number): boolean {
  const p = getEntity(doc, pathId)
  if (!p || p.kind !== 'path') return false
  const n = p.anchors.length
  const segCount = p.closed ? n : n - 1
  const inSeg = p.closed ? (anchorIndex - 1 + segCount) % segCount : anchorIndex - 1
  const outSeg = anchorIndex
  if (inSeg < 0 || inSeg >= segCount || outSeg >= segCount) return false  // endpoint of an open path
  const anchor = getPoint(doc, p.anchors[anchorIndex]!)
  if (!anchor) return false

  const third = (fromId: EntityId, toId: EntityId) => {
    const f = getPoint(doc, fromId)!, t = getPoint(doc, toId)!
    return { x: f.x + (t.x - f.x) / 3, y: f.y + (t.y - f.y) / 3 }
  }
  const upgrade = (si: number): void => {
    const s = p.segments[si]!
    if (s.kind !== 'cubic') p.segments[si] = { kind: 'cubic', h1: null, h2: null }
  }
  upgrade(inSeg); upgrade(outSeg)
  const sIn = p.segments[inSeg]! as { kind: 'cubic'; h1: EntityId | null; h2: EntityId | null }
  const sOut = p.segments[outSeg]! as { kind: 'cubic'; h1: EntityId | null; h2: EntityId | null }

  if (!sIn.h2) {
    const prev = p.anchors[inSeg]!  // start anchor of the incoming segment
    const pos = third(p.anchors[anchorIndex]!, prev)
    sIn.h2 = addPoint(doc, pos.x, pos.y, { construction: true })
  }
  if (!sOut.h1) {
    const next = p.anchors[(anchorIndex + 1) % n]!
    const pos = third(p.anchors[anchorIndex]!, next)
    sOut.h1 = addPoint(doc, pos.x, pos.y, { construction: true })
  }
  const already = doc.constraints.some(c => c.kind === 'collinear' && c.refs[1] === p.anchors[anchorIndex])
  if (!already) addConstraint(doc, 'collinear', [sIn.h2, p.anchors[anchorIndex]!, sOut.h1])
  return true
}
```

- [ ] **Step 4:** Run → PASS (3). Full sketch suite green.

- [ ] **Step 5:** Commit:
```bash
git add app/lib/sketch/edit.ts tests/unit/sketch-pen-edit.unit.spec.ts
git commit -m "feat(sketch): smooth-anchor authoring — mirrored handles + collinear rule"
```

---

### Task 3: The pen tool on the page

**Files:**
- Modify: `app/pages/dev/sketch-draw.vue`
- Modify: `tests/sketch-draw.spec.ts` (append the blob E2E)

**Interfaces (window.__sketchDraw additions):**
- `setTool('pen')` — pen gesture per Global Constraints: `penDown(x,y)` → places the (snapped) anchor and begins; `penMove(x,y)` while down → beyond 0.15 world units marks smooth and previews the out-handle at the pointer; `penUp(x,y)` → commits (smooth: creates handles via `addSmoothHandles` and wires them into the adjacent cubic segments; corner: nothing extra). Segments between pen anchors are ALWAYS `cubic` (h ids null for corner sides). Click on first anchor closes (via `finishPath(true)`), buttons still work.
- Handle rendering: when an anchor of the pending or a selected path has handles, draw thin lines anchor→handle and small hollow-dot handle grips; handles drag with the existing select-drag machinery (they're points — but construction points are currently NOT in `pts` since that computed filters `kind === 'point'` without construction exclusion — verify: handles MUST be draggable, so `pts` should include construction points but render them as smaller hollow dots).
- Pen-drawn anchors participate in snapping exactly like path-tool anchors.

Implementation notes (follow the existing page patterns exactly):
- Add `'pen'` to the Tool union + button. Reuse `pendingPath` (segments pushed as `{ kind: 'cubic', h1: <prev anchor's committed hOut or null>, h2: null }`); on committing a smooth anchor, set the JUST-PUSHED segment's `h2` to the new anchor's `hIn` and remember `hOut` for the next segment's `h1`.
- Pen state: `let penDrag: { anchor: EntityId; startX: number; startY: number; smooth: boolean } | null`. Wire pointerdown/move/up on the svg when `tool==='pen'` (pointerdown replaces the click-place; move only while down).
- Rendering: extend the point-handle computed: `const pts = computed(() => doc.value.entities.filter(e => e.kind === 'point') as any[])` stays, but render construction points (`p.construction`) as 4px hollow circles (`fill="none" stroke="#7c3aed"`), and draw arm lines for cubic segments of the pending/selected paths: a computed `handleArms` returning `{x1,y1,x2,y2}[]` in screen space for every cubic h1/h2 of paths that are selected or pending.
- `reset()` and `setTool` clear `penDrag`.

- [ ] **Step 1:** Implement per the notes. Eyeball in the Browser pane (find live port): pen-draw a blob — click, click-drag, click-drag, close on first anchor. Drag a handle: the opposite handle mirrors (collinear rule solves). Drag an anchor: handles ride along.

- [ ] **Step 2: Append the blob E2E**

```ts
// append to tests/sketch-draw.spec.ts
test('pen: smooth blob stays smooth under handle and anchor drags', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('pen')
    // corner anchor, then two smooth anchors (down→move→up), then close
    D.penDown(2, 2); D.penUp(2, 2)                       // corner
    D.penDown(8, 2); D.penMove(9.5, 3); D.penUp(9.5, 3)  // smooth
    D.penDown(6, 7); D.penMove(4.5, 7.5); D.penUp(4.5, 7.5) // smooth
    D.penDown(2, 2); D.penUp(2, 2)                       // click first anchor → close
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    const col = D.doc.constraints.filter((c: any) => c.kind === 'collinear')
    // drag a handle: find the collinear rule of anchor 1 and drag its hOut
    const rule = col[0]
    D.drag(rule.refs[2], 10, 4)
    // smoothness invariant: cross((anchor−hIn),(hOut−hIn)) ≈ 0 for every collinear rule
    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    let maxCross = 0
    for (const c of col) {
      const hi = P(c.refs[0]), an = P(c.refs[1]), ho = P(c.refs[2])
      maxCross = Math.max(maxCross, Math.abs((an.x - hi.x) * (ho.y - hi.y) - (an.y - hi.y) * (ho.x - hi.x)))
    }
    // and an anchor drag keeps it solvable
    const res = D.drag(path.anchors[0], 1.5, 1.5)
    return { closed: path.closed, anchors: path.anchors.length, smoothRules: col.length,
             cubics: path.segments.filter((s: any) => s.kind === 'cubic').length,
             maxCross, converged: res.converged, d: D.pathData() }
  })

  expect(out.closed).toBe(true)
  expect(out.anchors).toBe(3)
  expect(out.smoothRules).toBe(2)
  expect(out.cubics).toBeGreaterThanOrEqual(3)
  expect(out.maxCross).toBeLessThan(0.01)   // smooth after the handle drag
  expect(out.converged).toBe(true)
  expect(out.d).toContain(' C ')            // real bezier output
})
```

- [ ] **Step 3:** Run `PW_BASE_URL=http://127.0.0.1:<live-port> npx playwright test sketch-draw --project=chromium` → 4 passed. Full unit suite green.

- [ ] **Step 4:** Commit:
```bash
git add app/pages/dev/sketch-draw.vue tests/sketch-draw.spec.ts
git commit -m "feat(sketch): freeform pen — corner/smooth anchors, live handles, blob E2E"
```

---

### Task 4: Close-out

- [ ] Full sketch unit suite + all 4 E2E green; record totals.
- [ ] Controller live exit test in the Browser pane (hard-reload first — HMR-stale trap): pen-draw a blob by API, drag handles/anchors, verify smoothness numerically; snap a pen anchor onto a circle and verify the pointOnCircle rule holds through a solve. Perf note: also build the spec's guard-scale doc (~60–80 points via a repeat) and record solve timing/iterations during a drag.
- [ ] Update `docs/STATE.md` (M2 pen landed entry) + memory (pen gesture model, handles-as-construction-points, anything learned) + `MEMORY.md` pointer.
- [ ] Commit docs.

---

## Self-Review

**Spec coverage (M2 slice):** cubic rendering → T1; smooth anchors + collinear + retro-fit smooth → T2; pen gesture + handle rendering/drag + snapping + close → T3; exit test (blob, smooth under drags, snap-to-circle) → T3 E2E + T4 live. Curvature comb explicitly NOT in this program (agreed follow-up). Corner/cusp conversion = removing the collinear rule via existing badge/verb machinery (no new work).

**Placeholder scan:** T3 is implementation-notes style rather than full code (the page diff is large and pattern-following); every algorithmic decision is specified (gesture thresholds, segment wiring, handle mirroring, rendering treatment). All lib code (T1/T2) is complete.

**Type consistency:** `addSmoothHandles`/`setAnchorSmooth` signatures consistent across tasks; cubic `h1`=outgoing-of-start, `h2`=incoming-of-end used identically in edit, sketchPath, and the page wiring; `collinear` refs `[hIn, anchor, hOut]` everywhere.
