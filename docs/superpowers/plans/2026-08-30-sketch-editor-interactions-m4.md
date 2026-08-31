# Sketch Standard Editor Interactions (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make `/dev/sketch-draw` feel like a real tool, not a demo — undo/redo + a keyboard layer, the universal drawing keys (Esc/Enter/Backspace/Delete) + arrow nudge, pan & zoom, editable dimension chips, and standard selection (marquee, click-empty-deselect, shift-add).

**Architecture:** A page-level history stack (deep doc snapshots) with a `commitHistory()` hook every mutating action calls; one window `keydown` handler dispatching shortcuts; reactive viewport (`scale`/`panX`/`panY`) replacing the hardcoded `S`/`OX`/`OY`; clickable dimension chips that pin a `distance` constraint; a marquee drag + selection conventions. Mostly page work; one tiny lib helper for cloning.

**Tech Stack:** unchanged.

## Global Constraints

- All prior sketch global constraints apply (no paper/three in lib/sketch; deterministic; solve only on interaction; staging discipline — NEVER `git add -A`; shared `lib/sketch/` dir untouchable files; find live dev port by curl-probing 3000-3004 for `/dev/sketch-draw`→200, never start/stop servers; full sketch suite green after every task).
- **`vue-tsc` gate:** after each task, run `npx vue-tsc --noEmit 2>&1 | grep -E "sketch"` and confirm NO new sketch errors (the repo has no typecheck in CI — this is how type bugs slipped before). Unrelated repo errors (e.g. `useProjects.ts`) are not ours.
- **History granularity:** one undo entry per discrete user action. A drag is ONE entry (snapshot the doc-state that existed BEFORE the drag, committed on pointer-up). Solver-intermediate states never enter history.
- **`commitHistory()` is the single hook.** Every task that adds a NEW mutating action MUST call it. It is idempotent-safe to call after a no-op (it can diff and skip).
- Keyboard shortcuts must NOT fire when focus is in a text input (guard `document.activeElement` tag), and must `preventDefault` for the ones the browser also binds (⌘Z, arrows, Backspace, Space).

**Existing page facts** (read `app/pages/dev/sketch-draw.vue`): `doc = ref<SketchDoc>`; world↔screen via `const S = 34, OX = 40, OY = 400` and `sx/sy/wx/wy`; mutating actions include `place`/`pathClick`/`pathDown`/`pathUp`/`finishPath`, `apply`, `del`, `doRepeat`/`doMirror`, `flip`, `makeConstruction`, drag (`onPointerMove`→`runSolve({drag})`), the shift-capture, the right-angle verb; `runSolve` already builds a plain-doc clone for solving.

All paths relative to `frontend/`.

---

### Task 1: History core + keyboard layer + undo/redo

**Files:**
- Create: `app/lib/sketch/clone.ts` (pure deep-clone)
- Test: `tests/unit/sketch-clone.unit.spec.ts`
- Modify: `app/pages/dev/sketch-draw.vue` (history stack, keydown handler, undo/redo, commit calls at existing action sites)
- Modify: `tests/sketch-draw.spec.ts` (undo/redo E2E)

**Interfaces:**
- `clone.ts`: `cloneDoc(doc: SketchDoc): SketchDoc` — structural deep clone (entities + their arrays like path `anchors`/`segments`, constraints + `refs`). Pure, no reactivity assumptions.
- Page adds `window.__sketchDraw.undo()`, `.redo()`, `.canUndo()`, `.canDown()`→ rename `.canRedo()`.

- [ ] **Step 1: clone test**

