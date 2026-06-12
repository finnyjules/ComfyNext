# Inpaint Modal Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add result history, mask invert, mask-only view, stroke undo/redo, and zoom/pan to the inpaint editor, plus a controls-panel reorg — without disturbing the proven mask-bake geometry.

**Architecture:** Approach C from the spec. New *pure* logic goes in `app/lib/` and is TDD'd (`brushHistory`, `stageView`). Reactive wrappers live in composables (`useBrushMask` extended; new `useStageView`). The component `InpaintModal.vue` is the shell. Built in three risk-ascending phases: (1) history + invert + mask-only + polish, (2) undo/redo, (3) zoom/pan. Zoom/pan transforms an inner stage *wrapper* via CSS so the overlay stays in logical space and `bakeMask` is untouched.

**Tech Stack:** Nuxt 4, Vue 3 `<script setup>` + TypeScript, Tailwind, lucide-vue-next icons, Vitest (node env, `tests/unit/**/*.unit.spec.ts`).

**Reference:** Spec at `docs/superpowers/specs/2026-06-12-inpaint-modal-improvements-design.md`.

---

## File Structure

- `frontend/app/components/vue-canvas/InpaintModal.vue` — **modify**. The editor shell: stage, controls panel, history strip, keyboard. Consumes the composables.
- `frontend/app/composables/useBrushMask.ts` — **modify**. Owns the mask. Gains `inverted` flag (honored by `render`/`bakeMask`) and stroke-level undo/redo (delegating to `brushHistory`).
- `frontend/app/lib/brushHistory.ts` — **create**. Pure, generic snapshot undo/redo. Node-testable.
- `frontend/app/lib/stageView.ts` — **create**. Pure zoom/pan math (screen↔normalized, zoom-at-anchor, clamp, fit). Node-testable.
- `frontend/app/composables/useStageView.ts` — **create**. Reactive wrapper over `stageView` math (scale/tx/ty refs + transform style).
- `frontend/tests/unit/brush-history.unit.spec.ts` — **create**. Tests for `brushHistory`.
- `frontend/tests/unit/stage-view.unit.spec.ts` — **create**. Tests for `stageView`.

All `npm`/`npx` commands run from `frontend/`.

---

## Phase 1 — History, invert, mask-only, polish (no coordinate-math change)

### Task 1: Result history strip (replace single-batch results)

Today `inpaintResults: ref<string[]>` is *replaced* each generation and shown as a "Pick a result" grid. Replace it with an accumulating session-scoped `history` array, newest first.

**Files:**
- Modify: `frontend/app/components/vue-canvas/InpaintModal.vue`

- [ ] **Step 1: Add the history model and remove `inpaintResults`**

In the `<script setup>`, replace this line (currently ~line 103):

```ts
const inpaintResults = ref<string[]>([])
```

with:

```ts
interface HistoryItem { id: string; url: string; prompt: string; mode: 'mask' | 'describe' }
const history = ref<HistoryItem[]>([])
```

- [ ] **Step 2: Reset history when the source changes**

In `applySource` (currently ~line 74), change:

```ts
brush.clear(); clearSamMask(); inpaintResults.value = []; previewResult.value = null
```

to:

```ts
brush.clear(); clearSamMask(); history.value = []; previewResult.value = null
```

- [ ] **Step 3: Accumulate results in `runInpaint`**

In `runInpaint` (currently ~line 176), replace the final assignment:

```ts
    inpaintResults.value = images
```

with:

```ts
    const stamp = Date.now()
    const items: HistoryItem[] = images.map((url, i) => ({ id: `${stamp}_${i}`, url, prompt: p, mode: mode.value }))
    history.value = [...items, ...history.value]
```

- [ ] **Step 4: Update overlay references from `inpaintResults` to `history`**

In `renderOverlay` (currently ~line 148) change:

```ts
  if (inpaintResults.value.length) return // once results are in, show them not the masks
```

to:

```ts
  if (history.value.length) return // once results exist, show the previewed result, not the masks
```

In the overlay watch (currently ~line 161) change `inpaintResults.value.length` to `history.value.length`:

```ts
watch(() => [disp.w, disp.h, JSON.stringify(brush.strokes.value), comparing.value, history.value.length] as const,
  () => renderOverlay())
```

- [ ] **Step 5: Update the Generate button label**

In the template (currently ~line 376) change:

```html
      {{ inpaint.busy.value ? 'Generating…' : (inpaintResults.length ? 'Regenerate' : 'Generate') }}
```

to:

```html
      {{ inpaint.busy.value ? 'Generating…' : (history.length ? 'Regenerate' : 'Generate') }}
```

- [ ] **Step 6: Replace the results grid with the history strip**

Replace the whole `<!-- Results -->` block (currently ~lines 381–397) with:

```html
          <!-- History -->
          <div v-if="history.length" class="pt-2 border-t border-white/10">
            <div class="flex items-center justify-between mb-2 text-[11px] uppercase tracking-wide text-white/40">
              <span>History</span>
              <button class="flex items-center gap-1 normal-case tracking-normal text-white/50 hover:text-white cursor-pointer select-none" title="Hold to see the original"
                @pointerdown.stop="comparing = true" @pointerup="comparing = false" @pointerleave="comparing = false"><Eye class="size-3.5" /> Compare</button>
            </div>
            <div class="grid grid-cols-4 gap-2">
              <button v-for="item in history" :key="item.id"
                class="relative group rounded-md overflow-hidden border cursor-pointer"
                :class="previewResult === item.url ? 'border-emerald-400/90 ring-1 ring-emerald-400/60' : 'border-white/10 hover:border-emerald-400/80'"
                :title="item.prompt || (item.mode === 'describe' ? 'described edit' : 'inpaint')"
                @mouseenter="previewResult = item.url" @mouseleave="previewResult = null" @click="acceptInpaint(item.url)">
                <img :src="item.url" class="w-full aspect-square object-cover" draggable="false" />
                <span class="absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] bg-black/60 opacity-0 group-hover:opacity-100">Use</span>
              </button>
            </div>
            <p class="mt-1.5 text-[10px] text-white/30">Newest first · hover to preview · click to apply.</p>
          </div>
```

