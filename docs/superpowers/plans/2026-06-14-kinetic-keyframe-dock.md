# Kinetic Keyframe Dock — Implementation Plan (Part 2b of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Work in the worktree at `.claude/worktrees/kinetic` on branch `feat/kinetic-export-keyframe-lanes`** (node_modules/.venv/.nuxt symlinked). Do NOT touch the main checkout.

**Goal:** Make the 2a keyframe foundation user-visible: a bottom-dock dope-sheet under the timeline that edits a Motion clip's keyframes — one **Transform** lane plus one lane per **font axis** — with diamond-toggle keyframing, retime-by-drag (frame-snapped), prev/next nav, and a 4-preset easing chooser; and wire it into the inspector (supersede the from→to checkbox; keep presets; add convert-to-keyframes).

**Architecture:** A new child component `KeyframeDock.vue` mounts between the timeline track lanes and the keyboard-hint strip in `TimelineEditor.vue`. It receives `pxPerFrame`/`scrollX` as props (recomputing the 1-line `framesToPx` locally — no risky extraction from the 1860-line parent) and reads the store directly for the selected clip, playhead, and dispatch. Transform keyframes (dense 5-tuple snapshots) render as ONE lane; axis keyframes (sparse, normalized `t`) render one lane per font axis. The dock dispatches the 2a commands via thin store wrappers. A new store `selectedAxisKeyframe` tracks which keyframe's easing the chooser edits.

**Tech Stack:** Vue 3 / TypeScript, Vitest (logic), browser verification (UI).

**Spec:** `docs/superpowers/specs/2026-06-13-kinetic-export-and-keyframe-lanes-design.md` (Part 2). Builds on Part 2a (`docs/superpowers/plans/2026-06-14-kinetic-keyframe-foundation.md`, already implemented: `applyEase` 4 presets, axis interpolation honors ease, 5 axis-keyframe commands).

**Design deviation from spec (deliberate):** the spec lists Transform as four sub-lanes (Position/Scale/Rotation/Opacity). The data model stores transform keyframes as **dense 5-tuple snapshots** (one keyframe = all five), so independent per-property transform lanes would require a data-model migration (+ Python mirror + golden regen) out of v1 scope. v1 = **one Transform lane** (the inspector still edits the five values at the selected keyframe). Axes ARE independent → one lane each.

---

## Background facts (verified against the worktree)

- **Mount point:** `frontend/app/components/vue-canvas/TimelineEditor.vue` — the bottom container `<div class="border-t border-white/10 flex flex-col shrink-0" :style="{height: Math.max(220, tracks.length*(TRACK_HEIGHT+TRACK_GAP)+RULER_HEIGHT+70)+'px'}">` (line ~1614) holds: transport (1617–1659), track lanes (1661–1850), keyboard hint (1852–1860). **The dock mounts between 1850 and 1852.** `TRACK_HEIGHT=56`, `TRACK_GAP=2`, `RULER_HEIGHT=22`; the `70` constant must grow by the dock's height.
- **Geometry (component-local in TimelineEditor.vue):** `pxPerFrame = ref(4)` (261), `scrollX = ref(0)` (262), `framesToPx(f) = f*pxPerFrame.value - scrollX.value` (264), `pxToFrames(px) = (px+scrollX.value)/pxPerFrame.value` (267).
- **On-clip diamond pattern (to mirror):** template at 1811–1824 (diamonds at `left: kf.frame*pxPerFrame`, `@pointerdown.stop="onKeyframePointerDown(clip.id, kf.frame, e)"`); drag state `kfDrag` + `onKeyframePointerDown` (705–722); move/up logic in `onPointerMove`/`onPointerUp` (618–632, 684–697) using `dframes = Math.round((e.clientX - startMouseX)/pxPerFrame.value)`.
- **Store (`frontend/app/composables/useTimelineStore.ts`):** `dispatch(cmd)` (92), `selectedClip`/`selectedClipId` (39–46), `fps` (computed), `playheadFrame` (computed), `clipLocalFrame(clip)` (≈179), `seekFrame(frame)`, and keyframe wrappers `addKeyframe`/`removeKeyframeAt`/`moveKeyframe`/`setKeyframeEase`/`updateClipTransform` (179–200). It exposes these on the returned object — confirm the return block lists them and add the new ones there too.
- **2a commands available:** `add_axis_keyframe`/`remove_axis_keyframe`/`move_axis_keyframe`/`set_axis_keyframe_ease`/`set_axis_keyframe_axes` (clip_id + normalized `t`).
- **Fonts:** `frontend/app/data/variable-fonts.ts` — `FontAxis {tag,label,min,max,default,step?}`; `VARIABLE_FONTS.find(f => f.family === layer.fontFamily)?.axes`. MotionClipInspector uses `fontDef()` = that find.
- **Inspector:** `frontend/app/components/vue-canvas/timeline/MotionClipInspector.vue` — the from→to block (111–139) + `setAxisAnim` (34–42) will be superseded; the in/out/loop preset selects (142–163) are KEPT.
- **No selected-keyframe concept exists** — must add.