```ts
// tests/unit/sketch-clone.unit.spec.ts
import { describe, it, expect } from 'vitest'
import type { SketchDoc } from '~/lib/sketch/model'
import { cloneDoc } from '~/lib/sketch/clone'

describe('cloneDoc', () => {
  it('deep-clones entities, path segments, and constraint refs (no shared refs)', () => {
    const d: SketchDoc = {
      entities: [
        { id: 'a', kind: 'point', x: 1, y: 2 },
        { id: 'P', kind: 'path', anchors: ['a', 'b'], segments: [{ kind: 'arc', center: 'c', sweep: 1 }], closed: false },
      ],
      constraints: [{ id: 'k', kind: 'distance', refs: ['a', 'b'], value: 5 }],
    }
    const c = cloneDoc(d)
    expect(c).toEqual(d)
    c.entities[0]!.id = 'CHANGED'
    ;(c.entities[1] as any).anchors[0] = 'X'
    c.constraints[0]!.refs[0] = 'Y'
    // original untouched
    expect(d.entities[0]!.id).toBe('a')
    expect((d.entities[1] as any).anchors[0]).toBe('a')
    expect(d.constraints[0]!.refs[0]).toBe('a')
  })
})
```

- [ ] **Step 2:** Run `npm run test:unit -- sketch-clone` → FAIL.

- [ ] **Step 3: Write `clone.ts`**

```ts
// app/lib/sketch/clone.ts
import type { SketchDoc, SketchEntity, SketchConstraint } from './model'
export function cloneDoc(doc: SketchDoc): SketchDoc {
  return {
    entities: doc.entities.map(e => {
      if (e.kind === 'path') return { ...e, anchors: [...e.anchors], segments: e.segments.map(s => ({ ...s })) }
      return { ...e }
    }) as SketchEntity[],
    constraints: doc.constraints.map(c => ({ ...c, refs: [...c.refs] })) as SketchConstraint[],
  }
}
```

- [ ] **Step 4:** Run → PASS.

- [ ] **Step 5: Add history + keyboard to the page.** In `<script setup>`:

```ts
import { cloneDoc } from '~/lib/sketch/clone'
const history = ref<SketchDoc[]>([])
const histPtr = ref(-1)
function initHistory() { history.value = [cloneDoc(doc.value)]; histPtr.value = 0 }
function commitHistory() {
  // drop any redo tail, push a fresh snapshot
  history.value = history.value.slice(0, histPtr.value + 1)
  history.value.push(cloneDoc(doc.value))
  histPtr.value = history.value.length - 1
  if (history.value.length > 200) { history.value.shift(); histPtr.value-- }
}
function undo() { if (histPtr.value > 0) { histPtr.value--; doc.value = cloneDoc(history.value[histPtr.value]!); clearSel?.(); status.value = 'undo' } }
function redo() { if (histPtr.value < history.value.length - 1) { histPtr.value++; doc.value = cloneDoc(history.value[histPtr.value]!); clearSel?.(); status.value = 'redo' } }

function onKeydown(ev: KeyboardEvent) {
  const el = document.activeElement
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
  const meta = ev.metaKey || ev.ctrlKey
  if (meta && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); return }
  if (meta && (ev.key.toLowerCase() === 'z' && ev.shiftKey || ev.key.toLowerCase() === 'y')) { ev.preventDefault(); redo(); return }
  // (Task 2 extends this with Esc/Enter/Backspace/Delete/arrows)
}
onMounted(() => { initHistory(); window.addEventListener('keydown', onKeydown) })
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
```

Call `commitHistory()` at the END of every existing mutating action: after `place` completes a placement, after `finishPath`, after `apply`, after `del`, after `doRepeat`/`doMirror`, after `flip`, after `makeConstruction`, after the shift-capture placement, after the right-angle apply, and after a DRAG settles (in the pointer-up handler, once, not per move). `reset()` should call `initHistory()` (fresh baseline). Import `onUnmounted` from vue. Expose `undo`/`redo`/`canUndo: () => histPtr.value > 0`/`canRedo: () => histPtr.value < history.value.length - 1` on `__sketchDraw`.

- [ ] **Step 6: Undo/redo E2E** (append to `tests/sketch-draw.spec.ts`)