- [ ] **Step 7: Verify in the dev app**

Run ComfyUI (`cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python main.py --listen 127.0.0.1 --port 8188`) and the frontend (`cd frontend && npm run dev`). Open a project, add/select an Image artifact node with an image, open the Inpaint modal. Paint a region, Generate. Confirm: results appear in a 4-col strip labeled "History"; generate again and the new batch prepends (newest first, old batch still present); hovering a thumb previews it on the stage with an emerald ring; clicking applies and closes. No console errors.

- [ ] **Step 8: Commit**

```bash
git add app/components/vue-canvas/InpaintModal.vue
git commit -m "feat(inpaint): accumulate generations in a session history strip"
```

---

### Task 2: Mask invert (flag honored by render + bake)

Add an `inverted` flag to `useBrushMask`. When set, the mask is the complement of the painted region: paint what to **keep**, change everything else. Reversible, lossless (does not mutate strokes). Canvas behavior is verified manually.

**Files:**
- Modify: `frontend/app/composables/useBrushMask.ts`
- Modify: `frontend/app/components/vue-canvas/InpaintModal.vue`

- [ ] **Step 1: Add the `inverted` ref and fold it into `hasMask` + `clear`**

In `useBrushMask.ts`, after `const mode = ref<'add' | 'erase'>('add')` (currently ~line 38) add:

```ts
  const inverted = ref(false)             // paint what to KEEP; change everything else
```

Change `hasMask` (currently ~line 49) to:

```ts
  const hasMask = computed(() => inverted.value || strokes.value.some(s => !s.erase && s.points.length > 0))
```

Change `clear` (currently ~line 52) to:

```ts
  function clear() { strokes.value = []; drawing.value = false; inverted.value = false }
```

- [ ] **Step 2: Honor `inverted` in `bakeMask`**

In `bakeMask`, after the `bin` canvas is fully stamped (currently the block ending at `bctx.restore()` ~line 143) and before the "2) Composite onto solid black" step, insert an inversion step and draw `region` instead of `bin`:

```ts
    // 1b) Invert: white everywhere EXCEPT the painted region (paint = keep).
    let region: HTMLCanvasElement = bin
    if (inverted.value) {
      const inv = document.createElement('canvas')
      inv.width = bin.width; inv.height = bin.height
      const ictx = inv.getContext('2d')!
      ictx.fillStyle = '#fff'
      ictx.fillRect(0, 0, inv.width, inv.height)
      ictx.globalCompositeOperation = 'destination-out'
      ictx.drawImage(bin, 0, 0)
      region = inv
    }
```

Then in step 2, change `ctx.drawImage(bin, 0, 0)` to `ctx.drawImage(region, 0, 0)`.

- [ ] **Step 3: Honor `inverted` in the preview `render`**

Replace the whole `render` function (currently ~lines 107–118) with:

```ts
  /** Paint the translucent mask preview onto the editor overlay (W×H logical px). */
  function render(ctx: CanvasRenderingContext2D, W: number, H: number) {
    if (!inverted.value && !strokes.value.length) return
    const w = Math.max(1, Math.round(W)), h = Math.max(1, Math.round(H))
    const tmp = document.createElement('canvas')
    tmp.width = w; tmp.height = h
    const tctx = tmp.getContext('2d')!
    if (inverted.value) {
      // Wash everything, then punch out the painted (keep) region.
      tctx.fillStyle = PREVIEW_FILL
      tctx.fillRect(0, 0, w, h)
      if (strokes.value.length) {
        const hole = document.createElement('canvas')
        hole.width = w; hole.height = h
        stampMask(hole.getContext('2d')!, x => x * W, y => y * H, r => r * W)
        tctx.globalCompositeOperation = 'destination-out'
        tctx.drawImage(hole, 0, 0)
      }
    } else {
      stampMask(tctx, x => x * W, y => y * H, r => r * W)
      tctx.globalCompositeOperation = 'source-in'
      tctx.fillStyle = PREVIEW_FILL
      tctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(tmp, 0, 0, W, H)
  }
```

- [ ] **Step 4: Export `inverted`**

In the `return { ... }` (currently ~line 157), add `inverted` to the returned object:

```ts
  return {
    active, sizePx, mode, inverted, strokes, drawing, cursor, hasMask,
    setActive, clear, down, move, up, radiusNorm, render, bakeMask, stampMask,
  }
```

- [ ] **Step 5: Re-render the overlay when `inverted` changes**

In `InpaintModal.vue`, add `brush.inverted.value` to the overlay watch deps (the watch edited in Task 1 Step 4):

```ts
watch(() => [disp.w, disp.h, JSON.stringify(brush.strokes.value), brush.inverted.value, comparing.value, history.value.length] as const,
  () => renderOverlay())
```

- [ ] **Step 6: Add the Invert button (mask-tools row)**

First extend the lucide import (currently line 14) to include the invert icon:

