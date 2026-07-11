# Frame Slice 4b — Group / Multi-Selection Proportional Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When 2+ layers are selected (a group selects its members; a marquee selects an ad-hoc set), show a bounding box with corner handles that scales the whole selection PROPORTIONALLY — each child's position and size scale by one uniform factor about the opposite corner (Alt = from center). This completes "full Figma group transform."

**Architecture:** Two pure helpers in a new `frontend/app/lib/compositor/groupResize.ts` — `unionBox` (AABB of the selection) and `scaleLayerAbout` (scale one layer's center + size field about an anchor by factor f) — plus `groupScaleFactor` (diagonal ratio from the drag). The editor adds a `groupResize` drag mode; the modal renders the selection bounding box + 4 corner handles when `selectedIds.size >= 2` (and hides the single-layer handles then). Uniform scale sidesteps the non-uniform-stretch ambiguity for text/line/path — all size kinds scale by the same dimensionless `f`.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest.

## Global Constraints

- Work on `main` — no branches. Stage files explicitly — NEVER `git add -A` (parallel session on `main`). Pre-flight EVERY task; BLOCK on foreign uncommitted changes.
- No new npm deps. Reuse the `Box`/`Handle` types + `resizeBox`'s conventions where noted.
- **Coordinate model (same as Slice 3):** x,w,h are width-fractions; y is a height-fraction. Position math is in isotropic px (`cx=x*W, cy=y*H`); the scale factor `f` is dimensionless so normalized SIZE fields (`w,h,fontSize,scale`) multiply by `f` directly; position converts px→norm (`x=cx/W, y=cy/H`).
- Uniform (proportional) only — corner handles, one factor. NO edge handles on the group box (non-uniform group stretch deferred — it's ambiguous for uniform-size children).
- Unit tests: `cd frontend && npx vitest run tests/unit/<file>`; full suite before each commit. KNOWN pre-existing unrelated failures (note, don't block): gradientfx-mesh, spacetype-palette (×2), video-model-adapt.
- Browser verification by the CONTROLLER on `frontend-sg` (`:3017`, `/dev/frame-lab`) after the tasks land.
- End every commit body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: pure `groupResize` geometry

**Files:**
- Create: `frontend/app/lib/compositor/groupResize.ts`
- Create: `frontend/tests/unit/group-resize.unit.spec.ts`

**Interfaces:**
- Produces: `Box = { cx: number; cy: number; w: number; h: number }` (px; reuse the same shape as resizeBox — re-declare locally or `import type { Box } from './resizeBox'`). `Handle = 'tl'|'tr'|'br'|'bl'`. `unionBox(boxes: Box[]): Box` (AABB union). `cornerOf(box: Box, handle: Handle): {x,y}` (that corner's px point). `anchorOf(box: Box, handle: Handle, fromCenter: boolean): {x,y}` (opposite corner, or center if fromCenter). `groupScaleFactor(anchor: {x,y}, cornerStart: {x,y}, pointerNow: {x,y}, minF?: number): number` (diagonal ratio, clamped). `scaleLayerAbout(layer: LocalLayer, anchor: {x,y}, f: number, W: number, H: number): Partial<LocalLayer>` (new x,y + scaled size field(s) per kind).

- [ ] **Step 1: Write the failing tests (hand-computed)**

```typescript
// frontend/tests/unit/group-resize.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { anchorOf, cornerOf, groupScaleFactor, scaleLayerAbout, unionBox } from '../../app/lib/compositor/groupResize'

describe('unionBox', () => {
  it('AABB of member boxes', () => {
    const u = unionBox([{ cx: 100, cy: 100, w: 40, h: 20 }, { cx: 200, cy: 200, w: 60, h: 40 }])
    // box1 x[80,120] y[90,110]; box2 x[170,230] y[180,220] → union x[80,230] y[90,220]
    expect(u).toEqual({ cx: 155, cy: 155, w: 150, h: 130 })
  })
})

describe('cornerOf / anchorOf', () => {
  const box = { cx: 100, cy: 100, w: 40, h: 20 } // tl(80,90) br(120,110)
  it('cornerOf br = bottom-right', () => { expect(cornerOf(box, 'br')).toEqual({ x: 120, y: 110 }) })
  it('anchorOf br = top-left (opposite)', () => { expect(anchorOf(box, 'br', false)).toEqual({ x: 80, y: 90 }) })
  it('anchorOf with fromCenter = box center', () => { expect(anchorOf(box, 'br', true)).toEqual({ x: 100, y: 100 }) })
})

describe('groupScaleFactor', () => {
  it('diagonal ratio', () => {
    const f = groupScaleFactor({ x: 100, y: 100 }, { x: 300, y: 300 }, { x: 500, y: 500 })
    expect(f).toBeCloseTo(2) // |(400,400)| / |(200,200)|
  })
  it('clamps to minF', () => {
    expect(groupScaleFactor({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 1, y: 1 }, 0.05)).toBeCloseTo(0.05)
  })
})

describe('scaleLayerAbout', () => {
  const W = 1000, H = 800, anchor = { x: 100, y: 100 }, f = 2
  it('scales a rect center-about-anchor + w,h', () => {
    const p = scaleLayerAbout({ id: 'r', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.2, h: 0.1 } as any, anchor, f, W, H)
    // center px (500,400) → 100+(400)*2=900, 100+(300)*2=700 → x0.9 y0.875
    expect(p).toMatchObject({ x: 0.9, y: 0.875, w: 0.4, h: 0.2 })
  })
  it('scales a text fontSize', () => {
    const p = scaleLayerAbout({ id: 't', kind: 'text', x: 0.5, y: 0.5, rotation: 0, opacity: 1, fontSize: 0.06 } as any, anchor, f, W, H)
    expect(p).toMatchObject({ x: 0.9, y: 0.875, fontSize: 0.12 })
  })
  it('scales a line w and a path scale', () => {
    expect(scaleLayerAbout({ id: 'l', kind: 'line', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.2 } as any, anchor, f, W, H)).toMatchObject({ w: 0.4 })
    expect(scaleLayerAbout({ id: 'p', kind: 'path', x: 0.5, y: 0.5, rotation: 0, opacity: 1, scale: 0.5 } as any, anchor, f, W, H)).toMatchObject({ scale: 1 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/group-resize.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// frontend/app/lib/compositor/groupResize.ts
/**
 * Proportional resize for a multi-selection (a group, or an ad-hoc marquee set).
 * One uniform scale factor `f` scales every child's position (about a fixed anchor)
 * and its size. Uniform, so text/line/path (uniform-size kinds) scale cleanly.
 */
import type { LocalLayer } from '~/composables/useCompositorLayers'

export interface Box { cx: number; cy: number; w: number; h: number }
export type Handle = 'tl' | 'tr' | 'br' | 'bl'

/** Axis-aligned union of member boxes (px). */
export function unionBox(boxes: Box[]): Box {
  const xs = boxes.flatMap(b => [b.cx - b.w / 2, b.cx + b.w / 2])
  const ys = boxes.flatMap(b => [b.cy - b.h / 2, b.cy + b.h / 2])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }
}

const SGN: Record<Handle, { sx: number; sy: number }> = {
  tl: { sx: -1, sy: -1 }, tr: { sx: 1, sy: -1 }, br: { sx: 1, sy: 1 }, bl: { sx: -1, sy: 1 },
}

/** The px point of a corner handle. */
export function cornerOf(box: Box, handle: Handle): { x: number; y: number } {
  const { sx, sy } = SGN[handle]
  return { x: box.cx + sx * box.w / 2, y: box.cy + sy * box.h / 2 }
}

/** The fixed anchor: the opposite corner, or the box center when fromCenter (Alt). */
export function anchorOf(box: Box, handle: Handle, fromCenter: boolean): { x: number; y: number } {
  if (fromCenter) return { x: box.cx, y: box.cy }
  const { sx, sy } = SGN[handle]
  return { x: box.cx - sx * box.w / 2, y: box.cy - sy * box.h / 2 }
}

/** Uniform scale factor = distance(pointer,anchor) / distance(cornerStart,anchor). */
export function groupScaleFactor(anchor: { x: number; y: number }, cornerStart: { x: number; y: number }, pointerNow: { x: number; y: number }, minF = 0.05): number {
  const d0 = Math.hypot(cornerStart.x - anchor.x, cornerStart.y - anchor.y)
  const d1 = Math.hypot(pointerNow.x - anchor.x, pointerNow.y - anchor.y)
  if (d0 < 1e-6) return 1
  return Math.max(minF, d1 / d0)
}

/** Scale one layer about `anchor` (px) by `f`: center repositions in px, size fields
 *  multiply by the dimensionless `f`. Returns only the changed fields. */
export function scaleLayerAbout(layer: LocalLayer, anchor: { x: number; y: number }, f: number, W: number, H: number): Partial<LocalLayer> {
  const cx = layer.x * W, cy = layer.y * H
  const nx = anchor.x + (cx - anchor.x) * f
  const ny = anchor.y + (cy - anchor.y) * f
  const patch: Record<string, number> = { x: nx / W, y: ny / H }
  const l = layer as any
  if (l.kind === 'text') patch.fontSize = l.fontSize * f
  else if (l.kind === 'line') patch.w = l.w * f
  else if (l.kind === 'path') patch.scale = l.scale * f
  else { patch.w = l.w * f; patch.h = l.h * f } // rect / ellipse / image
  return patch as Partial<LocalLayer>
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/group-resize.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Full suite + commit**

Run: `cd frontend && npx vitest run tests/unit`

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/groupResize.ts frontend/tests/unit/group-resize.unit.spec.ts
git commit -m "feat(frame): groupResize geometry (union box, scale-about-anchor, factor)"
```

---

### Task 2: `groupResize` drag mode + selection bounding box

**Files:**
- Modify: `frontend/app/composables/useLocalLayerEditor.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: editor gains `selectionBox` (computed: the union `Box` in px when `selectedIds.size >= 2`, else null), `selectionHandles` (computed: the 4 corner px points from `selectionBox`, or null), `startGroupResize(handle: Handle, e: PointerEvent)` (exported), a `groupResize` Drag variant, and an `onMove` branch that scales every selected layer via `scaleLayerAbout`. The `hud` shows the selection box W×H during a group resize.

- [ ] **Step 1: selectionBox + selectionHandles computeds**

Add `import { unionBox, cornerOf, anchorOf, groupScaleFactor, scaleLayerAbout, type Handle as GHandle, type Box as GBox } from '~/lib/compositor/groupResize'`.

```typescript
  /** Union box (px) of the current multi-selection (≥2), else null. */
  const selectionBox = computed<GBox | null>(() => {
    if (selectedIds.value.size < 2) return null
    const W = dims().w, H = dims().h
    const boxes = selectedLayers.value.map((l) => { const b = boxPx(l); return { cx: l.x * W, cy: l.y * H, w: b.w, h: b.h } })
    return boxes.length ? unionBox(boxes) : null
  })
  const selectionHandles = computed(() => {
    const b = selectionBox.value; if (!b) return null
    return { tl: cornerOf(b, 'tl'), tr: cornerOf(b, 'tr'), br: cornerOf(b, 'br'), bl: cornerOf(b, 'bl') }
  })
```

- [ ] **Step 2: Drag variant + startGroupResize**

Add a Drag variant:

```typescript
    | { type: 'groupResize'; handle: GHandle; anchor: { x: number; y: number }; cornerStart: { x: number; y: number }; ids: string[]; start: Record<string, { x: number; y: number; size: Record<string, number> }> }
```

```typescript
  function startGroupResize(handle: GHandle, e: PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    const box = selectionBox.value; const r = getRect(); if (!box || !r) return
    const anchor = anchorOf(box, handle, e.altKey)
    const cornerStart = cornerOf(box, handle)
    // Snapshot each selected layer's start center (px) + size fields so f re-derives from the ORIGINAL each move.
    const W = dims().w, H = dims().h
    const start: Record<string, { x: number; y: number; size: Record<string, number> }> = {}
    for (const l of selectedLayers.value) {
      const s: Record<string, number> = {}
      const ll = l as any
      if (ll.kind === 'text') s.fontSize = ll.fontSize
      else if (ll.kind === 'line') s.w = ll.w
      else if (ll.kind === 'path') s.scale = ll.scale
      else { s.w = ll.w; s.h = ll.h }
      start[l.id] = { x: l.x, y: l.y, size: s }
    }
    recordHistory()
    drag.value = { type: 'groupResize', handle, anchor, cornerStart, ids: selectedLayers.value.map(l => l.id), start }
    attach()
  }
```

- [ ] **Step 3: onMove branch**

`scaleLayerAbout` scales from the layer's CURRENT value, but a live drag must scale from the START. So in the branch, apply the factor to each layer's STORED start values (reconstruct a start-layer for `scaleLayerAbout`). Add to `onMove`:

```typescript
    } else if (d.type === 'resize') {
      // (existing single-layer resize branch — unchanged)
```

then, after it:

```typescript
    } else if (d.type === 'groupResize') {
      const W = dims().w, H = dims().h
      const { nx, ny } = toNorm(e.clientX, e.clientY, r)
      const f = groupScaleFactor(d.anchor, d.cornerStart, { x: nx * W, y: ny * H })
      commit(localLayers.value.map((l) => {
        const s = d.start[l.id]; if (!s) return l
        const startLayer = { ...l, x: s.x, y: s.y, ...s.size } as LocalLayer
        return { ...l, ...scaleLayerAbout(startLayer, d.anchor, f, W, H) } as LocalLayer
      }))
    }
```

- [ ] **Step 4: HUD during group resize**

In the `hud` computed, when `drag.value?.type === 'groupResize'`, show the CURRENT selection box W×H (recompute from selectionBox or the live boxes): map its type to `'scale'` and feed `{ wPx: box.w, hPx: box.h, ... }` using `selectionBox.value`. If simplest, position the HUD at the selection box top-center. (Adapt the existing hud computed; keep single-layer HUD unchanged.)

- [ ] **Step 5: Export**

Add `selectionBox, selectionHandles, startGroupResize` to the returned object.

- [ ] **Step 6: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit` (no unit change beyond Task 1; group-resize is browser-verified). Confirm nothing broke.

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): group/multi-selection proportional resize drag mode"
```

Note: startGroupResize/onMove/HUD are browser-verification-owed.

---

### Task 3: Render the selection bounding box + handles in the modal

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`

**Interfaces:**
- Consumes: Task 2 `selectionBox`, `selectionHandles`, `startGroupResize`.

- [ ] **Step 1: Study the existing single-layer handle render**

Read how the single-layer resize handles + selection box render (the `handlePositions` / `selectedResizable` block from Slice 3, and the single-layer selection outline). Note the handle div classes/size to match.

- [ ] **Step 2: Gate single-layer handles to single selection**

Where the single-layer resize/scale handles render (they key off `selected`/`selectedResizable`), add a guard so they only show when `selectedIds.size <= 1` (a multi-selection uses the group box instead). Destructure `selectionBox, selectionHandles, startGroupResize` + `selectedIds`.

- [ ] **Step 3: Render the selection box + 4 corner handles**

When `selectionBox` is non-null (≥2 selected), render a dashed bounding rectangle at `selectionBox` (left `cx-w/2`, top `cy-h/2`, width `w`, height `h` — in the same artboard overlay px space as the snap guides) and 4 corner handles at `selectionHandles.tl/tr/br/bl`, each `@pointerdown="startGroupResize('<id>', $event)"`, styled to match the single-layer corner handles:

```html
<template v-if="selectionBox">
  <div class="absolute border border-white/70 border-dashed pointer-events-none"
    :style="{ left: (selectionBox.cx - selectionBox.w/2) + 'px', top: (selectionBox.cy - selectionBox.h/2) + 'px', width: selectionBox.w + 'px', height: selectionBox.h + 'px' }" />
  <div v-for="c in (['tl','tr','br','bl'] as const)" :key="'g-'+c" data-handle
    class="absolute size-2.5 -ml-1 -mt-1 bg-white border border-black/40 cursor-nwse-resize"
    :style="{ left: selectionHandles[c].x + 'px', top: selectionHandles[c].y + 'px' }"
    @pointerdown="startGroupResize(c, $event)" />
</template>
```

(Align classes/size to the real single-layer handles in this file so it looks native. Confirm the overlay these sit in uses the same px coordinate space as `selectionBox` — i.e. logical canvas px, matching `handlePositions`.)

- [ ] **Step 4: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit` (confirms nothing broke).

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): render selection bounding box + group resize handles"
```

Note: render + interaction are browser-verification-owed.

---

## Controller browser verification (after Task 3)

On `http://localhost:3017/dev/frame-lab` (viewport ≥ 1280):
1. Shift-click two visible layers on the canvas (or select a group) → a dashed bounding box with 4 corner handles appears (single-layer handles hidden).
2. Drag a corner outward → BOTH layers grow and spread apart proportionally, the opposite corner staying anchored; their relative layout is preserved.
3. Alt+drag a corner → scales from the center of the selection.
4. HUD shows the selection W×H.
Screenshot a mid-group-resize frame (bounding box + both layers scaled) as proof.

## Deferred

- Non-uniform group stretch (edge handles on the group box) — ambiguous for uniform-size children (text/line/path); needs a text-box-width model. Rotating a group as a unit. Group-box rotation handle.

## Self-Review

- **Coverage:** union/anchor/corner/factor/scale-about (Task 1, hand-computed tests) → drag mode + selection box computeds (Task 2) → render + handles (Task 3). The drag/render surfaces are browser-verified.
- **Uniform-only scope:** proportional corner resize; text/line/path scale by the same dimensionless f cleanly; non-uniform stretch deferred (documented).
- **Type consistency:** `Box`/`Handle`, `unionBox`/`cornerOf`/`anchorOf`/`groupScaleFactor`/`scaleLayerAbout`, `selectionBox`/`selectionHandles`/`startGroupResize`, the `groupResize` Drag variant — consistent across tasks. Scale-from-START (snapshot in startGroupResize, reconstruct start-layer in onMove) is the key correctness point.
- **Contention:** Task 1 new file, Task 2 useLocalLayerEditor.ts, Task 3 CompositorModal.vue (shared — dirty-checked, last).