```ts
test('undo/redo restores and reapplies drawing state', async ({ page }) => {
  await page.goto('/dev/sketch-draw'); await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)
  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('point'); D.place(2, 2); D.place(5, 5)   // two points
    const after2 = D.entityCount()
    D.undo()                                            // remove 2nd point
    const afterUndo = D.entityCount()
    D.redo()                                            // bring it back
    const afterRedo = D.entityCount()
    D.undo(); D.undo()                                  // back to empty (both points gone)
    return { after2, afterUndo, afterRedo, afterTwoUndo: D.entityCount() }
  })
  expect(out.after2).toBe(2)
  expect(out.afterUndo).toBe(1)
  expect(out.afterRedo).toBe(2)
  expect(out.afterTwoUndo).toBe(0)
})
```

- [ ] **Step 7:** Run `npm run test:unit -- sketch` (green) + the E2E (all pass) + the vue-tsc gate. Then **commit**:

```bash
git add app/lib/sketch/clone.ts tests/unit/sketch-clone.unit.spec.ts app/pages/dev/sketch-draw.vue tests/sketch-draw.spec.ts
git commit -m "feat(sketch): undo/redo history + keyboard layer"
```

---

### Task 2: Drawing keys + Delete + arrow nudge

Extend `onKeydown` (from Task 1) with the universal keys. All go through `commitHistory()` where they mutate.

**Files:** Modify `app/pages/dev/sketch-draw.vue` + `tests/sketch-draw.spec.ts`.

**Keys:**
- **Escape** — cancel the in-progress path: if `pendingPath` (or pen state) is active, clear it AND delete the pending-only anchors that aren't referenced by a committed entity (reuse the existing pending-cleanup logic used on tool-switch). No history entry (nothing committed).
- **Enter** — if a `pendingPath` with ≥2 anchors is active, `finishPath(false)`.
- **Backspace/Delete** — if a `pendingPath` is active, remove the LAST placed anchor + its trailing segment (step back one); if the path drops below 2 anchors, cancel it. If NO pending path and there IS a selection, `del()` (delete selection). Guard: don't let the browser navigate back.
- **Arrow keys** — nudge every selected POINT (and the point-closure of selected lines/circles/paths) by a small world delta (e.g. 0.25 units; Shift+arrow = 2.5 units); then `runSolve()` and `commitHistory()`. `preventDefault`.

**Interfaces:** expose `__sketchDraw` test hooks: `cancelPath()`, `removeLastAnchor()`, `nudge(dx, dy)` (world units) so the E2E is deterministic (each mirrors the real key path).

- [ ] **Step 1:** Implement the key handlers + the three test hooks. Reuse `pointClosure` (exported from edit.ts) for nudge target expansion.
- [ ] **Step 2: E2E** (append): (a) start a path (2 anchors placed), `removeLastAnchor()` → pending has 1 anchor; `cancelPath()` → no path entity, entity count back to baseline. (b) place a point, select it, `nudge(1, 0)` → the point moved by +1 in x; `undo()` → moved back. Assert positions/counts.
- [ ] **Step 3:** Run unit + E2E + vue-tsc gate; all green. **Commit**: `feat(sketch): drawing keys (Esc/Enter/Backspace), Delete, arrow-nudge`
  Staging: `git add app/pages/dev/sketch-draw.vue tests/sketch-draw.spec.ts`.

---

### Task 3: Pan & zoom

Replace the fixed `S`/`OX`/`OY` with reactive viewport state; wheel-zoom toward the cursor; drag-pan; fit/reset.

**Files:** Modify `app/pages/dev/sketch-draw.vue` + `tests/sketch-draw.spec.ts`.