```ts
import { X, Brush, Eraser, Eye, Wand2, ImagePlus, Loader2, FlipHorizontal2 } from 'lucide-vue-next'
```

In the template, inside `<template v-if="mode === 'mask'">`, replace the existing Clear button that sits in the brush row (currently ~line 331, the `ml-auto … @click="clearMask()"` button) by moving Clear out, and add a new mask-tools row directly after the Click-select block (currently ~lines 336–339). The Click-select row stays for now (it is reorganized in Task 3). Add:

```html
            <div class="flex items-center gap-1.5">
              <button class="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] cursor-pointer" :class="brush.inverted.value ? 'bg-amber-400/90 text-black' : 'bg-white/[0.06] text-white/70'" title="Invert: paint what to keep, change everything else" @click="brush.inverted.value = !brush.inverted.value"><FlipHorizontal2 class="size-3.5" /> Invert</button>
              <button class="ml-auto h-7 px-2 rounded-md bg-white/[0.06] text-white/70 text-[11px] cursor-pointer" title="Clear mask" @click="clearMask()">Clear</button>
            </div>
```

Then delete the old Clear button from the brush row (currently ~line 331):

```html
              <button class="ml-auto h-7 px-2 rounded-md bg-white/[0.06] text-white/70 text-[11px] cursor-pointer" title="Clear mask" @click="clearMask()">Clear</button>
```

- [ ] **Step 7: Verify in the dev app**

With the app running, open Inpaint on an image. Paint a small region → the stage shows that region washed. Click **Invert** (turns amber) → the wash flips to everything *except* what you painted. Generate → the model changes the unpainted area. Toggle Invert off → wash returns to the painted region. Clear → Invert resets off. No console errors.

- [ ] **Step 8: Commit**

```bash
git add app/composables/useBrushMask.ts app/components/vue-canvas/InpaintModal.vue
git commit -m "feat(inpaint): mask invert (paint what to keep)"
```

---

### Task 3: Mask-only view + controls reorg + polish

Add a mask-only inspection toggle, fold Click-select into the brush tool row as an icon (drop the dedicated row + beta caption), and tidy the mask-tools row.

**Files:**
- Modify: `frontend/app/components/vue-canvas/InpaintModal.vue`

- [ ] **Step 1: Add the `maskOnly` view ref**

In `<script setup>`, near `const mode = ref<'mask' | 'describe'>('mask')` (currently ~line 102) add:

```ts
const maskOnly = ref(false) // hide the photo, show only the painted region (inspection)
```

- [ ] **Step 2: Black backdrop + hide image when `maskOnly`**

In the stage, change the source `<img>` (currently ~line 298) to fade out under mask-only, and add a black backdrop behind the overlay. Replace:

```html
          <img v-if="sourceImg" :src="sourceImg.src" class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" draggable="false" />
          <canvas ref="overlay" class="absolute inset-0 pointer-events-none" :style="{ width: disp.w + 'px', height: disp.h + 'px' }" />
```

with:

```html
          <img v-if="sourceImg" :src="sourceImg.src" class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none transition-opacity" :class="maskOnly ? 'opacity-0' : 'opacity-100'" draggable="false" />
          <div v-if="maskOnly" class="absolute inset-0 bg-black pointer-events-none" />
          <canvas ref="overlay" class="absolute inset-0 pointer-events-none" :style="{ width: disp.w + 'px', height: disp.h + 'px' }" />
```

- [ ] **Step 3: Extend the lucide import for the mask-only icon**

Change the import line (edited in Task 2 Step 6) to add `EyeOff`:

```ts
import { X, Brush, Eraser, Eye, EyeOff, Wand2, ImagePlus, Loader2, FlipHorizontal2 } from 'lucide-vue-next'
```

- [ ] **Step 4: Fold Click-select into the brush tool row; rebuild the mask-tools row**

Replace the brush-tools row (currently ~lines 328–332, the Paint/Erase buttons — Clear was already removed in Task 2) so Click-select joins it as a right-aligned icon button:

```html
            <div class="flex items-center gap-1.5">
              <button class="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] cursor-pointer" :class="brush.mode.value === 'add' ? 'bg-cyan-400/90 text-black' : 'bg-white/[0.06] text-white/70'" title="Paint (X)" @click="brush.mode.value = 'add'"><Brush class="size-3.5" /> Paint</button>
              <button class="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] cursor-pointer" :class="brush.mode.value === 'erase' ? 'bg-rose-400/90 text-black' : 'bg-white/[0.06] text-white/70'" title="Erase (X)" @click="brush.mode.value = 'erase'"><Eraser class="size-3.5" /> Erase</button>
              <button class="ml-auto size-7 rounded-md flex items-center justify-center cursor-pointer" :class="samSelect ? 'bg-emerald-400/90 text-black' : 'bg-white/[0.06] text-white/70'" :title="samSelect ? 'Click an object to auto-select it' : 'Click-select an object (SAM · beta, falls back to brushing)'" @click="samSelect = !samSelect"><Wand2 class="size-3.5" /></button>
            </div>
```

Delete the old Click-select block (currently ~lines 336–339):

```html
            <div class="flex items-center gap-2">
              <button class="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] cursor-pointer" :class="samSelect ? 'bg-emerald-400/90 text-black' : 'bg-white/[0.06] text-white/70'" title="Click an object to auto-select it (SAM)" @click="samSelect = !samSelect"><Wand2 class="size-3.5" /> Click-select</button>
              <span class="text-[10px] text-white/30">{{ samSelect ? 'Click an object' : 'beta · falls back to brushing' }}</span>
            </div>
```

