# Frame Slice 3 — Full Figma Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give rect/ellipse/image layers in the Frame modal true Figma-style resize — mid-edge handles for 1D (width or height) resize, corner drag anchored to the OPPOSITE corner, Shift to constrain aspect, Alt to resize from center — correct for rotated layers.

**Architecture:** The geometry is a single pure function `resizeBox(...)` in a new `frontend/app/lib/compositor/resizeBox.ts` (works in isotropic logical-canvas px, handles rotation via a local-frame transform), exhaustively unit-tested. The editor `useLocalLayerEditor.ts` gains a `resize` drag mode that converts normalized↔px and calls `resizeBox`; the modal renders the edge handles and routes each handle to resize (box layers) or the existing uniform scale (text/line/path). Text/line/path keep today's uniform-from-center corner scale (no 2D box to resize) — an explicit, documented scope boundary.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest.

## Global Constraints

- Work directly on `main` — do NOT create branches. Stage files explicitly — NEVER `git add -A` (a parallel session commits to `main` concurrently). Pre-flight EVERY task with `git status --short <targets>`; BLOCK on foreign uncommitted changes in a target.
- No new npm dependencies. `resizeBox.ts` imports ONLY `import type` (if anything).
- Figma-convention values (verbatim): min layer size = `2` px; Shift constrains aspect on CORNER handles only (edge handles ignore Shift); Alt = resize from center.
- **Coordinate model (critical):** layer `x`,`w`,`h` are fractions of canvas WIDTH; `y` is a fraction of canvas HEIGHT. Convert to isotropic logical px before geometry: `cx=x*W, cy=y*H, wPx=w*W, hPx=h*W` (both dims × W); convert back: `x=cx/W, y=cy/H, w=wPx/W, h=hPx/W`. `boxPx(layer)` already returns `{w,h}` in logical px.
- Unit tests: `cd frontend && npx vitest run tests/unit/<file>`; full suite before each commit. KNOWN pre-existing unrelated failures (note, don't block): gradientfx-mesh, spacetype-palette (×2), video-model-adapt.
- Browser verification done by the CONTROLLER on `frontend-sg` (port 3017, `/dev/frame-lab`) after the tasks land.
- End every commit body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `resizeBox` pure geometry

**Files:**
- Create: `frontend/app/lib/compositor/resizeBox.ts`
- Create: `frontend/tests/unit/resize-box.unit.spec.ts`

**Interfaces:**
- Produces: `Box = { cx: number; cy: number; w: number; h: number }` (px; center + full width/height); `Handle = 'tl'|'t'|'tr'|'l'|'r'|'bl'|'b'|'br'`; `resizeBox(start: Box, rotationDeg: number, handle: Handle, p0: {x,y}, p1: {x,y}, opts?: { aspect?: boolean; fromCenter?: boolean }, minSize?: number): Box`. Pure. p0/p1 are pointer positions (px, same space as cx/cy). Returns the new box.

- [ ] **Step 1: Write the failing tests (hand-computed expectations)**

```typescript
// frontend/tests/unit/resize-box.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { resizeBox } from '../../app/lib/compositor/resizeBox'

const START = { cx: 100, cy: 100, w: 40, h: 20 } // left=80 right=120 top=90 bottom=110

describe('resizeBox — unrotated', () => {
  it('right edge: widens right, left edge fixed, center shifts +x by Δw/2', () => {
    const r = resizeBox(START, 0, 'r', { x: 120, y: 100 }, { x: 130, y: 100 })
    expect(r).toMatchObject({ cx: 105, cy: 100, w: 50, h: 20 })
  })
  it('bottom edge: taller down, center shifts +y', () => {
    const r = resizeBox(START, 0, 'b', { x: 100, y: 110 }, { x: 100, y: 118 })
    expect(r).toMatchObject({ cx: 100, cy: 104, w: 40, h: 28 })
  })
  it('bottom-right corner: both dims grow, opposite (top-left) corner fixed', () => {
    const r = resizeBox(START, 0, 'br', { x: 120, y: 110 }, { x: 130, y: 120 })
    expect(r).toMatchObject({ cx: 105, cy: 105, w: 50, h: 30 })
  })
  it('corner + alt (from center): both edges move, center fixed', () => {
    const r = resizeBox(START, 0, 'br', { x: 120, y: 110 }, { x: 130, y: 120 }, { fromCenter: true })
    expect(r).toMatchObject({ cx: 100, cy: 100, w: 60, h: 40 })
  })
  it('corner + aspect (shift): keeps 2:1 ratio, driven by dominant axis', () => {
    const r = resizeBox(START, 0, 'br', { x: 120, y: 110 }, { x: 130, y: 112 }, { aspect: true })
    // rawW=50, rawH=22 → scale=max(50/40,22/20)=1.25 → w=50,h=25, shift=(5,2.5)
    expect(r).toMatchObject({ cx: 105, cy: 102.5, w: 50, h: 25 })
  })
  it('clamps to min size instead of flipping', () => {
    const r = resizeBox(START, 0, 'r', { x: 120, y: 100 }, { x: 20, y: 100 }, {}, 2)
    expect(r.w).toBe(2)
  })
})

describe('resizeBox — rotated 90°', () => {
  it('right edge with world-down drag maps to local +x (width), center moves world-down', () => {
    const r = resizeBox(START, 90, 'r', { x: 100, y: 100 }, { x: 100, y: 110 })
    // localDelta = rot((0,10),-90) = (10,0) → w=50; localShift=(5,0) → worldShift=rot((5,0),90)=(0,5)
    expect(r.w).toBeCloseTo(50); expect(r.h).toBeCloseTo(20)
    expect(r.cx).toBeCloseTo(100); expect(r.cy).toBeCloseTo(105)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/resize-box.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// frontend/app/lib/compositor/resizeBox.ts
/**
 * Figma-style resize geometry. Works in isotropic logical px. Handles rotation by
 * transforming the pointer delta into the layer's LOCAL frame, resizing there, then
 * mapping the center shift back to world. Pure.
 *
 *   - Edge handle (t/r/b/l): 1D resize, opposite edge fixed (Alt → symmetric).
 *   - Corner handle: 2D resize, opposite corner fixed (Alt → from center;
 *     Shift → constrain to the original aspect ratio).
 * Never flips: dims clamp to `minSize`.
 */
export interface Box { cx: number; cy: number; w: number; h: number }
export type Handle = 'tl' | 't' | 'tr' | 'l' | 'r' | 'bl' | 'b' | 'br'

const DIR: Record<Handle, { sx: number; sy: number }> = {
  tl: { sx: -1, sy: -1 }, t: { sx: 0, sy: -1 }, tr: { sx: 1, sy: -1 },
  l: { sx: -1, sy: 0 }, r: { sx: 1, sy: 0 },
  bl: { sx: -1, sy: 1 }, b: { sx: 0, sy: 1 }, br: { sx: 1, sy: 1 },
}

function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return { x: x * c - y * s, y: x * s + y * c }
}

export function resizeBox(
  start: Box, rotationDeg: number, handle: Handle,
  p0: { x: number; y: number }, p1: { x: number; y: number },
  opts: { aspect?: boolean; fromCenter?: boolean } = {}, minSize = 2,
): Box {
  const { sx, sy } = DIR[handle]
  const d = rot(p1.x - p0.x, p1.y - p0.y, -rotationDeg) // pointer delta in local frame
  const corner = sx !== 0 && sy !== 0
  const clamp = (v: number) => Math.max(minSize, v)
  let w = start.w, h = start.h, shiftLX = 0, shiftLY = 0

  if (opts.fromCenter) {
    if (sx !== 0) w = clamp(start.w + 2 * sx * d.x)
    if (sy !== 0) h = clamp(start.h + 2 * sy * d.y)
    if (opts.aspect && corner) {
      const scale = Math.max(w / start.w, h / start.h)
      w = start.w * scale; h = start.h * scale
    }
    // center fixed → no shift
  } else if (opts.aspect && corner) {
    const scale = Math.max(Math.abs(sx * start.w + d.x) / start.w, Math.abs(sy * start.h + d.y) / start.h)
    w = clamp(start.w * scale); h = clamp(start.h * scale)
    shiftLX = (sx * (w - start.w)) / 2; shiftLY = (sy * (h - start.h)) / 2
  } else {
    if (sx !== 0) w = clamp(start.w + sx * d.x)
    if (sy !== 0) h = clamp(start.h + sy * d.y)
    shiftLX = (sx * (w - start.w)) / 2; shiftLY = (sy * (h - start.h)) / 2
  }

  const world = rot(shiftLX, shiftLY, rotationDeg)
  return { cx: start.cx + world.x, cy: start.cy + world.y, w, h }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/resize-box.unit.spec.ts`
Expected: PASS (all 7). If any rotated/aspect case fails, the expectation is hand-computed and correct — fix the implementation, not the test.

- [ ] **Step 5: Full suite + commit**

Run: `cd frontend && npx vitest run tests/unit`

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/resizeBox.ts frontend/tests/unit/resize-box.unit.spec.ts
git commit -m "feat(frame): resizeBox pure geometry (edge/corner, anchor, aspect, alt, rotation)"
```

---

### Task 2: Edge-handle geometry + resizable-kind helper

**Files:**
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (`boxHandles` → add `t/r/b/l` midpoints; add `resizableKind`)
- Modify: `frontend/tests/unit/agent-compositor-surface.unit.spec.ts` OR a small new spec — see Step 1 (test the pure `resizableKind` + that boxHandles returns the 4 new points)

**Interfaces:**
- Produces: `boxHandles(cx, cy, hw, hh, rotationDeg)` return gains `t`, `r`, `b`, `l` (edge midpoints, rotated like the corners). Exported pure helper `resizableKind(kind: string): boolean` → true for `'rect'|'ellipse'|'image'`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/resize-handles.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { resizableKind } from '../../app/composables/useLocalLayerEditor'

describe('resizableKind', () => {
  it('is true only for box layers (rect/ellipse/image)', () => {
    for (const k of ['rect', 'ellipse', 'image']) expect(resizableKind(k)).toBe(true)
    for (const k of ['text', 'line', 'path']) expect(resizableKind(k)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/resize-handles.unit.spec.ts`
Expected: FAIL — `resizableKind` not exported.

- [ ] **Step 3: Implement**

In `useLocalLayerEditor.ts`, add at module scope (top level, next to the other exported helpers — NOT inside the composable):

```typescript
/** Box layers (independent width+height) get full Figma resize; text/line/path
 *  keep uniform corner scaling (no 2D box to resize). */
export function resizableKind(kind: string): boolean {
  return kind === 'rect' || kind === 'ellipse' || kind === 'image'
}
```

In `boxHandles`, add the four edge midpoints to the returned object (they use the same `t(dx,dy)` rotation helper already there):

```typescript
    return {
      tl: t(-hw, -hh), tr: t(hw, -hh), br: t(hw, hh), bl: t(-hw, hh),
      t: t(0, -hh), r: t(hw, 0), b: t(0, hh), l: t(-hw, 0),
      rot: t(0, -hh - 26), topCenter: t(0, -hh), center: { x: cx, y: cy },
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/resize-handles.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Full suite + commit**

Run: `cd frontend && npx vitest run tests/unit`

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useLocalLayerEditor.ts frontend/tests/unit/resize-handles.unit.spec.ts
git commit -m "feat(frame): edge-handle geometry + resizableKind helper"
```

---

### Task 3: `resize` drag mode in the editor

**Files:**
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (Drag type; `startResize`; `onMove` resize branch; `hud` maps resize→W×H)

**Interfaces:**
- Consumes: Task 1 `resizeBox`/`Handle`/`Box`; Task 2 `resizableKind`.
- Produces: editor gains `startResize(handle: Handle, e: PointerEvent)` (exported). New Drag variant `{ type: 'resize'; id; handle; rot; start: Box; p0: {x,y} }`. `onMove` handles it. The `hud` computed shows `W × H` for a resize drag.

- [ ] **Step 1: Extend the Drag type + add startResize**

Add `import { resizeBox, type Handle, type Box } from '~/lib/compositor/resizeBox'` (top of file). Add a Drag variant:

```typescript
    | { type: 'resize'; id: string; handle: Handle; rot: number; start: Box; p0: { x: number; y: number } }
```

Add `startResize` near `startScale`:

```typescript
  function startResize(handle: Handle, e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const l = selected.value; const r = getRect(); if (!l || !r) return
    const W = dims().w, H = dims().h
    const b = boxPx(l)
    const { nx, ny } = toNorm(e.clientX, e.clientY, r)
    recordHistory()
    drag.value = {
      type: 'resize', id: l.id, handle, rot: l.rotation,
      start: { cx: l.x * W, cy: l.y * H, w: b.w, h: b.h },
      p0: { x: nx * W, y: ny * H },
    }
    attach()
  }
```

- [ ] **Step 2: Handle it in `onMove`**

Add a branch to `onMove` (alongside move/scale/rotate):

```typescript
    } else if (d.type === 'resize') {
      const W = dims().w, H = dims().h
      const { nx, ny } = toNorm(e.clientX, e.clientY, r)
      const box = resizeBox(d.start, d.rot, d.handle, d.p0, { x: nx * W, y: ny * H }, { aspect: e.shiftKey, fromCenter: e.altKey })
      // px → normalized (w,h fractions of WIDTH; x of width, y of height)
      setLocal(d.id, { x: box.cx / W, y: box.cy / H, w: box.w / W, h: box.h / W })
    }
```

- [ ] **Step 3: HUD shows W×H during resize**

In the `hud` computed, treat a resize drag like a scale for the HUD text. Change the `dragHud(d.type, …)` call so a `'resize'` type maps to `'scale'`:

```typescript
    const kind = d.type === 'resize' ? 'scale' : d.type
    const hh = dragHud(kind, { wPx: b.w, hPx: b.h, xPx: l.x * W, yPx: l.y * H, rotation: l.rotation })
```

(Adjust the surrounding lines to use `hh`/`kind`; keep the existing `left`/`top` positioning.)

- [ ] **Step 4: Export `startResize`**

Add `startResize` to the returned object (next to `startScale, startRotate`).

- [ ] **Step 5: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit` (no unit change here beyond earlier tasks; confirms nothing broke — the resize drag is browser-verified). Also `npx vitest run tests/unit/resize-box.unit.spec.ts tests/unit/layer-edits.unit.spec.ts` stay green.

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): resize drag mode wiring (box layers) + HUD W×H"
```

Note in the report: `startResize`/`onMove` resize branch + HUD-during-resize have NO Vue-side unit coverage — controller browser-verifies.

---

### Task 4: Render + route the resize handles in the modal

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (destructure `startResize`, `handlePositions` if not already; render 4 edge handles for box layers; route corner + edge pointerdown to `startResize` for box layers, keep `startScale` for text/line/path)

**Interfaces:**
- Consumes: Task 2's edge positions on `handlePositions`; Task 3's `startResize`; `resizableKind`.

- [ ] **Step 1: Pre-flight + study the current handle rendering**

Run: `cd frontend && git status --short app/components/vue-canvas/CompositorModal.vue` (clean or BLOCK). Then find how corner handles render + wire: `grep -n "startScale\|handlePositions\|data-handle\|handleLocal\|localHandlePositions" app/components/vue-canvas/CompositorModal.vue`. The corner handles are `<div data-handle …>` bound to `handlePositions.tl/tr/br/bl` with `@pointerdown` calling the scale start. Match that pattern exactly for the new handles.

- [ ] **Step 2: Destructure the new API**

Add `startResize` to the editor destructure (the block already pulling `startScale, startRotate, handlePositions`). Import `resizableKind` if referencing it in `<script>`, or compute a `selectedResizable` computed: `const selectedResizable = computed(() => !!selectedLocal.value && resizableKind(selectedLocal.value.kind))` (import `resizableKind` from the composable module).

- [ ] **Step 3: Route corner handles by layer kind**

For the four existing corner handle divs, change the pointerdown so box layers resize (anchored) and others keep uniform scale. Give each corner its handle id:

```html
@pointerdown="selectedResizable ? startResize('tl', $event) : startScale($event)"
```
(and `'tr'`, `'br'`, `'bl'` on the respective corners).

- [ ] **Step 4: Add the four edge handles (box layers only)**

Immediately after the corner handles, add (mirroring the corner divs' classes/size, `data-handle`):

```html
<template v-if="selectedResizable && handlePositions">
  <div v-for="e in (['t','r','b','l'] as const)" :key="e" data-handle
    class="absolute w-2 h-2 -ml-1 -mt-1 bg-white border border-black/40 rounded-sm cursor-pointer"
    :style="{ left: handlePositions[e].x + 'px', top: handlePositions[e].y + 'px' }"
    @pointerdown="startResize(e, $event)" />
</template>
```

(Match the exact handle class/size the corner handles use in THIS file — the snippet above is the shape; align the classes to the existing corner-handle divs so it looks consistent.)

- [ ] **Step 5: Verify (unit) + commit**

Run: `cd frontend && npx vitest run tests/unit` (confirms nothing broke).
Note in the report: rendering + routing are browser-verification-owed.

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): render + route edge/corner resize handles in the modal"
```

---

## Controller browser verification (after Task 4)

On `http://localhost:3017/dev/frame-lab` (viewport ≥ 1280 wide so the artboard is large; add a rect via the toolbar or select an existing box layer — note the fixture is mostly text, so ADD a rectangle first via the square toolbar button):
1. Drag a **corner** of a rect → both dims change, the **opposite corner stays put** (not center).
2. Drag a **mid-edge** handle → only width OR height changes.
3. **Shift**+corner → aspect ratio holds. **Alt**+corner → resizes from center.
4. Rotate the rect ~30°, then resize a corner → still anchors correctly in the rotated frame.
5. HUD shows `W × H` throughout.
Screenshot a mid-resize frame (HUD + handles visible) and a rotated-resize frame as proof.

## Deferred

- Text-box-width edge handles (set `boxW`) + font-size corner scale anchored to the opposite corner — a separate text-resize model.
- Non-uniform path scale (needs `scaleX`/`scaleY` on PathLayer). Resize handles on the inline `ArtifactFrameNode` (this slice is modal-only). Flip-on-cross-anchor.

## Self-Review

- **Coverage:** `resizeBox` (Task 1) carries all geometry with hand-computed tests incl. rotation, aspect, alt, edge, clamp. Tasks 2-4 are handle geometry + wiring + render; the drag/render surfaces are browser-verified (Vue-side, no unit path).
- **No placeholders:** every step has real code + commands. `resizeBox` math is fully specified.
- **Type consistency:** `Box`/`Handle`/`resizeBox`, `resizableKind`, `startResize`, the `resize` Drag variant, and the px↔normalized conversion (`w,h,x` /W; `y` /H) are consistent across tasks.
- **Scope boundary:** text/line/path keep uniform-from-center corner scale (documented); box layers (rect/ellipse/image) get the full treatment.
- **Contention:** geometry + wiring in the new `resizeBox.ts` + `useLocalLayerEditor.ts`; only Task 4 edits the shared `CompositorModal.vue` (last, dirty-checked).