**Design:**
- `const scale = ref(34); const panX = ref(40); const panY = ref(400)`. Rewrite `sx = x => panX.value + x*scale.value`, `sy = y => panY.value - y*scale.value`, `wx = px => (px - panX.value)/scale.value`, `wy = py => (panY.value - py)/scale.value`. EVERY existing consumer already calls sx/sy/wx/wy, so they flow — audit for any place using the literal `S`/`OX`/`OY` constants and switch them to the refs.
- **Wheel zoom**: on `wheel` over the svg, `ev.preventDefault()`; zoom factor `f = ev.deltaY < 0 ? 1.1 : 1/1.1`; keep the world point under the cursor fixed: compute world `w = (wx(cx), wy(cy))` before, set `scale *= f` (clamp e.g. [4, 400]), then adjust `panX/panY` so `sx(w.x)===cx, sy(w.y)===cy`.
- **Pan**: hold **Space** (track via keydown/keyup on the existing handler → a `spaceHeld` ref) and drag on the canvas → pan (`panX += dxpixels; panY += dypixels`); OR middle-mouse drag (`ev.button === 1`). While `spaceHeld`, the cursor shows `grab`/`grabbing` and pointer-down does NOT place/select.
- **Fit/reset**: `⌘0` (or a "fit" button) resets scale/pan to defaults (or fits content bbox). Add to the keydown handler.
- Viewport changes DON'T mutate the doc → NO `commitHistory()` for pan/zoom (they're view, not model). Undo must not undo a zoom.
- The `S`-based radius chip / handle sizing (`r=6` handles, `S`-scaled shadow radii) must use `scale.value` where they scaled by `S`.

**Interfaces:** expose `__sketchDraw`: `zoomAt(px, py, factor)`, `panBy(dxPx, dyPx)`, `fitView()`, `getViewport() => {scale, panX, panY}` for deterministic tests.