Update the mask-tools row (added in Task 2 Step 6) to include Mask-only between Invert and Clear:

```html
            <div class="flex items-center gap-1.5">
              <button class="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] cursor-pointer" :class="brush.inverted.value ? 'bg-amber-400/90 text-black' : 'bg-white/[0.06] text-white/70'" title="Invert: paint what to keep, change everything else" @click="brush.inverted.value = !brush.inverted.value"><FlipHorizontal2 class="size-3.5" /> Invert</button>
              <button class="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] cursor-pointer" :class="maskOnly ? 'bg-white/20 text-white' : 'bg-white/[0.06] text-white/70'" title="Show only the mask (hide the photo)" @click="maskOnly = !maskOnly"><component :is="maskOnly ? EyeOff : Eye" class="size-3.5" /> Mask only</button>
              <button class="ml-auto h-7 px-2 rounded-md bg-white/[0.06] text-white/70 text-[11px] cursor-pointer" title="Clear mask" @click="clearMask()">Clear</button>
            </div>
```

- [ ] **Step 5: Verify in the dev app**

Open Inpaint on an image. The brush row now shows Paint, Erase, and a small wand (Click-select) on the right; the beta caption is gone (it is in the wand's tooltip). Paint a region, toggle **Mask only** → the photo hides (black backdrop) leaving just the washed region; toggle off → photo returns. Click-select still works (or falls back). No console errors.

- [ ] **Step 6: Commit**

```bash
git add app/components/vue-canvas/InpaintModal.vue
git commit -m "feat(inpaint): mask-only view + tidy brush/mask tool rows"
```

---

## Phase 2 — Undo / redo

### Task 4: `brushHistory` pure snapshot stack (TDD)

A generic, immutable undo/redo helper. Pure — no Vue, no DOM — so it runs in the node-env vitest.

**Files:**
- Create: `frontend/app/lib/brushHistory.ts`
- Test: `frontend/tests/unit/brush-history.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/brush-history.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createHistory, record, undo, redo, canUndo, canRedo } from '~/lib/brushHistory'

describe('brushHistory', () => {
  it('starts with the initial present and no undo/redo', () => {
    const h = createHistory(0)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('record moves present into the past and updates present', () => {
    let h = createHistory(0)
    h = record(h, 1)
    h = record(h, 2)
    expect(h.present).toBe(2)
    expect(canUndo(h)).toBe(true)
    expect(canRedo(h)).toBe(false)
  })

  it('undo restores the prior present and enables redo', () => {
    let h = createHistory(0)
    h = record(h, 1)
    h = record(h, 2)
    h = undo(h)
    expect(h.present).toBe(1)
    expect(canRedo(h)).toBe(true)
    h = undo(h)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)
  })

  it('redo re-applies an undone state', () => {
    let h = createHistory(0)
    h = record(h, 1)
    h = undo(h)
    h = redo(h)
    expect(h.present).toBe(1)
    expect(canRedo(h)).toBe(false)
  })

  it('a new record after undo clears the redo future', () => {
    let h = createHistory(0)
    h = record(h, 1)
    h = record(h, 2)
    h = undo(h)            // present = 1, future = [2]
    h = record(h, 9)       // diverge
    expect(h.present).toBe(9)
    expect(canRedo(h)).toBe(false)
    h = undo(h)
    expect(h.present).toBe(1)
  })

  it('undo/redo at the ends are no-ops', () => {
    let h = createHistory(0)
    expect(undo(h).present).toBe(0)
    expect(redo(h).present).toBe(0)
  })

  it('does not mutate the input history object', () => {
    const h = createHistory(0)
    const h2 = record(h, 1)
    expect(h.present).toBe(0)
    expect(h2).not.toBe(h)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/brush-history.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/brushHistory` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/brushHistory.ts`:

```ts
/**
 * Generic, immutable undo/redo snapshot stack. Pure (no Vue, no DOM) so it can
 * be unit-tested in the node-env vitest and reused by any reactive owner.
 *
 * `present` is the live value; `past`/`future` hold snapshots. Every operation
 * returns a NEW History object — callers reassign rather than mutate.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** Commit a new present; the old present moves to the past and the redo future is dropped. */
export function record<T>(h: History<T>, next: T): History<T> {
  return { past: [...h.past, h.present], present: next, future: [] }
}

export function canUndo<T>(h: History<T>): boolean { return h.past.length > 0 }
export function canRedo<T>(h: History<T>): boolean { return h.future.length > 0 }

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h
  const past = h.past.slice(0, -1)
  const present = h.past[h.past.length - 1]!
  return { past, present, future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h
  const [present, ...future] = h.future
  return { past: [...h.past, h.present], present: present!, future }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/brush-history.unit.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/brushHistory.ts tests/unit/brush-history.unit.spec.ts
git commit -m "feat(inpaint): pure brushHistory undo/redo stack + tests"
```

---

### Task 5: Wire undo/redo into `useBrushMask` + modal

Capture a snapshot of `{ strokes, inverted }` after each stroke and on clear/invert, and expose `undo`/`redo`/`canUndo`/`canRedo`. Wire a stage chip and keyboard shortcuts.

**Files:**
- Modify: `frontend/app/composables/useBrushMask.ts`
- Modify: `frontend/app/components/vue-canvas/InpaintModal.vue`

- [ ] **Step 1: Import the history helpers**

At the top of `useBrushMask.ts`, below the file doc comment and above `export interface BrushStroke`, add:

```ts
import {
  createHistory, record as recordHistory, undo as undoHistory,
  redo as redoHistory, canUndo as histCanUndo, canRedo as histCanRedo,
  type History,
} from '~/lib/brushHistory'
```

- [ ] **Step 2: Add the snapshot state and helpers**

Inside `useBrushMask`, after `const inverted = ref(false)` (added in Task 2), add:

```ts
  type BrushSnapshot = { strokes: BrushStroke[]; inverted: boolean }
  const snap = (): BrushSnapshot => ({ strokes: structuredClone(strokes.value), inverted: inverted.value })
  const hist = ref<History<BrushSnapshot>>(createHistory(snap()))
  const canUndo = computed(() => histCanUndo(hist.value))
  const canRedo = computed(() => histCanRedo(hist.value))
  function commit() { hist.value = recordHistory(hist.value, snap()) }
  function apply(s: BrushSnapshot) { strokes.value = structuredClone(s.strokes); inverted.value = s.inverted }
  function undo() { if (!canUndo.value) return; hist.value = undoHistory(hist.value); apply(hist.value.present) }
  function redo() { if (!canRedo.value) return; hist.value = redoHistory(hist.value); apply(hist.value.present) }
  function toggleInvert() { inverted.value = !inverted.value; commit() }
```

- [ ] **Step 3: Commit a snapshot after each stroke and on clear**

Change `up` (currently ~line 68) to commit the finished stroke:

```ts
  function up() { if (drawing.value) { drawing.value = false; commit() } else { drawing.value = false } }
```

Change `clear` (edited in Task 2) to commit the cleared state:

```ts
  function clear() { strokes.value = []; drawing.value = false; inverted.value = false; commit() }
```

- [ ] **Step 4: Export the new API**

Update the `return { ... }` to add the undo/redo surface and `toggleInvert`:

```ts
  return {
    active, sizePx, mode, inverted, strokes, drawing, cursor, hasMask,
    canUndo, canRedo, undo, redo, toggleInvert,
    setActive, clear, down, move, up, radiusNorm, render, bakeMask, stampMask,
  }
```

- [ ] **Step 5: Switch the Invert button to the undoable toggle**

In `InpaintModal.vue`, change the Invert button's click handler (set in Task 3 Step 4) from `@click="brush.inverted.value = !brush.inverted.value"` to:

```html
@click="brush.toggleInvert()"
```

- [ ] **Step 6: Add the undo/redo chip to the stage**

Extend the lucide import to add the arrows:

```ts
import { X, Brush, Eraser, Eye, EyeOff, Wand2, ImagePlus, Loader2, FlipHorizontal2, Undo2, Redo2 } from 'lucide-vue-next'
```

In the stage, inside the `v-else` stage container's parent (the `flex-1` stage column), add a chip in the top-left. Place it right after the opening of the stage column `<div class="flex-1 relative …">` (currently ~line 276), as a sibling of the Close button:

```html
        <div v-if="sourceUrl" class="absolute top-4 left-4 z-10 flex items-center gap-1 bg-black/40 border border-white/10 rounded-md p-0.5">
          <button class="flex items-center justify-center size-7 rounded bg-white/5 hover:bg-white/10 cursor-pointer disabled:opacity-30 disabled:cursor-default" title="Undo (⌘Z)" :disabled="!brush.canUndo.value" @click="brush.undo()"><Undo2 class="size-4" /></button>
          <button class="flex items-center justify-center size-7 rounded bg-white/5 hover:bg-white/10 cursor-pointer disabled:opacity-30 disabled:cursor-default" title="Redo (⌘⇧Z)" :disabled="!brush.canRedo.value" @click="brush.redo()"><Redo2 class="size-4" /></button>
        </div>
```

- [ ] **Step 7: Add keyboard shortcuts**

In `onKeydown` (currently ~line 256), after the `if (typing) return` guard and before the `[`/`]` handling, add:

```ts
  const meta = e.metaKey || e.ctrlKey
  if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) brush.redo(); else brush.undo(); return }
  if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); brush.redo(); return }
