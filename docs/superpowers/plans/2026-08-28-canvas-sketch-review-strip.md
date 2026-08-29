# Canvas Sketch Review Strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the canvas prompt-bar sketch flow's auto-placed pile node with a review-then-commit strip docked above the prompt bar — the four sketches are reviewed first, and exactly one is committed to the canvas via Keep or drag-to-place, then the strip closes.

**Architecture:** A new presentation-only component `SketchReviewStrip.vue` renders the four sketch images and reports gestures (hover, select, keep, cancel, reroll, dropAt). `VueNodeCanvas.vue` hosts it: the prompt-bar sketch batch, which today calls `materializeSketchPileAt(...)`, instead populates the strip; a commit (Keep or drop) creates ONE image node and tears down the transient sketch-pad state. Generation is unchanged.

**Tech Stack:** Nuxt 4 / Vue 3.5 `<script setup>` + TypeScript, Tailwind, Vitest + @vue/test-utils (jsdom). Vue Flow canvas; `project(screenPt)` converts screen → graph coords.

## Global Constraints

- **Generation unchanged:** do not touch the sketch fast-path, `buildSketchPilePayload`, `refreshSketchPile`, the seed model, or the hidden sketch-pad generator. Four near-identical sketches is intended.
- **Prompt-bar flow only** this pass. The visible **Sketch node** keeps its pile (`materializeSketchPileBeside`) — do NOT change that branch.
- **Exactly one commit** closes the strip; the other three are discarded. No multi-keep.
- **Committed node = today's kept sketch shape:** the node created on commit must be the same image-loader / sketch-output node a kept pile card becomes today (reuse the existing creation path — see Task 3).
- **Drop is pan/zoom-correct:** a dropped sketch lands under the cursor in graph coordinates (`project()`), not at raw screen px.
- **No orphans:** after commit or cancel, no hidden sketch-pad / skeleton-pile nodes remain.
- Visual vocabulary matches the take strip (calm dark tray, pure-image tiles, Keep = action-blue accent, Cancel = quiet text, Re-roll = neutral/white) but this is a NEW component, not a reuse of `TakeStrip.vue`.
- vue-tsc: **do not raise the error count** — record the count before you start (`cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c "error TS"`) and hold it (a parallel session may have it at 417, not 420 — use the live pre-start number as your baseline).
- vitest EXPLICIT paths, from `frontend/`. Stage own files only (parallel sessions active) — never `git add -A`.

## File Structure

- `frontend/app/components/vue-canvas/SketchReviewStrip.vue` — CREATE. Presentation + gestures. Props: the four sketch image srcs + busy/selected state. Emits: `hover`, `select`, `keep`, `cancel`, `reroll`, `dropAt`. One clear responsibility: show four sketches, report what the user did. Knows nothing about nodes or the canvas.
- `frontend/tests/unit/sketch-review-strip.unit.spec.ts` — CREATE. Component tests.
- `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — MODIFY. Host: strip state, mount, and the commit→node / cancel / reroll wiring, replacing the prompt-bar `materializeSketchPileAt` branch.
- Reference (read, do not restructure): `frontend/app/lib/sketch/sketchPile.ts` (`planKeptCard`, `buildSketchPilePayload`, `refreshSketchPile`, `MAX_SKETCH_ITEMS`), and `VueNodeCanvas.vue` seams named in Task 3.

---

### Task 1: SketchReviewStrip.vue — presentation + Keep/Cancel/Re-roll

The strip: four pure-image sketch tiles in a docked tray, hover reveals a preview above the hovered tile, and a bar with Cancel (left) + Re-roll + Keep (right) matching the take-strip hierarchy. Presentation + emits only; no drag yet (Task 2).

**Files:**
- Create: `frontend/app/components/vue-canvas/SketchReviewStrip.vue`
- Test: `frontend/tests/unit/sketch-review-strip.unit.spec.ts`

**Interfaces:**
- Props: `images: string[]` (the sketch srcs, up to 4), `selected: number | null` (index), `busy?: boolean`.
- Emits: `hover: [index: number | null]`, `select: [index: number]`, `keep: []` (commits the `selected` tile), `cancel: []`, `reroll: []`.
- Produces testids: `sketch-strip`, `sketch-tile` (one per image), `sketch-tip` (hover preview), `sketch-keep`, `sketch-cancel`, `sketch-reroll`.

- [ ] **Step 1: Write the failing test** — `frontend/tests/unit/sketch-review-strip.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SketchReviewStrip from '~/components/vue-canvas/SketchReviewStrip.vue'