- [ ] **Step 1:** Implement. Carefully audit every `S`/`OX`/`OY` usage (grep) and route through the refs; keep the shadow-doc transforms correct (they scale circle radius by `scale`).
- [ ] **Step 2: E2E**: `getViewport()` initial; `zoomAt(center, center, 2)` → scale doubled AND the world point under center unchanged (read a placed point's screen pos before/after — it should stay under the same screen pixel if it was at the zoom center; simpler: assert `wx/wy` round-trip holds and scale changed); `panBy(50, 0)` → panX increased by 50; `fitView()` → back to default. Also assert drawing still works after a zoom (place a point via world coords, it lands correctly).
- [ ] **Step 3:** unit + E2E + vue-tsc gate green; live sanity (controller). **Commit**: `feat(sketch): pan & zoom (wheel-to-cursor, space-drag, fit)`
  Staging: `git add app/pages/dev/sketch-draw.vue tests/sketch-draw.spec.ts`.

---

### Task 4: Editable dimension chips

Make the radius (and distance) chips clickable → type an exact value → pin it as a constraint.

**Files:** Modify `app/pages/dev/sketch-draw.vue` + `tests/sketch-draw.spec.ts`.

**Design:**
- The arc radius chips (from `arcDimensionMarks`) currently render `pointer-events="none"`. Make them clickable (`pointer-events: auto`, cursor pointer). On click, read the current radius, prompt via a `<script setup>` method using `window.prompt` (the established pattern — NEVER a bare template global), and if a finite value is entered, **pin the radius**: add a `distance` constraint between the arc's center point and its start anchor with that value (`addConstraint(doc, 'distance', [centerId, startAnchorId], value)`) — because radius = |center − startAnchor|, this pins it. Then `runSolve()` + `commitHistory()`. If a distance/radius pin already exists for that pair, UPDATE its value instead of adding a duplicate.
- Existing constraint dimension chips (`distance`/`radius` with a `value`, rendered by `constraintMarks`) should ALSO be click-to-edit: clicking updates the constraint's `value`, then solve + commit.
- Keep the chips readable; clicking a chip should not also trigger canvas placement (stopPropagation).

**Interfaces:** expose `__sketchDraw`: `setArcRadius(pathId, segIndex, value)` and `setConstraintValue(constraintId, value)` test hooks mirroring the click paths.

- [ ] **Step 1:** Implement clickable chips + the two set-value paths + hooks.
- [ ] **Step 2: E2E**: draw an arc (path tool bow), `setArcRadius(path, 1, 4)` → a `distance` constraint (center,startAnchor)=4 exists and the actual radius solves to ≈4; drag an endpoint → radius stays ≈4 (pinned). Then `setArcRadius(...)` again to 2 → updates in place (no duplicate constraint), radius ≈2.
- [ ] **Step 3:** green + vue-tsc gate; live check. **Commit**: `feat(sketch): editable dimension chips — click to pin an exact radius/length`
  Staging: `git add app/pages/dev/sketch-draw.vue tests/sketch-draw.spec.ts`.

---

### Task 5: Better selection

Marquee box-select, click-empty-to-deselect, Shift+click to add (plain click replaces).

**Files:** Modify `app/pages/dev/sketch-draw.vue` + `tests/sketch-draw.spec.ts`.

**Design:**
- **Click-empty deselect**: in select mode, a pointer-down on empty canvas (not on a point/entity, and not the start of a marquee-with-movement) clears the selection.
- **Shift+click semantics**: currently `pick()` toggles on every click. Change: plain click on an entity = REPLACE selection with just it (unless it's a drag-start); **Shift+click** = ADD/toggle that entity in the selection. (Keep drag-to-move working: pointer-down on a selected point still starts a drag.)
- **Marquee**: in select mode, pointer-down on empty canvas + drag = draw a selection rectangle (screen-space overlay `<rect>`); on pointer-up, select every entity whose representative point(s) fall inside the world-rect (points inside; lines/circles/paths if any anchor/center inside — keep simple: an entity is selected if ALL its closure points are inside, or ANY — pick ANY for a forgiving feel). Shift+marquee adds to the existing selection.
- Selection changes are NOT model mutations → NO `commitHistory()`.

**Interfaces:** expose `__sketchDraw`: `marqueeSelect(x0,y0,x1,y1, additive?)` (world rect), and ensure `pick(id, additive?)` supports an additive flag; `clearSel()` exists.

- [ ] **Step 1:** Implement marquee drag + click-empty-deselect + shift-add. Be careful not to break: point-drag-to-move, the constraint-verb selection flows, and the path/line/circle tools (marquee only in `select` tool).
- [ ] **Step 2: E2E**: place 3 points spread out; `marqueeSelect` a rect covering 2 of them → selection has those 2; `clearSel`; click-empty (simulate) deselects; shift-add builds a multi-selection. Assert `selection` contents.
- [ ] **Step 3:** green + vue-tsc gate; live check (marquee visibly draws a box). **Commit**: `feat(sketch): marquee select, click-empty-deselect, shift-click add`
  Staging: `git add app/pages/dev/sketch-draw.vue tests/sketch-draw.spec.ts`.

---

### Task 6: Close-out

- [ ] Full sketch unit suite + all E2E green; vue-tsc gate clean for all sketch files; record totals.
- [ ] Controller live exit test (Browser pane, hard-reload): draw something, ⌘Z/⌘⇧Z, Esc/Enter/Backspace while drawing, arrow-nudge, wheel-zoom + space-pan, click an R chip to set a value, marquee-select two things. Confirm each behaves.
- [ ] Update `docs/STATE.md` (M4 entry: standard editor interactions) + memory (`opacity-pen-interaction-reference.md`: move undo/pan-zoom/editable-chips/marquee from MISSING to HAVE) + `MEMORY.md` pointer.
- [ ] Commit docs.

---

## Self-Review

**Spec coverage:** undo/redo + keyboard core → T1; drawing keys + delete + nudge → T2; pan/zoom → T3; editable chips → T4; selection (marquee/deselect/shift-add) → T5. All four user-selected batches covered. Type-a-dimension-while-drawing (Fusion) and grid/alignment-guides/badge-remove/copy-paste are NOT in this plan (future).

**Placeholder scan:** T1 has full code; T2–T5 are behavioral specs + hooks + E2E (page-integration tasks, matching the successful M1–M3 style — every algorithm and hook is specified). No TBDs.

**Type consistency:** `cloneDoc(doc)`, `commitHistory()`/`undo()`/`redo()`, reactive `scale/panX/panY` behind `sx/sy/wx/wy`, radius-pin via `distance[center,startAnchor,value]`, `pick(id, additive?)`, `marqueeSelect(...)` — consistent across tasks. Viewport changes never call `commitHistory()`; every model mutation does.