```

- [ ] **Step 8: Verify in the dev app**

Open Inpaint on an image. Paint three separate strokes. Press `⌘Z` (or `Ctrl+Z`) three times → strokes disappear one at a time; the Undo chip greys out at the start. Press `⌘⇧Z` → strokes reappear. Toggle Invert, then `⌘Z` → invert reverts. Paint after undoing some strokes → redo chip greys out (future cleared). No console errors.

- [ ] **Step 9: Commit**

```bash
git add app/composables/useBrushMask.ts app/components/vue-canvas/InpaintModal.vue
git commit -m "feat(inpaint): stroke-level undo/redo with chip + keyboard"
```

---

## Phase 3 — Zoom / pan (built last; bake geometry untouched)

### Task 6: `stageView` pure zoom/pan math (TDD)

Pure transform math: screen↔normalized mapping under a `translate(tx,ty) scale(s)` applied to a logical-sized content box, zoom-at-anchor, scale clamp, and fit. The screen↔norm round-trip test guards the regression-prone path.

**Convention:** content is `rectW × rectH` logical px with `transform-origin: 0 0`. A normalized point `(nx,ny)` (0..1 of content) maps to screen px (relative to the stage rect origin): `sx = tx + s·nx·rectW`, `sy = ty + s·ny·rectH`.

**Files:**
- Create: `frontend/app/lib/stageView.ts`
- Test: `frontend/tests/unit/stage-view.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/stage-view.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  MIN_SCALE, MAX_SCALE, clampScale, identityView, screenToNorm, normToScreen, zoomAt,
} from '~/lib/stageView'