const IMGS = ['data:img/a', 'data:img/b', 'data:img/c', 'data:img/d']
const base = (over = {}) => ({ images: IMGS, selected: null, ...over })
const tiles = (w: any) => w.findAll('[data-testid="sketch-tile"]')

describe('SketchReviewStrip — presentation', () => {
  it('renders one pure-image tile per sketch, in order', () => {
    const w = mount(SketchReviewStrip, { props: base() })
    const imgs = tiles(w).map(t => t.find('img').attributes('src'))
    expect(imgs).toEqual(IMGS)
  })
  it('bar order is Cancel then Re-roll then Keep', () => {
    const w = mount(SketchReviewStrip, { props: base() })
    const ids = w.get('[data-testid="sketch-actions"]').findAll('[data-testid^="sketch-"]')
      .map(b => b.attributes('data-testid'))
    expect(ids).toEqual(['sketch-cancel', 'sketch-reroll', 'sketch-keep'])
  })
  it('Keep is disabled until a tile is selected', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    expect(w.get('[data-testid="sketch-keep"]').attributes('disabled')).toBeDefined()
    await w.setProps({ selected: 1 })
    expect(w.get('[data-testid="sketch-keep"]').attributes('disabled')).toBeUndefined()
  })
})

describe('SketchReviewStrip — emits', () => {
  it('hovering a tile emits hover(index); leaving emits hover(null)', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    await tiles(w)[2]!.trigger('mouseenter')
    expect(w.emitted('hover')!.at(-1)).toEqual([2])
    await tiles(w)[2]!.trigger('mouseleave')
    expect(w.emitted('hover')!.at(-1)).toEqual([null])
  })
  it('clicking a tile emits select(index)', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    await tiles(w)[1]!.trigger('click')
    expect(w.emitted('select')![0]).toEqual([1])
  })
  it('Keep emits keep, Cancel emits cancel, Re-roll emits reroll', async () => {
    const w = mount(SketchReviewStrip, { props: base({ selected: 0 }) })
    await w.get('[data-testid="sketch-keep"]').trigger('click')
    await w.get('[data-testid="sketch-cancel"]').trigger('click')
    await w.get('[data-testid="sketch-reroll"]').trigger('click')
    expect(w.emitted('keep')).toHaveLength(1)
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('reroll')).toHaveLength(1)
  })
  it('busy disables Keep and Re-roll', () => {
    const w = mount(SketchReviewStrip, { props: base({ selected: 0, busy: true }) })
    expect(w.get('[data-testid="sketch-keep"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="sketch-reroll"]').attributes('disabled')).toBeDefined()
  })
  it('the hovered tile shows a preview above it', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    await tiles(w)[0]!.trigger('mouseenter')
    expect(w.get('[data-testid="sketch-tip"]').isVisible()).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `cd frontend && npx vitest run tests/unit/sketch-review-strip.unit.spec.ts`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Create `SketchReviewStrip.vue`**

```vue
<script setup lang="ts">
/**
 * Canvas sketch review strip — four instant sketches, docked above the prompt
 * bar, reviewed before any land. PRESENTATION + gesture only: it shows the
 * images and reports what the user did (hover/select/keep/cancel/reroll, and —
 * Task 2 — dropAt). The canvas host turns a commit into one image node and
 * tears down the transient sketch-pad state. Borrows the take strip's calm
 * vocabulary but is its own component (canvas context: finished sketch images,
 * drag-to-place, no studio preview to drive).
 */
import { ref } from 'vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'

const props = withDefaults(defineProps<{
  images: string[]
  selected: number | null
  busy?: boolean
}>(), { busy: false })

const emit = defineEmits<{
  hover: [index: number | null]
  select: [index: number]
  keep: []
  cancel: []
  reroll: []
}>()

const hovered = ref<number | null>(null)
function onHover(i: number | null) { hovered.value = i; emit('hover', i) }

const TILE = 'relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-[6px] border border-white/12 transition enabled:cursor-pointer hover:border-white/30'
</script>

<template>
  <div data-testid="sketch-strip"
       class="flex items-center gap-1.5 rounded-[9px] border border-white/10 bg-[#0b0d11]/95 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur">
    <div class="flex items-center gap-1.5" @mouseleave="onHover(null)">
      <button v-for="(src, i) in images" :key="i" data-testid="sketch-tile" type="button"
              :data-index="i" :aria-pressed="selected === i ? 'true' : 'false'"
              :class="[TILE, selected === i ? 'border-action ring-1 ring-action' : '']"
              @mouseenter="onHover(i)" @focus="onHover(i)" @blur="onHover(null)"
              @click="emit('select', i)">
        <img :src="src" alt="" class="h-full w-full object-cover">
        <!-- hover preview: a larger look, floated above this tile -->
        <div v-if="hovered === i" data-testid="sketch-tip"
             class="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 h-[128px] w-[128px] -translate-x-1/2 overflow-hidden rounded-[8px] border border-white/15 shadow-[0_10px_30px_rgba(0,0,0,0.55)]">
          <img :src="src" alt="" class="h-full w-full object-cover">
        </div>
      </button>
    </div>

    <div data-testid="sketch-actions" class="ml-1 flex items-center gap-2 border-l border-white/10 pl-2">
      <StudioButton data-testid="sketch-cancel" variant="subtle" @click="emit('cancel')">Cancel</StudioButton>
      <StudioButton data-testid="sketch-reroll" variant="neutral" :disabled="busy" @click="emit('reroll')">↻ Re-roll</StudioButton>
      <StudioButton data-testid="sketch-keep" variant="primary" :disabled="busy || selected === null" @click="emit('keep')">Keep</StudioButton>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd frontend && npx vitest run tests/unit/sketch-review-strip.unit.spec.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: equal to your recorded pre-start baseline (no rise); zero errors in the new file.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/SketchReviewStrip.vue frontend/tests/unit/sketch-review-strip.unit.spec.ts
git commit -m "feat(sketch): SketchReviewStrip — docked review tiles + Keep/Cancel/Re-roll"
```

---

### Task 2: Drag-to-place gesture

A tile can be dragged onto the canvas. A press-and-move past a small threshold begins a drag: the tile lifts, a ghost (the full sketch) follows the cursor, and releasing emits `dropAt` with the sketch index and the release point in **screen** coordinates (the host projects to graph coords). A press without movement stays a click (select).

**Files:**
- Modify: `frontend/app/components/vue-canvas/SketchReviewStrip.vue`
- Test: `frontend/tests/unit/sketch-review-strip.unit.spec.ts`

**Interfaces:**
- New emit: `dropAt: [payload: { index: number; clientX: number; clientY: number }]`.
- A press-move-release past ~4px on a tile emits `dropAt` (and NOT `select`). A press-release under threshold emits `select` (and NOT `dropAt`).
- While dragging, a `[data-testid="sketch-ghost"]` element exists (the full-sketch ghost following the pointer).

- [ ] **Step 1: Add the failing tests**

```ts
describe('SketchReviewStrip — drag to place', () => {
  it('a press-move-release past threshold emits dropAt with index + point, not select', async () => {
    const w = mount(SketchReviewStrip, { props: base(), attachTo: document.body })
    const tile = tiles(w)[2]!
    await tile.trigger('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 })
    await tile.trigger('pointermove', { clientX: 140, clientY: 180, pointerId: 1 })
    expect(w.find('[data-testid="sketch-ghost"]').exists()).toBe(true)
    await tile.trigger('pointerup', { clientX: 140, clientY: 180, pointerId: 1 })
    expect(w.emitted('dropAt')![0]).toEqual([{ index: 2, clientX: 140, clientY: 180 }])
    expect(w.emitted('select')).toBeUndefined()
    expect(w.find('[data-testid="sketch-ghost"]').exists()).toBe(false)
    w.unmount()
  })
  it('a press-release under threshold is a click (select), not a drop', async () => {
    const w = mount(SketchReviewStrip, { props: base(), attachTo: document.body })
    const tile = tiles(w)[0]!
    await tile.trigger('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 })
    await tile.trigger('pointermove', { clientX: 101, clientY: 101, pointerId: 1 })
    await tile.trigger('pointerup', { clientX: 101, clientY: 101, pointerId: 1 })
    await tile.trigger('click')
    expect(w.emitted('dropAt')).toBeUndefined()
    expect(w.emitted('select')![0]).toEqual([0])
    w.unmount()
  })
})
```

- [ ] **Step 2: Run, watch fail**

Run: `cd frontend && npx vitest run tests/unit/sketch-review-strip.unit.spec.ts -t "drag to place"`
Expected: FAIL — no dropAt / ghost.

- [ ] **Step 3: Implement the drag** — in `<script setup>` add drag state + handlers, and wire them onto the tile; add the ghost element. Add to the script:

```ts
const DRAG_THRESHOLD = 4
const drag = ref<{ index: number; x: number; y: number; started: boolean } | null>(null)

function onPointerDown(i: number, e: PointerEvent) {
  drag.value = { index: i, x: e.clientX, y: e.clientY, started: false }
}
function onPointerMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  if (!d.started && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return
  d.started = true
  d.x = e.clientX; d.y = e.clientY
}
function onPointerUp(e: PointerEvent) {
  const d = drag.value
  drag.value = null
  if (d?.started) emit('dropAt', { index: d.index, clientX: e.clientX, clientY: e.clientY })
}
// A click that followed a real drag must not also select — guard select on the fly.
function onTileClick(i: number) { emit('select', i) }
```

Wire the tile button: add `@pointerdown="onPointerDown(i, $event)" @pointermove="onPointerMove" @pointerup="onPointerUp"`, and change the click to only select when no drag started — replace `@click="emit('select', i)"` with `@click="() => { if (!draggedThisPress) onTileClick(i) }"`. Implement `draggedThisPress` by capturing whether the just-finished pointer sequence started a drag: set a `let draggedThisPress = false` ref-like flag in `onPointerUp` (`draggedThisPress = !!d?.started`) and reset it at the next `onPointerDown`. (jsdom fires click after pointerup; the test triggers click explicitly.)

Add the ghost element inside the root, after the tiles row:

```html
<div v-if="drag?.started" data-testid="sketch-ghost"
     class="pointer-events-none fixed z-50 h-[80px] w-[80px] overflow-hidden rounded-[6px] border border-white/25 shadow-[0_10px_30px_rgba(0,0,0,0.6)] -rotate-3"
     :style="{ left: drag.x + 'px', top: drag.y + 'px', transform: 'translate(-50%, -50%) rotate(-3deg)' }">
  <img :src="images[drag.index]" alt="" class="h-full w-full object-cover">
</div>
```

Make `draggedThisPress` a `ref(false)` so the template guard is reactive; update the click handler to `@click="draggedThisPress ? null : emit('select', i)"`.

- [ ] **Step 4: Run**

Run: `cd frontend && npx vitest run tests/unit/sketch-review-strip.unit.spec.ts`
Expected: PASS (all, including the earlier presentation/emit tests).

- [ ] **Step 5: Typecheck** — `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c "error TS"` = baseline.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/SketchReviewStrip.vue frontend/tests/unit/sketch-review-strip.unit.spec.ts
git commit -m "feat(sketch): drag-to-place gesture — ghost + dropAt(index, point)"
```

---

### Task 3: Wire the strip into the canvas (replace the prompt-bar pile)

Host the strip in `VueNodeCanvas.vue`. When the prompt-bar sketch batch arrives, instead of `materializeSketchPileAt(sketchPad.anchor, images)`, populate strip state and show it docked above the prompt bar. On commit, create ONE image node (Keep → keeper spot via `planKeptCard`; dropAt → `project({x:clientX,y:clientY})`), tear down the transient sketch-pad nodes, and close the strip. Cancel tears down and closes. Re-roll calls the existing refresh.

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`
- (No unit test — `VueNodeCanvas` is integration-tested live in Task 4. Any pure helper you extract gets a unit test.)

**Interfaces (consumes from Tasks 1-2):** `SketchReviewStrip` with props `images`/`selected`/`busy` and emits `hover`/`select`/`keep`/`cancel`/`reroll`/`dropAt`.

**READ THESE SEAMS FIRST** (in `VueNodeCanvas.vue`): the `sketchPad` reactive state (~line 1033) and `sketchPadAnchor()`; the run-completion branch that today calls `materializeSketchPileAt(sketchPad.anchor, tagged.images)` for `properties.sketchPad === true` (~line 2885); `materializeSketchPileAt` itself and how it (and `planKeptCard` in `sketchPile.ts`) create the on-canvas image node a kept sketch becomes — the commit MUST reuse that same node-creation path so the committed node is identical to today's kept sketch. Also `project(screenPt)` for screen→graph, and the teardown of the hidden pad node.

- [ ] **Step 1: Add strip state + mount.** Add a reactive `sketchReview` holding `{ open: boolean; images: string[]; selected: number | null }` (default closed/empty). Mount `<SketchReviewStrip>` docked above the prompt bar (same bottom-center anchor the prompt bar uses), shown only when `sketchReview.open`, bound to the state and wired to the handlers from Steps 3-6. Match the prompt-bar's horizontal centering so the strip sits directly above it.

- [ ] **Step 2: Divert the batch into the strip.** In the `properties.sketchPad === true` run-completion branch (~line 2885), REPLACE the `materializeSketchPileAt(sketchPad.anchor, tagged.images)` call with: `sketchReview.images = tagged.images.slice(0, MAX_SKETCH_ITEMS); sketchReview.selected = null; sketchReview.open = true` (and keep the `return`). Do NOT create a pile node on this path anymore. Leave the optimistic skeleton-pile creation out for this path too (if the skeleton pile is created earlier for the prompt-bar flow, remove that creation so no pile node ever appears for prompt-bar sketching — grep for where the skeleton pile is made for `sketchPad`). The `sketchPad.anchor`/pad node still exist for teardown.

- [ ] **Step 3: Keep handler.** `onKeep`: create one image node from `sketchReview.images[sketchReview.selected]` at the keeper position (reuse `planKeptCard` / the same creation path `materializeSketchPileAt` used per image, but for the single selected image at the keeper spot). Then call the teardown (Step 6) and set `sketchReview.open = false`.

- [ ] **Step 4: dropAt handler.** `onDropAt({ index, clientX, clientY })`: `const p = project({ x: clientX, y: clientY })`; create one image node from `sketchReview.images[index]` positioned at `p` (top-left offset so the node is centered under the cursor, matching how other drop-to-create paths position). Teardown + close.

- [ ] **Step 5: Cancel + Re-roll + select/hover.** `onCancel`: teardown + `sketchReview.open = false`, no node. `onReroll`: call the existing `refreshSketchPile(...)`/re-run path for the pad (same prompt+new seed) — the new batch lands via the Step-2 diversion, replacing `sketchReview.images` (keep the strip open, reset `selected = null`). `onSelect(i)`: `sketchReview.selected = i`. `onHover`: no host action needed (the strip previews internally) unless you want a canvas ghost — not required.

- [ ] **Step 6: Teardown helper.** Extract `teardownSketchReview()`: remove the hidden sketch-pad generator node (`sketchPad.padNodeId`) and any skeleton/sink nodes tied to this prompt-bar sketch; reset `sketchPad` to its empty shape. Call it from Keep, dropAt, and Cancel. Ensure no `sketchPad`/`sketchWarm`/`sketchSink`/`SKETCH_PROP` nodes for the prompt-bar flow remain after.

- [ ] **Step 7: Typecheck + commit** (live verification is Task 4).

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: baseline (no rise).

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(sketch): route prompt-bar batch into the review strip; commit one node on keep/drop"
```

---

### Task 4: Live verification + cleanup

`VueNodeCanvas` can't be unit-tested meaningfully; verify the whole flow in the browser and confirm no orphans.

**Files:** none unless a fix is needed.

- [ ] **Step 1: Start dev server** — repo root `./dev.sh` (full stack) or `cd frontend && npm run dev` (127.0.0.1:3000). Open the canvas. HARD-RELOAD.

- [ ] **Step 2: Trigger a prompt-bar sketch** — type an image idea (e.g. "a moody blue portrait, rain on glass") into the canvas prompt bar and submit. Confirm: NO pile node appears on the canvas; the review strip appears docked above the prompt bar with four sketch tiles; the canvas stays visible.

- [ ] **Step 3: Hover + select** — hover a tile → a larger preview shows above it. Click a tile → it gets the action-blue selected ring; Keep enables.

- [ ] **Step 4: Commit paths.**
  - **Keep:** with a tile selected, click Keep → exactly one image node appears at the keeper spot; the strip closes; the other three are gone.
  - Re-run, then **drag** a tile onto a chosen empty canvas spot → the ghost follows; on release, one image node lands under the cursor (verify at a non-center pan/zoom that it lands under the cursor, not offset — the `project()` correctness). Strip closes.
  - Re-run, **Cancel** → nothing lands, strip closes.
  - Re-run, **Re-roll** → four fresh sketches replace the tiles, strip stays open.

- [ ] **Step 5: Orphan check** — after each of Keep / drop / Cancel, run in the browser console: `document.querySelectorAll('[data-node-type]')` sanity, or inspect the graph — confirm no hidden sketch-pad / skeleton-pile / sink nodes linger (the committed image node should be the only thing added, and only on Keep/drop). Confirm the committed node is the same shape as a kept sketch was before (an image loader / sketch-output card).

- [ ] **Step 6: Screenshot** the strip idle and mid-drag; save to `/Users/julien/Documents/GitHub/Sailor/scratchpad/sketch-review-strip-live.png`. Fix any deviation from the spec in `SketchReviewStrip.vue` or `VueNodeCanvas.vue`, re-run `tests/unit/sketch-review-strip.unit.spec.ts` (green) and typecheck (baseline), commit any fix.

```bash
# only if a fix was needed:
git add frontend/app/components/vue-canvas/SketchReviewStrip.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "fix(sketch): review-strip live-verification adjustments"
```

---

## Self-Review

- **Spec coverage:** review strip replaces auto-placed pile (T3 §2) ✓; docked above prompt bar (T3 §1) ✓; four pure-image tiles + hover preview (T1) ✓; Keep = one node at keeper spot (T3 §3) ✓; drag-to-place = one node at projected point (T2 + T3 §4) ✓; exactly one commit closes, others discarded (T3 §3/§4) ✓; Cancel nothing (T3 §5) ✓; Re-roll four fresh (T3 §5) ✓; generation unchanged (Global Constraints; T3 §2 only diverts presentation) ✓; committed node = today's kept-sketch shape (T3 §3, Global) ✓; pan/zoom-correct drop (T2 screen coords → T3 §4 `project`) ✓; Re-roll in strip + full-sketch ghost + take-strip vocabulary (T1/T2) ✓; prompt-bar-only, Sketch node pile untouched (Global) ✓; no orphans (T3 §6, T4 §5) ✓.
- **Placeholder scan:** component tasks carry full code + exact testids/commands. Task 3 is an integration contract against named seams (VueNodeCanvas is a large existing file — full blind code is not feasible; the seams, the exact emit→action mapping, the reuse-the-existing-node-creation requirement, and the acceptance checks are all concrete). No TBD/TODO.
- **Type/name consistency:** emits `hover/select/keep/cancel/reroll/dropAt` and testids `sketch-strip/sketch-tile/sketch-tip/sketch-ghost/sketch-actions/sketch-keep/sketch-cancel/sketch-reroll` consistent across Tasks 1-3; `dropAt` payload `{index, clientX, clientY}` defined in T2 and consumed in T3 §4; `StudioButton variant="neutral"` exists (added in the take-strip work). One risk flagged for the implementer: the `draggedThisPress` click-vs-drag guard must be reactive — pin it with the two T2 tests.