---

## File Structure

- **Create** `frontend/app/components/vue-canvas/timeline/KeyframeDock.vue` — the dock (one responsibility: edit the selected Motion clip's keyframes on a time-aligned dope sheet).
- **Modify** `frontend/app/composables/useTimelineStore.ts` — add `selectedAxisKeyframe` state + 5 axis store wrappers + a `clipTtoFrame`/`frameToT` pair isn't needed in store (UI owns it); export the new methods.
- **Modify** `frontend/app/components/vue-canvas/TimelineEditor.vue` — mount `<KeyframeDock>` + pass `pxPerFrame`/`scrollX`; grow the height constant.
- **Create** `frontend/app/lib/timeline/convertPresetToKeyframes.ts` — pure helper turning a layer's in/out/loop preset + from→to into explicit axis keyframes (unit-tested).
- **Modify** `frontend/app/components/vue-canvas/timeline/MotionClipInspector.vue` — replace the from→to checkbox with a per-axis "keyframe in dock" affordance; add "Convert preset → keyframes" button.
- **Test (create)** `frontend/tests/unit/timeline-store-axis-kf.unit.spec.ts`, `frontend/tests/unit/convert-preset.unit.spec.ts`.

---

### Task 1: Store — axis-keyframe wrappers + selected-keyframe state

**Files:**
- Modify: `frontend/app/composables/useTimelineStore.ts`
- Test: `frontend/tests/unit/timeline-store-axis-kf.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/timeline-store-axis-kf.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { useTimelineStore } from '../../app/composables/useTimelineStore'
import type { MotionClip } from '../../shared/timeline/types'

function setup() {
  const store = useTimelineStore()
  store.addTrack('video')
  const trackId = store.state.value.tracks[store.state.value.tracks.length - 1]!.id
  const clip: MotionClip = {
    id: 'm1', kind: 'motion', start_frame: 0, in_frame: 0, length: 90,
    x: 0, y: 0, rotation: 0, scale: 1, opacity: 1,
    layer: { id: 'l', kind: 'text', text: 'AB', fontFamily: 'Inter', fontSize: 0.1, color: '#fff', align: 'center' },
  }
  store.addClip(trackId, clip)
  return { store }
}

describe('store axis-keyframe wrappers', () => {
  it('addAxisKeyframe + setAxisKeyframeEase mutate the layer', () => {
    const { store } = setup()
    store.addAxisKeyframe('m1', 0, { wght: 100 })
    store.addAxisKeyframe('m1', 1, { wght: 900 })
    store.setAxisKeyframeEase('m1', 0, 'power2.out')
    const clip = store.state.value.tracks.at(-1)!.clips[0] as MotionClip
    expect(clip.layer.axisKeyframes!.map(k => k.t)).toEqual([0, 1])
    expect(clip.layer.axisKeyframes![0]!.ease).toBe('power2.out')
  })
  it('moveAxisKeyframe + removeAxisKeyframeAt work', () => {
    const { store } = setup()
    store.addAxisKeyframe('m1', 0, { wght: 100 })
    store.moveAxisKeyframe('m1', 0, 0.5)
    expect((store.state.value.tracks.at(-1)!.clips[0] as MotionClip).layer.axisKeyframes![0]!.t).toBe(0.5)
    store.removeAxisKeyframeAt('m1', 0.5)
    expect((store.state.value.tracks.at(-1)!.clips[0] as MotionClip).layer.axisKeyframes).toBeUndefined()
  })
  it('selectedAxisKeyframe resolves from selection + t', () => {
    const { store } = setup()
    store.selectedClipId.value = 'm1'
    store.addAxisKeyframe('m1', 0.25, { wght: 400 })
    store.selectedAxisKeyframeT.value = 0.25
    expect(store.selectedAxisKeyframe.value?.axes.wght).toBe(400)
  })
})
```

(If `useTimelineStore` is a singleton/composable that shares state across calls, adapt `setup()` to reset — check how existing store unit tests, if any, instantiate it. If there are none, this isolated-instance shape is the contract to honor.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/timeline-store-axis-kf.unit.spec.ts`
Expected: FAIL — `addAxisKeyframe` etc. are not functions; `selectedAxisKeyframeT` undefined.

- [ ] **Step 3: Add the state + wrappers**

In `useTimelineStore.ts`, near `selectedClipId` (~line 16) add:

```ts
const selectedAxisKeyframeT = ref<number | null>(null)  // normalized t of the keyframe whose easing the dock edits
```

Near `selectedClip` (~line 46) add:

```ts
const selectedAxisKeyframe = computed(() => {
  const c = selectedClip.value
  if (!c || c.kind !== 'motion' || selectedAxisKeyframeT.value === null) return null
  const layer = (c as MotionClip).layer
  return layer.axisKeyframes?.find(k => Math.abs(k.t - selectedAxisKeyframeT.value!) < 1e-4) ?? null
})
```

(Ensure `MotionClip` is imported in this file; add to the existing `shared/timeline/types` import if missing.)

Near the existing keyframe methods (~line 200) add:

```ts
function addAxisKeyframe(clipId: string, t: number, axes: Record<string, number>) {
  dispatch({ type: 'add_axis_keyframe', clip_id: clipId, t: Math.max(0, Math.min(1, t)), axes })
}
function removeAxisKeyframeAt(clipId: string, t: number) {
  dispatch({ type: 'remove_axis_keyframe', clip_id: clipId, t })
}
function moveAxisKeyframe(clipId: string, fromT: number, toT: number) {
  dispatch({ type: 'move_axis_keyframe', clip_id: clipId, from_t: fromT, to_t: Math.max(0, Math.min(1, toT)) })
}
function setAxisKeyframeEase(clipId: string, t: number, ease: string) {
  dispatch({ type: 'set_axis_keyframe_ease', clip_id: clipId, t, ease })
}
function setAxisKeyframeAxes(clipId: string, t: number, axes: Record<string, number>) {
  dispatch({ type: 'set_axis_keyframe_axes', clip_id: clipId, t, axes })
}
```

Add all six names (`selectedAxisKeyframeT`, `selectedAxisKeyframe`, and the 5 functions) to the store's returned object (the `return { ... }` block at the end).

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/timeline-store-axis-kf.unit.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useTimelineStore.ts frontend/tests/unit/timeline-store-axis-kf.unit.spec.ts
git commit -m "feat(timeline): store axis-keyframe wrappers + selected-keyframe state"
```

---

### Task 2: Convert-preset-to-keyframes helper (pure)

**Files:**
- Create: `frontend/app/lib/timeline/convertPresetToKeyframes.ts`
- Test: `frontend/tests/unit/convert-preset.unit.spec.ts`

The "Convert preset → keyframes" action bakes a layer's current from→to axis animation (the legacy 2-keyframe `axisKeyframes`) into an explicit, editable keyframe set. v1 scope: it simply returns the existing `axisKeyframes` normalized (sorted, clamped, default ease filled) — the conversion point is where richer preset→keyframe expansion lands later. Keeping it a pure function makes it testable and keeps the inspector thin.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/convert-preset.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeAxisKeyframes } from '../../app/lib/timeline/convertPresetToKeyframes'

describe('normalizeAxisKeyframes', () => {
  it('sorts by t, clamps to [0,1], fills default ease', () => {
    const out = normalizeAxisKeyframes([
      { t: 1.2, axes: { wght: 900 } },
      { t: -0.1, axes: { wght: 100 }, ease: 'power2.in' },
    ])
    expect(out.map(k => k.t)).toEqual([0, 1])
    expect(out[0]!.ease).toBe('power2.in')
    expect(out[1]!.ease).toBe('linear')   // default filled
  })
  it('returns [] for empty/undefined', () => {
    expect(normalizeAxisKeyframes(undefined)).toEqual([])
    expect(normalizeAxisKeyframes([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/convert-preset.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/app/lib/timeline/convertPresetToKeyframes.ts`:

```ts
import type { MotionAxisKeyframe } from '~~/shared/timeline/types'

/** Normalize a layer's axis keyframes into an explicit, editable set: clamp t to
 *  [0,1], sort, and fill a default ease so every keyframe is fully specified.
 *  This is the seam the dock's "Convert preset → keyframes" action calls; richer
 *  preset expansion (in/out/loop → keyframes) can grow here later. */
export function normalizeAxisKeyframes(kfs: MotionAxisKeyframe[] | undefined): MotionAxisKeyframe[] {
  if (!kfs || !kfs.length) return []
  return kfs
    .map(k => ({ t: Math.max(0, Math.min(1, k.t)), axes: { ...k.axes }, ease: k.ease ?? 'linear' }))
    .sort((a, b) => a.t - b.t)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/convert-preset.unit.spec.ts`
Expected: PASS (2 tests). (If the `~~/shared` alias fails under vitest, use the relative import `'../../../shared/timeline/types'` — type-only import, so it's erased at runtime regardless.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/timeline/convertPresetToKeyframes.ts frontend/tests/unit/convert-preset.unit.spec.ts
git commit -m "feat(timeline): normalizeAxisKeyframes helper for convert-to-keyframes"
```

---

### Task 3: KeyframeDock component — shell + lanes + diamonds (display)

**Files:**
- Create: `frontend/app/components/vue-canvas/timeline/KeyframeDock.vue`
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue` (mount + height)

Browser-verified (no unit test for the Vue component). This task makes the dock VISIBLE: it shows the selected Motion clip's Transform lane + one lane per font axis, time-aligned to the timeline, with keyframe diamonds. Editing comes in Tasks 4–6.

- [ ] **Step 1: Create the component (display-only)**

Create `frontend/app/components/vue-canvas/timeline/KeyframeDock.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useTimelineStore } from '~/composables/useTimelineStore'
import { VARIABLE_FONTS } from '~/data/variable-fonts'
import type { MotionClip } from '~~/shared/timeline/types'

const props = defineProps<{ pxPerFrame: number; scrollX: number }>()
const store = useTimelineStore()

// Same mapping as the timeline strip so the dock aligns to the ruler/playhead.
function framesToPx(frame: number): number { return frame * props.pxPerFrame - props.scrollX }

const clip = computed<MotionClip | null>(() => {
  const c = store.selectedClip.value
  return c && c.kind === 'motion' ? (c as MotionClip) : null
})

// Font axes for this clip's font (the Axes group).
const axes = computed(() => {
  const f = clip.value && VARIABLE_FONTS.find(v => v.family === clip.value!.layer.fontFamily)
  return f ? f.axes : []
})

// Transform-lane diamonds: clip-local frame → timeline-global px.
const transformKfs = computed(() => clip.value?.keyframes ?? [])
// Axis-lane diamonds: normalized t → clip-local frame → px.
function axisKfsFor(tag: string) {
  const c = clip.value
  if (!c) return []
  return (c.layer.axisKeyframes ?? []).filter(k => tag in k.axes)
}
function tToFrame(t: number): number { return (clip.value?.start_frame ?? 0) + t * (clip.value?.length ?? 1) }
</script>

<template>
  <div v-if="clip" class="border-t border-white/10 bg-[#141416] flex flex-col" style="height: 150px">
    <div class="flex items-center gap-2 px-3 h-7 border-b border-white/5 text-[10px] uppercase tracking-[0.12em] text-white/40 shrink-0">
      ◆ Keyframes — {{ clip.layer.text || 'Motion' }}
    </div>
    <div class="flex-1 overflow-y-auto">
      <!-- Transform group (single lane: keyframes are 5-tuple snapshots) -->
      <div class="px-3 pt-1.5 text-[9px] uppercase tracking-[0.08em] text-white/35">Transform</div>
      <div class="relative h-5 mx-3 border-b border-white/5">
        <div class="absolute left-0 top-1.5 w-20 text-[10px] text-white/55">Transform</div>
        <div class="absolute left-24 right-3 top-2.5 h-px bg-white/10" />
        <div
          v-for="kf in transformKfs" :key="`tf-${kf.frame}`"
          class="absolute top-1.5 size-2 rotate-45 bg-violet-100 border border-black/50 -translate-x-1/2"
          :style="{ left: framesToPx(clip.start_frame + kf.frame) + 'px' }"
        />
      </div>
      <!-- Axes group (one lane per font axis) -->
      <div class="px-3 pt-1.5 text-[9px] uppercase tracking-[0.08em] text-white/35">Axes</div>
      <div v-for="ax in axes" :key="ax.tag" class="relative h-5 mx-3 border-b border-white/5">
        <div class="absolute left-0 top-1.5 w-20 text-[10px] text-white/55">{{ ax.label }}</div>
        <div class="absolute left-24 right-3 top-2.5 h-px bg-white/10" />
        <div
          v-for="kf in axisKfsFor(ax.tag)" :key="`${ax.tag}-${kf.t}`"
          class="absolute top-1.5 size-2 rotate-45 bg-emerald-200 border border-black/50 -translate-x-1/2"
          :style="{ left: framesToPx(tToFrame(kf.t)) + 'px' }"
        />
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Mount it in TimelineEditor.vue**

Import it in the `<script setup>` of `TimelineEditor.vue`:

```ts
import KeyframeDock from '~/components/vue-canvas/timeline/KeyframeDock.vue'
```

Insert the dock between the track-lanes block (ends ~line 1850) and the keyboard-hint block (starts ~line 1852):

```vue
    <KeyframeDock :px-per-frame="pxPerFrame" :scroll-x="scrollX" />
```

Grow the bottom-section height constant so the dock fits — change the `+ 70` in the height style (line ~1614) to `+ 70 + (store.selectedClip.value?.kind === 'motion' ? 158 : 0)` so the section expands only when a Motion clip is selected (dock height 150 + 8 margin).

- [ ] **Step 3: Browser-verify display**

Start backend + frontend (see Task 7 of the export plan for commands; the dev server on :3002 HMRs this). In the timeline editor, select a Kinetic Text clip → the dock appears under the tracks showing a Transform lane + one lane per the font's axes, with the existing axis keyframes (the from→to pair) as emerald diamonds aligned under the timeline ruler. Resize/zoom the timeline → diamonds track the ruler. Confirm no console errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/timeline/KeyframeDock.vue frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(timeline): KeyframeDock shell — Transform + Axes lanes (display)"
```

---

### Task 4: Diamond-toggle add/remove + seek + nav arrows

**Files:**
- Modify: `frontend/app/components/vue-canvas/timeline/KeyframeDock.vue`

Each lane gets a left-side control cluster: prev (◀) · diamond-toggle (◆) · next (▶). The diamond is filled when a keyframe exists at the playhead; clicking it adds (at the playhead, capturing current values) or removes that keyframe. Arrows seek to the prev/next keyframe on that lane.

- [ ] **Step 1: Add per-lane controls + handlers**

In `KeyframeDock.vue` `<script setup>`, add (uses 2a store wrappers from Task 1, and `interpolateAxes` to capture current axis values):

```ts
import { interpolateAxes } from '~/lib/motion/axes'

const fps = computed(() => store.fps.value)
function localPlayhead(): number {
  const c = clip.value!; return Math.max(0, Math.min(store.playheadFrame.value - c.start_frame, c.length - 1))
}
function playheadT(): number { const c = clip.value!; return c.length > 0 ? localPlayhead() / c.length : 0 }

// ---- Transform lane ----
function transformKfAtPlayhead() { return transformKfs.value.find(k => k.frame === localPlayhead()) }
function toggleTransformKf() {
  const c = clip.value!; const k = transformKfAtPlayhead()
  if (k) store.removeKeyframeAt(c.id, k.frame)
  else store.addKeyframe(c.id)   // captures current transform at playhead (2a/existing)
}

// ---- Axis lanes ----
function axisKfAtPlayhead(tag: string) {
  const t = playheadT()
  return (clip.value?.layer.axisKeyframes ?? []).find(k => Math.abs(k.t - t) < 1e-4 && tag in k.axes)
}
function toggleAxisKf(tag: string, axDefault: number) {
  const c = clip.value!; const t = playheadT()
  const existing = axisKfAtPlayhead(tag)
  if (existing) {
    // remove just this axis from the keyframe; drop the keyframe if it becomes empty
    const remaining = { ...existing.axes }; delete remaining[tag]
    if (Object.keys(remaining).length) store.setAxisKeyframeAxes(c.id, existing.t, remaining)
    else store.removeAxisKeyframeAt(c.id, existing.t)
  } else {
    // capture the current interpolated value for this axis so toggling on doesn't jump
    const cur = interpolateAxes((c.layer.axisKeyframes ?? []) as any, t, c.layer.axes ?? {})
    store.addAxisKeyframe(c.id, t, { [tag]: cur[tag] ?? c.layer.axes?.[tag] ?? axDefault })
  }
}

// ---- Nav ----
function seekToFrame(localFrame: number) { store.seekFrame(clip.value!.start_frame + localFrame) }
function navTransform(dir: 1 | -1) {
  const cur = localPlayhead()
  const frames = transformKfs.value.map(k => k.frame).sort((a, b) => a - b)
  const next = dir > 0 ? frames.find(f => f > cur) : [...frames].reverse().find(f => f < cur)
  if (next !== undefined) seekToFrame(next)
}
function navAxis(tag: string, dir: 1 | -1) {
  const cur = playheadT()
  const ts = axisKfsFor(tag).map(k => k.t).sort((a, b) => a - b)
  const next = dir > 0 ? ts.find(t => t > cur + 1e-4) : [...ts].reverse().find(t => t < cur - 1e-4)
  if (next !== undefined) seekToFrame(Math.round(next * clip.value!.length))
}
```

- [ ] **Step 2: Add the control cluster to each lane template**

Replace each lane's left label area with a nav+toggle cluster. Transform lane:

```vue
        <div class="absolute left-0 top-0.5 flex items-center gap-1">
          <button class="text-white/40 hover:text-white text-[10px]" @click="navTransform(-1)">◀</button>
          <button class="size-2.5 rotate-45 border" :class="transformKfAtPlayhead() ? 'bg-yellow-300 border-yellow-500' : 'border-white/40 hover:border-white'" @click="toggleTransformKf()" />
          <button class="text-white/40 hover:text-white text-[10px]" @click="navTransform(1)">▶</button>
          <span class="text-[10px] text-white/55 ml-1">Transform</span>
        </div>
```

Axis lane (inside the `v-for="ax in axes"`):

```vue
        <div class="absolute left-0 top-0.5 flex items-center gap-1">
          <button class="text-white/40 hover:text-white text-[10px]" @click="navAxis(ax.tag, -1)">◀</button>
          <button class="size-2.5 rotate-45 border" :class="axisKfAtPlayhead(ax.tag) ? 'bg-yellow-300 border-yellow-500' : 'border-white/40 hover:border-white'" @click="toggleAxisKf(ax.tag, ax.default)" />
          <button class="text-white/40 hover:text-white text-[10px]" @click="navAxis(ax.tag, 1)">▶</button>
          <span class="text-[10px] text-white/55 ml-1">{{ ax.label }}</span>
        </div>
```

(Shift the diamond rows' `left-24` track start if needed so diamonds don't overlap the cluster — widen the label gutter to ~`left-32`/`w-32` and start the track at the same offset; keep the cluster and the track-line left offsets equal.)

- [ ] **Step 3: Browser-verify**

Select a kinetic clip, move the playhead, click an axis lane's ◆ → an emerald diamond appears at the playhead; click again → it's removed. The ◆ fills yellow when the playhead sits on a keyframe. ◀/▶ jump the playhead between keyframes. Toggle the Transform ◆ → a violet diamond appears (and the existing on-clip transform diamonds at 1811–1824 also reflect it). Re-export (per the export plan) and confirm the new keyframes animate in the output. Console clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/timeline/KeyframeDock.vue
git commit -m "feat(timeline): dock diamond-toggle add/remove + keyframe nav"
```

---

### Task 5: Drag-to-retime with frame snapping

**Files:**
- Modify: `frontend/app/components/vue-canvas/timeline/KeyframeDock.vue`

Mirror the parent's `kfDrag` pattern (TimelineEditor.vue 705–722, 618–632). Diamonds become draggable; dragging converts pixel delta → frame delta → (for axes) normalized `t`, snapped to whole frames, and dispatches move commands. Skip a drag that would land on an occupied slot (the move-collision note from the 2a review).

- [ ] **Step 1: Add drag state + window listeners**

In `KeyframeDock.vue` `<script setup>`:

```ts
import { ref, onMounted, onBeforeUnmount } from 'vue'

type Drag =
  | { kind: 'transform'; fromFrame: number; startX: number; startFrame: number }
  | { kind: 'axis'; tag: string; fromT: number; startX: number; startFrame: number }
const drag = ref<Drag | null>(null)

function onTransformDown(frame: number, e: PointerEvent) {
  e.stopPropagation(); drag.value = { kind: 'transform', fromFrame: frame, startX: e.clientX, startFrame: frame }
}
function onAxisDown(tag: string, t: number, e: PointerEvent) {
  e.stopPropagation(); drag.value = { kind: 'axis', tag, fromT: t, startX: e.clientX, startFrame: Math.round(t * clip.value!.length) }
}
function onMove(e: PointerEvent) {
  const d = drag.value, c = clip.value; if (!d || !c) return
  const dframes = Math.round((e.clientX - d.startX) / props.pxPerFrame)
  if (d.kind === 'transform') {
    const target = Math.max(0, Math.min(d.startFrame + dframes, c.length - 1))
    if (target !== d.fromFrame && !c.keyframes?.some(k => k.frame === target)) {
      store.moveKeyframe(c.id, d.fromFrame, target); d.fromFrame = target; store.seekFrame(c.start_frame + target)
    }
  } else {
    const targetFrame = Math.max(0, Math.min(d.startFrame + dframes, c.length - 1))
    const targetT = c.length > 0 ? targetFrame / c.length : 0
    if (Math.abs(targetT - d.fromT) > 1e-4 && !(c.layer.axisKeyframes ?? []).some(k => Math.abs(k.t - targetT) < 1e-4)) {
      store.moveAxisKeyframe(c.id, d.fromT, targetT); d.fromT = targetT; store.seekFrame(c.start_frame + targetFrame)
    }
  }
}
function onUp() { drag.value = null }
onMounted(() => { window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp) })
onBeforeUnmount(() => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) })
```

- [ ] **Step 2: Wire diamonds to the drag + select-on-click**

On the Transform diamond add `@pointerdown.stop="(e) => onTransformDown(kf.frame, e)"` and `cursor-grab`. On the Axis diamond add `@pointerdown.stop="(e) => { onAxisDown(ax.tag, kf.t, e); store.selectedClipId.value = clip!.id; store.selectedAxisKeyframeT.value = kf.t }"` and `cursor-grab`. (Selecting the axis keyframe on pointer-down feeds Task 6's easing chooser.)

- [ ] **Step 3: Browser-verify**

Drag an axis diamond left/right → it retimes, snapping to whole frames, playhead follows; dropping onto another keyframe's frame is prevented (no overwrite). Drag a Transform diamond similarly. Re-export → retimed animation reflects in output. Console clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/timeline/KeyframeDock.vue
git commit -m "feat(timeline): dock drag-to-retime with frame snapping"
```

---

### Task 6: Per-keyframe easing chooser (4 presets)

**Files:**
- Modify: `frontend/app/components/vue-canvas/timeline/KeyframeDock.vue`

When an axis keyframe is selected (Task 5 sets `selectedAxisKeyframeT`), show a small ease chooser with the 4 presets; clicking sets the keyframe's ease via the 2a command. (Transform-keyframe ease editing already exists in the inspector keyframe list — out of scope here.)

- [ ] **Step 1: Add the chooser**

In `KeyframeDock.vue`, add to `<script setup>`:

```ts
const EASE_PRESETS: { label: string; value: string }[] = [
  { label: 'Linear', value: 'linear' },
  { label: 'In', value: 'power2.in' },
  { label: 'Out', value: 'power2.out' },
  { label: 'In-Out', value: 'easeInOut' },
]
function setSelectedEase(value: string) {
  const c = clip.value, sel = store.selectedAxisKeyframe.value
  if (c && sel) store.setAxisKeyframeEase(c.id, sel.t, value)
}
```

Add to the dock header row (so it's always visible when a keyframe is selected):

```vue
      <div v-if="store.selectedAxisKeyframe.value" class="ml-auto flex items-center gap-1">
        <span class="text-white/35 normal-case tracking-normal">ease</span>
        <button
          v-for="p in EASE_PRESETS" :key="p.value"
          class="px-1.5 py-0.5 rounded text-[10px] normal-case tracking-normal"
          :class="(store.selectedAxisKeyframe.value!.ease ?? 'linear') === p.value ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'"
          @click="setSelectedEase(p.value)"
        >{{ p.label }}</button>
      </div>
```

- [ ] **Step 2: Browser-verify**

Click an axis diamond → the ease chooser appears in the dock header with the keyframe's current ease highlighted. Pick "Out" → re-export → the segment from that keyframe eases out (verify the animation curve changed; the value at mid-segment differs from linear). Console clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/timeline/KeyframeDock.vue
git commit -m "feat(timeline): dock per-keyframe easing chooser (4 presets)"
```

---

### Task 7: Inspector integration — supersede from→to, add convert

**Files:**
- Modify: `frontend/app/components/vue-canvas/timeline/MotionClipInspector.vue`

The dock now owns multi-keyframe axis animation, so the inspector's coarse from→to checkbox is redundant and confusing. Replace it with a short hint + a "Convert preset → keyframes" button (using Task 2's helper). KEEP the in/out/loop preset selects and the base-value sliders.

- [ ] **Step 1: Remove the from→to block, add convert**

In `MotionClipInspector.vue`, delete the from→to block (the `animate` checkbox + from/to number inputs, ~lines 111–139) and the now-unused `setAxisAnim`/`axisFrom`/`axisTo`/`axisAnimated` helpers (~lines 27–42) IF they're unused after removal (grep first; remove only what's dead).

Add, near the Axes group header, a single action:

```vue
    <button
      class="w-full mt-1 px-2 py-1 rounded text-[10px] bg-white/5 text-white/60 hover:bg-white/10"
      @click="convertToKeyframes()"
    >Edit axis animation in keyframe dock ↓</button>
```

In `<script setup>`:

```ts
import { normalizeAxisKeyframes } from '~/lib/timeline/convertPresetToKeyframes'

function convertToKeyframes() {
  // Normalize existing axis keyframes (from→to or otherwise) into an explicit,
  // editable set, then select the clip so the dock shows them.
  patchLayer({ axisKeyframes: normalizeAxisKeyframes(L().axisKeyframes) })
  store.selectedClipId.value = props.clip.id   // adapt to how this component references the clip + store
}
```

(Match the component's real `patchLayer`/clip/store access — read the top of the file. If it has no `store` handle, dispatch via the existing patch path it already uses.)

- [ ] **Step 2: Browser-verify**

Select a kinetic clip → inspector shows base-value sliders + in/out/loop presets + the "Edit axis animation in keyframe dock" button; the old animate checkbox/from→to inputs are gone. Click the button → the dock reflects the (normalized) keyframes. Existing clips created with the old from→to still load and animate (back-compat). Console clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/timeline/MotionClipInspector.vue
git commit -m "feat(timeline): inspector hands axis animation to the keyframe dock"
```

---

### Task 8: Full browser acceptance + regression sweep

**Files:** none.

- [ ] **Step 1: Unit regression**

Run: `cd frontend && npx vitest run tests/unit/interpolate.unit.spec.ts tests/unit/motion-axes.unit.spec.ts tests/unit/commands.unit.spec.ts tests/unit/timeline-store-axis-kf.unit.spec.ts tests/unit/convert-preset.unit.spec.ts tests/unit/motion-clip-render.unit.spec.ts tests/unit/motion-clip-bake.unit.spec.ts`
Expected: all PASS.

- [ ] **Step 2: End-to-end in-app**

Author a kinetic clip; in the dock: add 3 weight keyframes at different frames with different values, set easing on the middle one, drag one to retime, delete one. Scrub the playhead → preview shows the multi-keyframe weight animation. Export → confirm the exported video shows the same multi-keyframe animation (the bake reads `axisKeyframes` via `interpolateAxes`, which now honors ease). Confirm the on-clip transform diamonds and dock stay in sync.

- [ ] **Step 3: Note results** in the PR description (no code commit).

---

## Self-Review

**Spec coverage (Part 2b):**
- Bottom-dock dope sheet, time-aligned → Task 3 (mount, `framesToPx` via props, ruler-aligned). ✓
- Transform + Axes groups → Task 3 (Transform single lane per the documented data-model deviation; Axes one lane per font axis). ✓
- Diamond-toggle keyframing → Task 4. ✓
- Nav arrows (◀◆▶) → Task 4. ✓
- Drag-to-retime + frame snapping → Task 5 (mirrors parent `kfDrag`; rounds to whole frames; blocks occupied-slot landings, closing the 2a-review note). ✓
- 4-preset easing chooser → Task 6 (emits `linear`/`power2.in`/`power2.out`/`easeInOut` — exactly the 2a names). ✓
- Presets coexist + convert → Task 7 (keeps in/out/loop selects; adds convert via Task 2 helper). ✓
- On-clip dots → transform dots already exist (TimelineEditor 1811–1824); axis on-clip dots deferred (the dock provides the editing surface; noted, not silently dropped). 
- Color lane → out of scope (spec). ✓
- Auto-key → out of scope (spec, post-v1). ✓

**Placeholder scan:** logic tasks (1, 2) are TDD with complete code; component tasks (3–7) give concrete Vue with exact store/command calls + mirror the existing diamond/drag patterns, verified in-browser. The "adapt to the component's real store/patch access" notes (Tasks 1, 7) are concrete lookups against existing files, not placeholders.

**Type consistency:** store wrappers (Task 1) dispatch the exact 2a command shapes (`t`, `from_t`/`to_t`, `axes`, `ease: string`). `selectedAxisKeyframeT`/`selectedAxisKeyframe` defined in Task 1, consumed in Tasks 5–6. `framesToPx` recomputed in the dock from `pxPerFrame`/`scrollX` props matches the parent's formula exactly. Ease preset values match 2a (`power2.in`/`power2.out`/`easeInOut`).

**Scope check:** one cohesive deliverable (the dock + its wiring). Logic is unit-tested; UI is browser-verified — appropriate for a Vue dope-sheet.

---

## Notes / follow-ups (post-2b)

- Axis on-clip dots (mirror the transform diamonds for axis keyframes) if users want keyframe markers on the clip itself.
- Auto-key toggle (AE stopwatch) — deferred per spec.
- Per-property transform lanes would need a transform-keyframe data-model migration (+ Python mirror + golden regen).
- Optional later cleanup: extract `framesToPx`/`ticks`/`pxPerFrame`/`scrollX` into a `useTimelineGeometry` composable shared by the timeline strip and the dock (avoided here to not refactor the 1860-line parent).