const RW = 400, RH = 300

describe('stageView', () => {
  it('clamps scale to [MIN, MAX]', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE)
    expect(clampScale(100)).toBe(MAX_SCALE)
    expect(clampScale(1)).toBe(1)
  })

  it('identity view maps norm→screen 1:1', () => {
    const v = identityView()
    expect(normToScreen(0.5, 0.5, RW, RH, v)).toEqual({ sx: 200, sy: 150 })
  })

  it('screenToNorm is the inverse of normToScreen (identity)', () => {
    const v = identityView()
    const s = normToScreen(0.25, 0.75, RW, RH, v)
    const n = screenToNorm(s.sx, s.sy, RW, RH, v)
    expect(n.nx).toBeCloseTo(0.25)
    expect(n.ny).toBeCloseTo(0.75)
  })

  it('screenToNorm inverts normToScreen under zoom + pan', () => {
    const v = { scale: 2.5, tx: -130, ty: 40 }
    const s = normToScreen(0.4, 0.6, RW, RH, v)
    const n = screenToNorm(s.sx, s.sy, RW, RH, v)
    expect(n.nx).toBeCloseTo(0.4)
    expect(n.ny).toBeCloseTo(0.6)
  })

  it('zoomAt keeps the anchor screen point fixed', () => {
    const v = identityView()
    const ax = 120, ay = 90
    const before = screenToNorm(ax, ay, RW, RH, v)
    const z = zoomAt(v, 2, ax, ay)
    const after = screenToNorm(ax, ay, RW, RH, z)
    expect(after.nx).toBeCloseTo(before.nx)
    expect(after.ny).toBeCloseTo(before.ny)
    expect(z.scale).toBe(2)
  })

  it('zoomAt respects the scale clamp', () => {
    const v = { scale: MAX_SCALE, tx: 0, ty: 0 }
    expect(zoomAt(v, 4, 0, 0).scale).toBe(MAX_SCALE)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/stage-view.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/stageView`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/stageView.ts`:

```ts
/**
 * Pure zoom/pan transform math for the inpaint stage. The stage content (image
 * + mask overlay) is a logical rectW×rectH box rendered with CSS
 * `transform: translate(tx,ty) scale(scale)` and `transform-origin: 0 0`.
 *
 * Keeping this pure (no Vue, no DOM) means the regression-prone screen↔mask
 * coordinate mapping is unit-tested, and the live overlay/bake stay in logical
 * space — so useBrushMask.bakeMask never has to know about zoom.
 */
export interface View {
  scale: number
  tx: number   // pan offset px (screen, relative to stage rect origin)
  ty: number
}

export const MIN_SCALE = 0.25
export const MAX_SCALE = 8

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

export function identityView(): View {
  return { scale: 1, tx: 0, ty: 0 }
}

/** Normalized content point (0..1) → screen px relative to the stage rect origin. */
export function normToScreen(nx: number, ny: number, rectW: number, rectH: number, v: View) {
  return { sx: v.tx + v.scale * nx * rectW, sy: v.ty + v.scale * ny * rectH }
}

/** Screen px (relative to the stage rect origin) → normalized content point (0..1). */
export function screenToNorm(sx: number, sy: number, rectW: number, rectH: number, v: View) {
  return {
    nx: (sx - v.tx) / (v.scale * rectW),
    ny: (sy - v.ty) / (v.scale * rectH),
  }
}

/** Zoom by `factor` about an anchor screen point, keeping that point fixed. */
export function zoomAt(v: View, factor: number, anchorX: number, anchorY: number): View {
  const scale = clampScale(v.scale * factor)
  const k = scale / v.scale
  // Keep the content point under the anchor stationary: s' = anchor - k·(anchor - s)
  return {
    scale,
    tx: anchorX - k * (anchorX - v.tx),
    ty: anchorY - k * (anchorY - v.ty),
  }
}

/** Pan by a screen-px delta. */
export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, tx: v.tx + dx, ty: v.ty + dy }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/stage-view.unit.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/stageView.ts tests/unit/stage-view.unit.spec.ts
git commit -m "feat(inpaint): pure stageView zoom/pan math + tests"
```

---

### Task 7: `useStageView` composable + integrate zoom/pan into the modal

Wrap the pure math in reactive state and wire it into the stage: an inner transformed wrapper holds the image + overlay; pointer coords map through the view; cursor ring and zoom controls follow.

**Files:**
- Create: `frontend/app/composables/useStageView.ts`
- Modify: `frontend/app/components/vue-canvas/InpaintModal.vue`

- [ ] **Step 1: Create the composable**

Create `frontend/app/composables/useStageView.ts`:

```ts
/**
 * Reactive zoom/pan state for the inpaint stage. Holds scale/tx/ty and exposes
 * a CSS transform string + helpers, all delegating to the pure `stageView`
 * math. The content stays logical-sized; only the wrapper is transformed.
 */
import { computed, ref } from 'vue'
import {
  type View, identityView, clampScale, zoomAt, panBy, screenToNorm, normToScreen,
} from '~/lib/stageView'

export function useStageView() {
  const scale = ref(1)
  const tx = ref(0)
  const ty = ref(0)
  const view = (): View => ({ scale: scale.value, tx: tx.value, ty: ty.value })
  function set(v: View) { scale.value = clampScale(v.scale); tx.value = v.tx; ty.value = v.ty }

  const transform = computed(() => `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`)
  const percent = computed(() => Math.round(scale.value * 100))

  function reset() { set(identityView()) }
  function zoomBy(factor: number, anchorX: number, anchorY: number) { set(zoomAt(view(), factor, anchorX, anchorY)) }
  function pan(dx: number, dy: number) { set(panBy(view(), dx, dy)) }
  function toNorm(sx: number, sy: number, rectW: number, rectH: number) { return screenToNorm(sx, sy, rectW, rectH, view()) }
  function toScreen(nx: number, ny: number, rectW: number, rectH: number) { return normToScreen(nx, ny, rectW, rectH, view()) }

  return { scale, tx, ty, transform, percent, reset, zoomBy, pan, toNorm, toScreen }
}
```

- [ ] **Step 2: Instantiate the view and reset on source load**

In `InpaintModal.vue`, near `const brush = useBrushMask()` (currently ~line 93) add:

```ts
const view = useStageView()
const spaceDown = ref(false) // hold Space to pan
```

In `applySource` (Task 1 Step 2 edited it), after the successful display-size computation (inside the `try`, after the `else { disp.h = MAX; disp.w = Math.round(MAX * a) }` line, currently ~line 85) add:

```ts
    view.reset()
```

- [ ] **Step 3: Map pointer coords through the view**

Replace `clientToNorm` (currently ~lines 121–124) with:

```ts
function clientToNorm(e: PointerEvent) {
  const r = stageRef.value?.getBoundingClientRect(); if (!r) return null
  return view.toNorm(e.clientX - r.left, e.clientY - r.top, disp.w, disp.h)
}
```

Note: `view.toNorm` returns `{ nx, ny }`, matching the existing shape — no downstream change needed.

- [ ] **Step 4: Pan via Space-drag / middle button; otherwise paint**

Replace `onPointerDown`, `onPointerMove`, `onPointerUp` (currently ~lines 125–134) with:

```ts
const panning = ref(false)
let panLast: { x: number; y: number } | null = null
function onPointerDown(e: PointerEvent) {
  if (spaceDown.value || e.button === 1) {
    e.preventDefault(); panning.value = true; panLast = { x: e.clientX, y: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    return
  }
  const p = clientToNorm(e); if (!p) return
  e.preventDefault()
  if (samSelect.value) { doSamSelect(p.nx, p.ny); return }
  clearSamMask()
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  brush.down(p.nx, p.ny, disp.w)
}
function onPointerMove(e: PointerEvent) {
  if (panning.value && panLast) {
    view.pan(e.clientX - panLast.x, e.clientY - panLast.y)
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  const p = clientToNorm(e); if (p) brush.move(p.nx, p.ny)
}
function onPointerUp() { if (panning.value) { panning.value = false; panLast = null } else brush.up() }
```

- [ ] **Step 5: Wheel to zoom (⌘/Ctrl + wheel) or pan**

Add a wheel handler near the pointer handlers:

```ts
function onWheel(e: WheelEvent) {
  const r = stageRef.value?.getBoundingClientRect(); if (!r) return
  e.preventDefault()
  if (e.metaKey || e.ctrlKey) {
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    view.zoomBy(factor, e.clientX - r.left, e.clientY - r.top)
  } else {
    view.pan(-e.deltaX, -e.deltaY)
  }
}
```

- [ ] **Step 6: Track the Space key for panning**

In `onKeydown` (currently ~line 256), after the `if (e.key === 'Escape') …` line, add:

```ts
  if (e.code === 'Space' && !typing) { e.preventDefault(); spaceDown.value = true; return }
```

Add a keyup listener. After the `onKeydown` function, add:

```ts
function onKeyup(e: KeyboardEvent) { if (e.code === 'Space') spaceDown.value = false }
```

In `onMounted` (currently ~line 264) add the listener, and remove it in `onBeforeUnmount`:

```ts
  window.addEventListener('keyup', onKeyup, true)
```
```ts
onBeforeUnmount(() => { window.removeEventListener('keydown', onKeydown, true); window.removeEventListener('keyup', onKeyup, true) })
```

- [ ] **Step 7: Wrap image + overlay in the transformed wrapper; move the cursor ring out**

In the stage template, change the stage container (currently ~lines 288–308). Add `@wheel.prevent="onWheel"` to the stage `div`, set its cursor to grab while panning, wrap the `<img>`/backdrop/`<canvas>` in a transformed inner div, and replace the cursor-ring positioning with view-aware screen coords. Replace the block:

```html
        <div
          v-else
          ref="stageRef"
          class="relative rounded-md overflow-hidden ring-1 ring-white/10"
          :class="samSelect ? 'cursor-crosshair' : 'cursor-none'"
          :style="{ width: disp.w + 'px', height: disp.h + 'px' }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
        >
          <img v-if="sourceImg" :src="sourceImg.src" class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none transition-opacity" :class="maskOnly ? 'opacity-0' : 'opacity-100'" draggable="false" />
          <div v-if="maskOnly" class="absolute inset-0 bg-black pointer-events-none" />
          <canvas ref="overlay" class="absolute inset-0 pointer-events-none" :style="{ width: disp.w + 'px', height: disp.h + 'px' }" />
          <!-- brush cursor ring -->
          <div
            v-if="!samSelect && brush.cursor.value"
            class="absolute pointer-events-none rounded-full border-2"
            :class="brush.mode.value === 'erase' ? 'border-rose-400/90' : 'border-cyan-300/90'"
            :style="{ left: brush.cursor.value.x * disp.w + 'px', top: brush.cursor.value.y * disp.h + 'px', width: brush.sizePx.value + 'px', height: brush.sizePx.value + 'px', transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55)' }"
          />
          <div v-if="loadingSrc" class="absolute inset-0 flex items-center justify-center bg-black/30"><Loader2 class="size-6 animate-spin text-white/60" /></div>
        </div>
```

with:

```html
        <div
          v-else
          ref="stageRef"
          class="relative rounded-md overflow-hidden ring-1 ring-white/10"
          :class="panning ? 'cursor-grabbing' : spaceDown ? 'cursor-grab' : samSelect ? 'cursor-crosshair' : 'cursor-none'"
          :style="{ width: disp.w + 'px', height: disp.h + 'px' }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @wheel.prevent="onWheel"
        >
          <div class="absolute inset-0" :style="{ transform: view.transform.value, transformOrigin: '0 0', width: disp.w + 'px', height: disp.h + 'px' }">
            <img v-if="sourceImg" :src="sourceImg.src" class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none transition-opacity" :class="maskOnly ? 'opacity-0' : 'opacity-100'" draggable="false" />
            <div v-if="maskOnly" class="absolute inset-0 bg-black pointer-events-none" />
            <canvas ref="overlay" class="absolute inset-0 pointer-events-none" :style="{ width: disp.w + 'px', height: disp.h + 'px' }" />
          </div>
          <!-- brush cursor ring (screen space; scales with zoom) -->
          <div
            v-if="!samSelect && !spaceDown && !panning && brush.cursor.value"
            class="absolute pointer-events-none rounded-full border-2"
            :class="brush.mode.value === 'erase' ? 'border-rose-400/90' : 'border-cyan-300/90'"
            :style="{ left: view.toScreen(brush.cursor.value.x, brush.cursor.value.y, disp.w, disp.h).sx + 'px', top: view.toScreen(brush.cursor.value.x, brush.cursor.value.y, disp.w, disp.h).sy + 'px', width: brush.sizePx.value * view.scale.value + 'px', height: brush.sizePx.value * view.scale.value + 'px', transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55)' }"
          />
          <div v-if="loadingSrc" class="absolute inset-0 flex items-center justify-center bg-black/30"><Loader2 class="size-6 animate-spin text-white/60" /></div>
        </div>
```

- [ ] **Step 8: Add the zoom control cluster (bottom-left of the stage)**

Extend the lucide import for zoom icons:

```ts
import { X, Brush, Eraser, Eye, EyeOff, Wand2, ImagePlus, Loader2, FlipHorizontal2, Undo2, Redo2, ZoomIn, ZoomOut, Maximize } from 'lucide-vue-next'
```

In the stage column, add a control cluster (sibling of the undo/redo chip from Task 5). Place it just before the `<input ref="fileInputRef" …>` line (currently ~line 309):

```html
        <div v-if="sourceUrl" class="absolute bottom-4 left-4 z-10 flex items-center gap-1 bg-black/40 border border-white/10 rounded-md p-0.5 text-white/70">
          <button class="flex items-center justify-center size-7 rounded hover:bg-white/10 cursor-pointer" title="Zoom out" @click="view.zoomBy(1 / 1.2, disp.w / 2, disp.h / 2)"><ZoomOut class="size-4" /></button>
          <span class="min-w-[3rem] text-center text-[11px] tabular-nums select-none">{{ view.percent.value }}%</span>
          <button class="flex items-center justify-center size-7 rounded hover:bg-white/10 cursor-pointer" title="Zoom in" @click="view.zoomBy(1.2, disp.w / 2, disp.h / 2)"><ZoomIn class="size-4" /></button>
          <span class="w-px h-4 bg-white/15 mx-0.5" />
          <button class="flex items-center justify-center size-7 rounded hover:bg-white/10 cursor-pointer" title="Fit" @click="view.reset()"><Maximize class="size-3.5" /></button>
        </div>
```

- [ ] **Step 9: Verify in the dev app**

Open Inpaint on a reasonably large image. `⌘`+scroll (or `Ctrl`+scroll) zooms toward the cursor; the `%` readout updates; image stays sharp-aligned with the mask. Two-finger scroll (or scroll) pans. Hold **Space** and drag → pans (grab cursor). Zoom in, then **paint a stroke** → it lands exactly under the cursor and stays aligned when you zoom back out. Generate with a zoomed view → result aligns with the source (proves bake is zoom-independent). Click **Fit** → returns to 100%/centered. Loading a new image resets the view. No console errors.

- [ ] **Step 10: Commit**

```bash
git add app/composables/useStageView.ts app/components/vue-canvas/InpaintModal.vue
git commit -m "feat(inpaint): zoom & pan stage via useStageView (bake unchanged)"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS, including the new `brush-history` and `stage-view` files.

- [ ] **End-to-end manual pass**

With ComfyUI + frontend running, on an Image node: zoom in, paint precisely, undo a couple strokes, invert, toggle mask-only to check coverage, Generate a batch of 2–3, regenerate to grow the history, hover/compare, then click a result to apply it back to the node (node locks + preview updates). Confirm the applied image flows downstream. No console errors throughout.

---

## Notes / deferred (per spec)

- **Per-brush hardness** — deferred; the bake feathers globally.
- **Onboarding / shortcut legend** — deferred (shortcuts live in tooltips: ⌘Z/⌘⇧Z, X, [ ]).
- **History persistence** — intentionally session-only; cleared on source change and modal close. No node/graph-doc plumbing.
- **Mask-only rendering** uses a black backdrop + the cyan wash (region-on-black), not literal white-on-black — same inspection value, far simpler.
