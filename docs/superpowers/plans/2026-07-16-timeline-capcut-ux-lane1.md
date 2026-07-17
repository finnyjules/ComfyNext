# Timeline CapCut-Comfort UX — Lane 1 + Slice 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Timeline editor feel native to a CapCut user — gesture-level undo, copy/paste, cross-track drag, context menus, honest trimming, marquee selection, fade handles, seconds-first display — and promote the WebGL preview engine to default.

**Architecture:** All Lane 1 work lives in `TimelineEditor.vue` plus small additions to `useTimelineStore.ts` (gesture transactions, clipboard) and one new menu component. Every mutation continues to flow through the existing command layer / `mutate()`, so undo and widget persistence come for free. Slice 0 flips one flag check and updates its Playwright spec.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript + Tailwind (Nuxt 4), vitest for store logic (`frontend/tests/unit/*.unit.spec.ts`), Playwright for e2e (`frontend/tests/*.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-07-16-timeline-capcut-ux-design.md`
**Deferred:** Lane 2 Slices 1–3 (speed/reverse, transitions, filters) get their own plans — each spans WebGL + Python + golden fixtures.

## Global Constraints

- Internal time model stays **frames**; seconds conversion happens only at display/input edges, rounding to whole frames.
- Every user-visible mutation must be **one undo step per gesture** (Task 1's transaction API; later tasks must use it for any new drag).
- Commit directly to `main`; stage only files this plan touches (parallel sessions may share the worktree — use `git add <paths>`, never `git add -A`).
- The typecheck baseline is ~328 pre-existing errors — do not gate on full `nuxi typecheck`; gate on vitest, targeted Playwright, and the dev-server compile check.
- Dev servers: frontend `cd frontend && npm run dev` (or `./dev.sh` to reap strays); use `127.0.0.1`, not `localhost`.
- Unit tests: `cd frontend && npx vitest run tests/unit/<file>` . E2E: `cd frontend && npx playwright test tests/<file>` (Playwright config manages servers; backend must be reachable).

---

### Task 1: Gesture transactions — one undo step per drag

**Files:**
- Modify: `frontend/app/composables/useTimelineStore.ts` (pushUndo/dispatch, new beginGesture/endGesture)
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue` (wrap pointer drags)
- Test: `frontend/tests/unit/timeline-gesture.unit.spec.ts` (create)

**Interfaces:**
- Produces: `store.beginGesture(): void`, `store.endGesture(): void` — later tasks (4, 7) wrap their new drags with these.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/timeline-gesture.unit.spec.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTimelineStore } from '../../app/composables/useTimelineStore'
import type { ImageClip } from '../../shared/timeline/types'

function img(id: string, start: number, length: number): ImageClip {
  return { id, kind: 'image', asset_id: `asset-${id}`, start_frame: start, in_frame: 0, length }
}

describe('gesture transactions', () => {
  const store = useTimelineStore()

  beforeEach(() => {
    // bind() resets state and both history stacks
    store.bind('test-node', () => undefined, () => {})
  })

  it('coalesces many dispatches into one undo step', () => {
    const trackId = store.state.value.tracks[0]!.id
    store.addClip(trackId, img('a', 0, 30))          // 1 undo step
    store.beginGesture()
    for (let f = 1; f <= 20; f++) store.updateClip('a', { start_frame: f })
    store.endGesture()                                // 1 more undo step
    expect(store.state.value.tracks[0]!.clips[0]!.start_frame).toBe(20)
    store.undo()                                      // undoes the WHOLE drag
    expect(store.state.value.tracks[0]!.clips[0]!.start_frame).toBe(0)
    store.undo()                                      // undoes the add
    expect(store.state.value.tracks[0]!.clips).toHaveLength(0)
    expect(store.canUndo.value).toBe(false)
  })

  it('endGesture with no changes pushes nothing', () => {
    store.beginGesture()
    store.endGesture()
    expect(store.canUndo.value).toBe(false)
  })

  it('a failed dispatch inside a gesture does not corrupt history', () => {
    const trackId = store.state.value.tracks[0]!.id
    store.addClip(trackId, img('a', 0, 30))
    store.beginGesture()
    store.updateClip('ghost', { start_frame: 5 })    // applyCommand returns false
    store.updateClip('a', { start_frame: 5 })
    store.endGesture()
    store.undo()
    expect(store.state.value.tracks[0]!.clips[0]!.start_frame).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/timeline-gesture.unit.spec.ts`
Expected: FAIL — `store.beginGesture is not a function`

- [ ] **Step 3: Implement in the store**

In `useTimelineStore.ts`, replace `pushUndo` and `dispatch`, and add the gesture pair (module scope, next to the other module-level refs):

```ts
// One undo step per pointer gesture: beginGesture() snapshots once and
// suppresses per-dispatch snapshots until endGesture(), which pushes the
// single base snapshot iff anything actually changed.
let gestureBase: string | null = null

function pushUndo(): boolean {
  if (gestureBase !== null) return false
  undoStack.value.push(JSON.stringify(state.value))
  if (undoStack.value.length > MAX_UNDO) undoStack.value.shift()
  redoStack.value = []
  return true
}
```

Inside `useTimelineStore()`:

```ts
function beginGesture() {
  if (gestureBase !== null) return
  gestureBase = JSON.stringify(state.value)
}

function endGesture() {
  if (gestureBase === null) return
  const base = gestureBase
  gestureBase = null
  if (base === JSON.stringify(state.value)) return
  undoStack.value.push(base)
  if (undoStack.value.length > MAX_UNDO) undoStack.value.shift()
  redoStack.value = []
}
```

`dispatch` must only pop when *it* pushed (a suppressed push must not pop someone else's entry):

```ts
function dispatch(cmd: TimelineCommand) {
  const pushed = pushUndo()
  let changed = false
  try {
    changed = applyCommand(state.value, cmd)
  } finally {
    if (!changed && pushed) undoStack.value.pop()
  }
  if (changed) syncToWidget()
}
```

Export `beginGesture` and `endGesture` from the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/timeline-gesture.unit.spec.ts tests/unit/timeline-store-axis-kf.unit.spec.ts tests/unit/commands.unit.spec.ts`
Expected: PASS (all three — the last two prove no regression)

- [ ] **Step 5: Wire the editor's drags**

In `TimelineEditor.vue`:
- `onClipPointerDown` (all three modes) and `onKeyframePointerDown`: add `store.beginGesture()` after the early-returns.
- `onTrackResizeStart` / `onTrackReorderStart`: add `store.beginGesture()` before setting the drag ref.
- `onPointerUp`: add `store.endGesture()` in both the kfDrag branch and the main branch.
- `onGlobalPointerUp`: add `store.endGesture()` after the two `End()` calls.

(Playhead drags never mutate `state`, so `endGesture` after one is a harmless no-op.)

- [ ] **Step 6: Manual verify + commit**

Dev server → open a Timeline node → drag a clip ~2 seconds along the strip → press ⌘Z **once** → clip returns to its origin (not pixel-by-pixel). Then:

```bash
git add frontend/app/composables/useTimelineStore.ts frontend/app/components/vue-canvas/TimelineEditor.vue frontend/tests/unit/timeline-gesture.unit.spec.ts
git commit -m "feat(timeline): one undo step per drag gesture"
```

---

### Task 2: Clipboard — copy / paste / duplicate

**Files:**
- Modify: `frontend/app/composables/useTimelineStore.ts`
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue` (keyboard)
- Test: `frontend/tests/unit/timeline-clipboard.unit.spec.ts` (create)

**Interfaces:**
- Produces: `store.copyClips(ids: Iterable<string>): number`, `store.pasteClips(atFrame: number): string[]` (returns new clip ids), `store.duplicateClips(ids: Iterable<string>): string[]`, `store.hasClipboard: ComputedRef<boolean>`. Task 5's context menu consumes all three.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/timeline-clipboard.unit.spec.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTimelineStore } from '../../app/composables/useTimelineStore'
import type { ImageClip, AudioClip } from '../../shared/timeline/types'

function img(id: string, start: number, length: number): ImageClip {
  return { id, kind: 'image', asset_id: `asset-${id}`, start_frame: start, in_frame: 0, length }
}
function aud(id: string, start: number, length: number): AudioClip {
  return { id, kind: 'audio', asset_id: `asset-${id}`, start_frame: start, in_frame: 0, length }
}

describe('timeline clipboard', () => {
  const store = useTimelineStore()
  let videoTrackId: string

  beforeEach(() => {
    store.bind('test-node', () => undefined, () => {})
    videoTrackId = store.state.value.tracks[0]!.id
  })

  it('copy + paste places clones at the target frame with fresh ids, one undo step', () => {
    store.addClip(videoTrackId, img('a', 10, 30))
    store.addClip(videoTrackId, img('b', 50, 20))
    expect(store.copyClips(['a', 'b'])).toBe(2)
    const undoBefore = store.canUndo.value
    const ids = store.pasteClips(100)
    expect(ids).toHaveLength(2)
    const clips = store.state.value.tracks[0]!.clips
    const pasted = clips.filter(c => ids.includes(c.id))
    // earliest clip lands at 100; relative offset (40) preserved
    expect(pasted.map(c => c.start_frame).sort((x, y) => x - y)).toEqual([100, 140])
    expect(pasted.every(c => c.id !== 'a' && c.id !== 'b')).toBe(true)
    store.undo()
    expect(store.state.value.tracks[0]!.clips).toHaveLength(2)
    expect(undoBefore).toBe(true)
  })

  it('paste routes to a matching-kind track when the source track is gone', () => {
    store.addTrack('audio')
    const audioTrackId = store.state.value.tracks[1]!.id
    store.addClip(audioTrackId, aud('m', 0, 40))
    store.copyClips(['m'])
    store.removeTrack(audioTrackId)
    const ids = store.pasteClips(0)
    expect(ids).toHaveLength(1)
    const target = store.state.value.tracks.find(t => t.clips.some(c => c.id === ids[0]))
    expect(target!.kind).toBe('audio')   // created (or reused) an audio track
  })

  it('duplicate appends right after the source clip on the same track', () => {
    store.addClip(videoTrackId, img('a', 10, 30))
    const ids = store.duplicateClips(['a'])
    const dup = store.state.value.tracks[0]!.clips.find(c => c.id === ids[0])
    expect(dup!.start_frame).toBe(40)
    expect(store.hasClipboard.value).toBe(false)  // duplicate must not touch the clipboard
  })

  it('paste with empty clipboard is a no-op', () => {
    expect(store.pasteClips(0)).toEqual([])
    expect(store.canUndo.value).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/timeline-clipboard.unit.spec.ts`
Expected: FAIL — `store.copyClips is not a function`

- [ ] **Step 3: Implement in the store**

Module scope (clipboard survives editor close/reopen; it's a snapshot, not references):

```ts
interface ClipboardEntry { clip: Clip; track_id: string; track_kind: Track['kind'] }
const clipboard = ref<ClipboardEntry[]>([])
```

Import `Track` type. Inside `useTimelineStore()`:

```ts
function copyClips(clipIds: Iterable<string>): number {
  const ids = new Set(clipIds)
  const out: ClipboardEntry[] = []
  for (const track of state.value.tracks) {
    for (const clip of track.clips) {
      if (!ids.has(clip.id)) continue
      out.push({ clip: JSON.parse(JSON.stringify(clip)), track_id: track.id, track_kind: track.kind })
    }
  }
  if (out.length) clipboard.value = out
  return out.length
}

/** Paste at `atFrame`: earliest clip lands there, relative offsets preserved.
 *  Routing: original track if it still exists and is unlocked → first unlocked
 *  track of the same kind → a freshly created track of that kind. */
function pasteClips(atFrame: number): string[] {
  const entries = clipboard.value
  if (!entries.length) return []
  const minStart = Math.min(...entries.map(e => e.clip.start_frame))
  const newIds: string[] = []
  mutate(s => {
    for (const e of entries) {
      let track = s.tracks.find(t => t.id === e.track_id && !t.locked)
      if (!track) track = s.tracks.find(t => t.kind === e.track_kind && !t.locked)
      if (!track) {
        const count = s.tracks.filter(t => t.kind === e.track_kind).length
        track = {
          id: crypto.randomUUID(), kind: e.track_kind,
          name: `${e.track_kind === 'audio' ? 'Audio' : 'Video'} ${count + 1}`,
          muted: false, locked: false, clips: [],
        }
        s.tracks.push(track)
      }
      const clone: Clip = JSON.parse(JSON.stringify(e.clip))
      clone.id = crypto.randomUUID()
      clone.start_frame = Math.max(0, atFrame + (e.clip.start_frame - minStart))
      track.clips.push(clone)
      newIds.push(clone.id)
    }
  })
  return newIds
}

function duplicateClips(clipIds: Iterable<string>): string[] {
  const ids = new Set(clipIds)
  const newIds: string[] = []
  mutate(s => {
    for (const track of s.tracks) {
      for (const clip of [...track.clips]) {
        if (!ids.has(clip.id)) continue
        const clone: Clip = JSON.parse(JSON.stringify(clip))
        clone.id = crypto.randomUUID()
        clone.start_frame = clip.start_frame + clip.length
        track.clips.push(clone)
        newIds.push(clone.id)
      }
    }
  })
  return newIds
}
```

Export `copyClips`, `pasteClips`, `duplicateClips`, and `hasClipboard: computed(() => clipboard.value.length > 0)`.

Note: `pasteClips([])`-guard means the empty case never calls `mutate` — no undo entry.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/timeline-clipboard.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Keyboard wiring in the editor**

In `handleKeydown` (before the undo/redo lines):

```ts
if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
  e.preventDefault()
  if (selectedClipIds.value.size) store.copyClips(selectedClipIds.value)
  return
}
if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
  e.preventDefault()
  const ids = store.pasteClips(store.playheadFrame.value)
  if (ids.length) {
    selectedClipIds.value = new Set(ids)
    store.selectedClipId.value = ids[ids.length - 1]!
  }
  return
}
if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
  e.preventDefault()
  if (selectedClipIds.value.size) {
    const ids = store.duplicateClips(selectedClipIds.value)
    selectedClipIds.value = new Set(ids)
    store.selectedClipId.value = ids[ids.length - 1] ?? null
  }
  return
}
```

- [ ] **Step 6: Manual verify + commit**

Dev server: select a clip → ⌘C, move playhead, ⌘V → clone at playhead, selected. ⌘D → back-to-back copy. ⌘Z undoes each paste as one step.

```bash
git add frontend/app/composables/useTimelineStore.ts frontend/app/components/vue-canvas/TimelineEditor.vue frontend/tests/unit/timeline-clipboard.unit.spec.ts
git commit -m "feat(timeline): clipboard copy/paste/duplicate with track routing"
```

---

### Task 3: Cross-track clip drag

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue`

**Interfaces:**
- Consumes: `store.moveClip(clipId, toTrackId, startFrame)` (existing `move_clip` command), Task 1's gesture wrap (already active on clip drags).

- [ ] **Step 1: Add lane hit-testing + the move branch**

Add near the strip-geometry helpers:

```ts
// Which track lane is under this clientY? (null = ruler or below the lanes)
function trackIndexAtY(clientY: number): number | null {
  const rect = stripRef.value?.getBoundingClientRect()
  if (!rect) return null
  let y = clientY - rect.top - RULER_HEIGHT
  if (y < 0) return null
  const tracks = store.state.value.tracks
  for (let i = 0; i < tracks.length; i++) {
    const h = trackHeight(tracks[i]!)
    if (y < h) return i
    y -= h
  }
  return null
}

// Highlight for the lane a dragged clip would land on.
const moveTargetTrackId = ref<string | null>(null)
```

In `onPointerMove`, inside the `mode === 'move'` branch, after the existing single-clip `store.updateClip(...)` else-arm, extend the single-clip path (bulk moves stay horizontal-only):

```ts
} else {
  // Vertical: retarget to another unlocked track of the same kind.
  const idx = trackIndexAtY(e.clientY)
  const clip = findClip(drag.value.clipId)
  let movedTrack = false
  if (idx != null && clip) {
    const target = store.state.value.tracks[idx]!
    const wantKind = clip.kind === 'audio' ? 'audio' : 'video'
    if (target.id !== drag.value.trackId && target.kind === wantKind && !target.locked) {
      store.moveClip(drag.value.clipId, target.id, Math.max(0, finalStart))
      drag.value.trackId = target.id
      moveTargetTrackId.value = target.id
      movedTrack = true
    }
  }
  if (!movedTrack) store.updateClip(drag.value.clipId, { start_frame: Math.max(0, finalStart) })
}
```

In `onPointerUp`, clear the highlight: `moveTargetTrackId.value = null`.

- [ ] **Step 2: Lane highlight in the template**

On the per-track lane div (the one with `@dragover`), extend the class binding:

```html
:class="[
  dragTargetTrackId === track.id ? 'bg-white/[0.04]' : '',
  moveTargetTrackId === track.id ? 'bg-white/[0.06]' : '',
]"
```

- [ ] **Step 3: Manual verify**

Dev server, two video tracks + one audio track, clips on each:
- Drag a video clip down to the second video track — it switches lanes live, horizontal snap still works, lane highlights.
- Try dragging it onto the audio track — nothing happens (kind mismatch).
- Lock the second video track — dragging onto it does nothing.
- ⌘Z once after a cross-track drag returns the clip to its original track AND position (gesture transaction).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(timeline): drag clips between same-kind tracks"
```

---

### Task 4: Honest trimming — in_frame on left trim, source clamp, trim bubble

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue`
- Test: `frontend/tests/unit/timeline-trim.unit.spec.ts` (create — pure helper)

**Interfaces:**
- Produces: exported helper `computeLeftTrim` in a new tiny module `frontend/shared/timeline/trim.ts` so it's unit-testable and reusable by Slice 1 later.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/timeline-trim.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { computeLeftTrim, clampLengthToSource } from '../../shared/timeline/trim'

describe('computeLeftTrim', () => {
  // Clip: start 100, in 30, length 60.
  const base = { start_frame: 100, in_frame: 30, length: 60 }

  it('trimming right (later start) shortens and advances in_frame', () => {
    expect(computeLeftTrim(base, 110, true)).toEqual({ start_frame: 110, in_frame: 40, length: 50 })
  })

  it('trimming left (earlier start) lengthens and rewinds in_frame', () => {
    expect(computeLeftTrim(base, 80, true)).toEqual({ start_frame: 80, in_frame: 10, length: 80 })
  })

  it('clamps at in_frame 0 — cannot reveal content before the source start', () => {
    expect(computeLeftTrim(base, 50, true)).toEqual({ start_frame: 70, in_frame: 0, length: 90 })
  })

  it('never shrinks below 1 frame', () => {
    expect(computeLeftTrim(base, 500, true)).toEqual({ start_frame: 159, in_frame: 89, length: 1 })
  })

  it('images and other unbounded kinds keep in_frame untouched', () => {
    expect(computeLeftTrim(base, 80, false)).toEqual({ start_frame: 80, in_frame: 30, length: 80 })
  })
})

describe('clampLengthToSource', () => {
  it('caps length at remaining source frames', () => {
    expect(clampLengthToSource(100, 30, 90)).toBe(60)   // 90 total, 30 used
  })
  it('unknown source (null) leaves length alone', () => {
    expect(clampLengthToSource(100, 30, null)).toBe(100)
  })
  it('floors at 1', () => {
    expect(clampLengthToSource(5, 89, 90)).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/timeline-trim.unit.spec.ts`
Expected: FAIL — cannot resolve `../../shared/timeline/trim`

- [ ] **Step 3: Implement the helper module**

```ts
// frontend/shared/timeline/trim.ts
//
// Left-edge trim math. CapCut semantics: the left edge trims INTO the source
// (in_frame moves with the edge, content stays anchored on the timeline).
// `anchored` is true for source-backed kinds (video/audio); false for
// image/text/motion/workflow clips, whose in_frame is meaningless.

export interface TrimBase { start_frame: number; in_frame: number; length: number }

export function computeLeftTrim(base: TrimBase, rawNewStart: number, anchored: boolean): TrimBase {
  const end = base.start_frame + base.length
  // New start is bounded by: ≥ 0, ≤ end − 1 (min length 1), and for anchored
  // clips ≥ start − in_frame (can't rewind before the source's frame 0).
  let newStart = Math.max(0, Math.min(rawNewStart, end - 1))
  if (anchored) newStart = Math.max(newStart, base.start_frame - base.in_frame)
  const delta = newStart - base.start_frame
  return {
    start_frame: newStart,
    in_frame: anchored ? base.in_frame + delta : base.in_frame,
    length: base.length - delta,
  }
}

/** Cap a right-trim length at the source's remaining frames (null = unknown). */
export function clampLengthToSource(length: number, inFrame: number, sourceFrames: number | null): number {
  if (sourceFrames == null) return Math.max(1, length)
  return Math.max(1, Math.min(length, sourceFrames - inFrame))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/timeline-trim.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Use it in the editor + add the trim bubble**

In `TimelineEditor.vue`:

Imports: `import { computeLeftTrim, clampLengthToSource } from '~~/shared/timeline/trim'`.

Add drag-state field `startIn: number` (set `startIn: clip.in_frame` in `onClipPointerDown`), a source-length helper, and the bubble ref:

```ts
// Known source length in frames for asset-backed clips (null = unbounded).
function clipSourceFrames(clip: Clip): number | null {
  if (clip.kind !== 'video' && clip.kind !== 'audio') return null
  const asset = getAsset((clip as any).asset_id)
  if (!asset?.duration_sec) return null
  return Math.max(1, Math.round(asset.duration_sec * store.fps.value))
}

const trimHud = ref<null | { x: number; y: number; text: string }>(null)
```

Replace the `resize-right` branch:

```ts
} else if (drag.value.mode === 'resize-right') {
  const clip = findClip(drag.value.clipId)
  const rawEnd = drag.value.startStart + Math.max(1, drag.value.startLength + dframes)
  const snapped = snapFrame(rawEnd, drag.value.clipId)
  let newLen = Math.max(1, snapped - drag.value.startStart)
  if (clip) newLen = clampLengthToSource(newLen, clip.in_frame, clipSourceFrames(clip))
  store.updateClip(drag.value.clipId, { length: newLen })
  showTrimHud(e, newLen, newLen - drag.value.startLength)
}
```

Replace the `resize-left` branch:

```ts
} else if (drag.value.mode === 'resize-left') {
  const clip = findClip(drag.value.clipId)
  const anchored = clip?.kind === 'video' || clip?.kind === 'audio'
  const rawStart = drag.value.startStart + dframes
  const snapped = snapFrame(rawStart, drag.value.clipId)
  const t = computeLeftTrim(
    { start_frame: drag.value.startStart, in_frame: drag.value.startIn, length: drag.value.startLength },
    snapped, anchored)
  store.updateClip(drag.value.clipId, t)
  showTrimHud(e, t.length, t.length - drag.value.startLength)
}
```

The bubble:

```ts
function showTrimHud(e: PointerEvent, lengthFrames: number, deltaFrames: number) {
  const fps = store.fps.value
  const sign = deltaFrames > 0 ? '+' : ''
  trimHud.value = {
    x: e.clientX + 12, y: e.clientY - 28,
    text: `${(lengthFrames / fps).toFixed(2)}s · ${lengthFrames}f  (${sign}${(deltaFrames / fps).toFixed(2)}s)`,
  }
}
```

Clear it in `onPointerUp` (`trimHud.value = null`). Template — add just before the closing tag of the fullscreen overlay div:

```html
<!-- Trim HUD bubble -->
<div v-if="trimHud" class="fixed z-[140] px-2 py-1 rounded bg-black/85 border border-white/15 text-[10px] text-white/90 tabular-nums pointer-events-none"
  :style="{ left: trimHud.x + 'px', top: trimHud.y + 'px' }">{{ trimHud.text }}</div>
```

- [ ] **Step 6: Manual verify + commit**

Dev server, a video clip with known duration: right-trim shows the bubble and stops dead at the source length; left-trim moves the in-point (scrub after trimming — content is anchored, not re-timed); an image clip still trims freely.

```bash
git add frontend/shared/timeline/trim.ts frontend/tests/unit/timeline-trim.unit.spec.ts frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(timeline): anchored left-trim, source-length clamp, trim HUD"
```

---

### Task 5: Context menus (clip / lane / track header) + track delete + rename

**Files:**
- Create: `frontend/app/components/vue-canvas/timeline/TimelineContextMenu.vue`
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue`

**Interfaces:**
- Consumes: Task 2's `copyClips`/`pasteClips`/`duplicateClips`/`hasClipboard`; existing `splitAtPlayhead`, `removeClip`, `rippleDelete`, `removeTrack`, `addTrack`.
- Produces: `TimelineContextMenu.vue` with props `{ x: number; y: number; items: (MenuItem | 'sep')[] }`, `MenuItem = { label: string; shortcut?: string; danger?: boolean; disabled?: boolean; action: () => void }`, emit `close`. Lane 2 slices append items to the same menus.

- [ ] **Step 1: The menu component**

```vue
<!-- frontend/app/components/vue-canvas/timeline/TimelineContextMenu.vue -->
<script setup lang="ts">
import { computed } from 'vue'

export interface MenuItem {
  label: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  action: () => void
}

const props = defineProps<{ x: number; y: number; items: (MenuItem | 'sep')[] }>()
const emit = defineEmits<{ close: [] }>()

// Keep the menu on-screen (rough clamp; menu is ~200px wide, ~32px/row).
const pos = computed(() => ({
  left: Math.min(props.x, window.innerWidth - 210) + 'px',
  top: Math.min(props.y, window.innerHeight - props.items.length * 32 - 16) + 'px',
}))

function run(item: MenuItem) {
  if (item.disabled) return
  item.action()
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-[130]" @pointerdown.self="emit('close')" @contextmenu.prevent="emit('close')">
    <div
      class="absolute min-w-[190px] bg-[#161616] border border-white/10 rounded-lg shadow-2xl py-1 text-xs select-none"
      :style="pos"
    >
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item === 'sep'" class="my-1 h-px bg-white/10" />
        <button
          v-else
          class="w-full flex items-center gap-3 px-3 py-1.5 text-left transition-colors"
          :class="[
            item.disabled ? 'opacity-30 cursor-default' : 'hover:bg-white/10',
            item.danger ? 'text-red-300' : 'text-white/85',
          ]"
          @click="run(item)"
        >
          <span class="flex-1">{{ item.label }}</span>
          <span v-if="item.shortcut" class="text-white/30 tabular-nums">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Menu state + builders in the editor**

Import the component and its `MenuItem` type. Script additions:

```ts
const ctxMenu = ref<null | { x: number; y: number; items: (MenuItem | 'sep')[] }>(null)

function clipMenuItems(clipId: string): (MenuItem | 'sep')[] {
  const clip = findClip(clipId)
  const insidePlayhead = !!clip
    && store.playheadFrame.value > clip.start_frame
    && store.playheadFrame.value < clip.start_frame + clip.length
  const ids = selectedClipIds.value.has(clipId) ? [...selectedClipIds.value] : [clipId]
  return [
    { label: 'Split at playhead', shortcut: 'S', disabled: !insidePlayhead, action: () => store.splitAtPlayhead(clipId) },
    { label: 'Duplicate', shortcut: '⌘D', action: () => { const n = store.duplicateClips(ids); selectedClipIds.value = new Set(n); store.selectedClipId.value = n[n.length - 1] ?? null } },
    'sep',
    { label: 'Copy', shortcut: '⌘C', action: () => store.copyClips(ids) },
    { label: 'Paste', shortcut: '⌘V', disabled: !store.hasClipboard.value, action: () => pasteAndSelect(store.playheadFrame.value) },
    'sep',
    { label: 'Delete', shortcut: '⌫', danger: true, action: () => { const del = new Set(ids); store.mutate(s => { for (const t of s.tracks) t.clips = t.clips.filter(c => !del.has(c.id)) }); clearSelection() } },
    { label: 'Ripple delete', shortcut: '⌘⌫', danger: true, action: () => { store.rippleDelete(clipId); clearSelection() } },
  ]
}

function laneMenuItems(trackId: string, frame: number): (MenuItem | 'sep')[] {
  return [
    { label: 'Paste here', shortcut: '⌘V', disabled: !store.hasClipboard.value, action: () => pasteAndSelect(frame) },
    'sep',
    { label: 'Add video track', action: () => store.addTrack('video') },
    { label: 'Add audio track', action: () => store.addTrack('audio') },
    'sep',
    deleteTrackItem(trackId),
  ]
}

function headerMenuItems(trackId: string): (MenuItem | 'sep')[] {
  return [
    { label: 'Rename', action: () => { renamingTrackId.value = trackId } },
    'sep',
    deleteTrackItem(trackId),
  ]
}

function deleteTrackItem(trackId: string): MenuItem {
  const track = store.state.value.tracks.find(t => t.id === trackId)
  const lastOfKind = !!track && store.state.value.tracks.filter(t => t.kind === track.kind).length <= 1
  return {
    label: 'Delete track', danger: true, disabled: lastOfKind,
    action: () => {
      if (!track) return
      if (track.clips.length && !window.confirm(`Delete "${track.name}" and its ${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}?`)) return
      store.removeTrack(trackId)
    },
  }
}

function pasteAndSelect(frame: number) {
  const ids = store.pasteClips(frame)
  if (ids.length) {
    selectedClipIds.value = new Set(ids)
    store.selectedClipId.value = ids[ids.length - 1]!
  }
}

function onClipContextMenu(clipId: string, e: MouseEvent) {
  e.preventDefault(); e.stopPropagation()
  if (!selectedClipIds.value.has(clipId)) selectOnly(clipId)
  ctxMenu.value = { x: e.clientX, y: e.clientY, items: clipMenuItems(clipId) }
}

function onLaneContextMenu(trackId: string, e: MouseEvent) {
  e.preventDefault()
  const rect = stripRef.value!.getBoundingClientRect()
  const frame = Math.max(0, Math.round(pxToFrames(e.clientX - rect.left)))
  ctxMenu.value = { x: e.clientX, y: e.clientY, items: laneMenuItems(trackId, frame) }
}

function onHeaderContextMenu(trackId: string, e: MouseEvent) {
  e.preventDefault()
  ctxMenu.value = { x: e.clientX, y: e.clientY, items: headerMenuItems(trackId) }
}

// -- Track rename --
const renamingTrackId = ref<string | null>(null)
function commitTrackName(trackId: string, name: string) {
  const trimmed = name.trim()
  if (trimmed) store.mutate(s => { const t = s.tracks.find(t2 => t2.id === trackId); if (t) t.name = trimmed })
  renamingTrackId.value = null
}
```

- [ ] **Step 3: Template wiring**

- Clip div: add `@contextmenu="(e) => onClipContextMenu(clip.id, e)"`.
- Track lane div: add `@contextmenu="(e) => onLaneContextMenu(track.id, e)"`.
- Track header div: add `@contextmenu="(e) => onHeaderContextMenu(track.id, e)"`.
- Track header name span becomes rename-aware:

```html
<input v-if="renamingTrackId === track.id"
  class="flex-1 min-w-0 bg-[#1a1a1a] border border-white/20 rounded px-1 py-0.5 text-[11px] text-white/90 outline-none"
  :value="track.name" autofocus
  @pointerdown.stop
  @keydown.enter="(e) => commitTrackName(track.id, (e.target as HTMLInputElement).value)"
  @keydown.escape="renamingTrackId = null"
  @blur="(e) => commitTrackName(track.id, (e.target as HTMLInputElement).value)" />
<span v-else class="text-[11px] truncate flex-1" :class="trackColor(tIdx).text"
  @dblclick="renamingTrackId = track.id">{{ track.name }}</span>
```

- Audio-track mute icons (spec 1.9): in the mute button, replace the eye pair for audio tracks:

```html
<component :is="track.kind === 'audio' ? (track.muted ? VolumeX : Volume2) : (track.muted ? EyeOff : Eye)" class="size-2.5 text-white/40" />
```

(add `VolumeX` to the lucide imports).

- Mount the menu at the end of the overlay:

```html
<TimelineContextMenu v-if="ctxMenu" v-bind="ctxMenu" @close="ctxMenu = null" />
```

- [ ] **Step 4: Manual verify + commit**

Right-click clip → all seven items; Split disabled when playhead is outside the clip; Paste disabled with empty clipboard. Right-click lane → Paste here lands at pointer. Right-click header → Rename opens inline input (Enter commits, Esc cancels, dbl-click works too); Delete track confirms when non-empty and is disabled for the last track of a kind. Audio track shows speaker icons.

```bash
git add frontend/app/components/vue-canvas/timeline/TimelineContextMenu.vue frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(timeline): context menus for clips/lanes/headers, track rename+delete"
```

---

### Task 6: Marquee selection, ruler scrubbing, ⌘A

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue`

- [ ] **Step 1: Move scrubbing to the ruler**

The ruler div currently has `pointer-events-none`. Remove that class from the ruler wrapper, add `cursor-col-resize` and `@pointerdown="onPlayheadPointerDown"`. Inner tick/label divs get `pointer-events-none` individually (they'd swallow the events otherwise). Keep `onPlayheadPointerDown` as-is (it already seeks from `e.clientX`).

- [ ] **Step 2: Replace empty-strip seek with marquee**

```ts
const marquee = ref<null | { x0: number; y0: number; x1: number; y1: number }>(null)

function onStripPointerDown(e: PointerEvent) {
  if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('strip-bg')) return
  if (e.button !== 0) return
  const rect = stripRef.value!.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  if (y <= RULER_HEIGHT) { onPlayheadPointerDown(e); return }  // ruler fallthrough
  marquee.value = { x0: x, y0: y, x1: x, y1: y }
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
```

In `onPointerMove`, FIRST branch (before kfDrag):

```ts
if (marquee.value) {
  const rect = stripRef.value!.getBoundingClientRect()
  marquee.value.x1 = e.clientX - rect.left
  marquee.value.y1 = e.clientY - rect.top
  applyMarqueeSelection()
  return
}
```

In `onPointerUp`, FIRST branch:

```ts
if (marquee.value) {
  const m = marquee.value
  const moved = Math.abs(m.x1 - m.x0) > 3 || Math.abs(m.y1 - m.y0) > 3
  if (!moved) clearSelection()          // plain click on empty area = deselect
  marquee.value = null
  return
}
```

Selection math:

```ts
function applyMarqueeSelection() {
  const m = marquee.value
  if (!m) return
  const fA = pxToFrames(Math.min(m.x0, m.x1))
  const fB = pxToFrames(Math.max(m.x0, m.x1))
  const yA = Math.min(m.y0, m.y1)
  const yB = Math.max(m.y0, m.y1)
  const picked = new Set<string>()
  let top = RULER_HEIGHT
  for (const track of store.state.value.tracks) {
    const h = trackHeight(track)
    const laneHit = top < yB && top + h > yA
    if (laneHit && !track.locked) {
      for (const clip of track.clips) {
        if (clip.start_frame < fB && clip.start_frame + clip.length > fA) picked.add(clip.id)
      }
    }
    top += h
  }
  selectedClipIds.value = picked
  store.selectedClipId.value = picked.size ? [...picked][picked.size - 1]! : null
}
```

Template — marquee rectangle inside the strip (next to the snap guideline):

```html
<div v-if="marquee"
  class="absolute z-[5] border border-white/50 bg-white/10 pointer-events-none"
  :style="{
    left: Math.min(marquee.x0, marquee.x1) + 'px',
    top: Math.min(marquee.y0, marquee.y1) + 'px',
    width: Math.abs(marquee.x1 - marquee.x0) + 'px',
    height: Math.abs(marquee.y1 - marquee.y0) + 'px',
  }" />
```

- [ ] **Step 3: ⌘A**

In `handleKeydown`:

```ts
if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
  e.preventDefault()
  const all = new Set<string>()
  for (const track of store.state.value.tracks) {
    if (track.locked) continue
    for (const clip of track.clips) all.add(clip.id)
  }
  selectedClipIds.value = all
  store.selectedClipId.value = all.size ? [...all][all.size - 1]! : null
  return
}
```

- [ ] **Step 4: Manual verify + commit**

Drag on empty lane area → rubber band selects intersecting clips (locked tracks skipped); plain click clears selection; ruler click/drag scrubs the playhead; clip drag still works; ⌘A selects everything.

```bash
git add frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(timeline): marquee selection, ruler-only scrubbing, cmd+A"
```

---

### Task 7: Draggable fade handles + ramp overlay

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue`

**Interfaces:**
- Consumes: Task 1's `beginGesture`/`endGesture`.

- [ ] **Step 1: Drag state + handlers**

```ts
const fadeDrag = ref<null | { clipId: string; side: 'in' | 'out'; startMouseX: number; startFade: number }>(null)

function onFadePointerDown(clipId: string, side: 'in' | 'out', e: PointerEvent) {
  e.stopPropagation(); e.preventDefault()
  const clip = findClip(clipId)
  if (!clip) return
  store.beginGesture()
  fadeDrag.value = { clipId, side, startMouseX: e.clientX, startFade: (side === 'in' ? clip.fade_in : clip.fade_out) ?? 0 }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
```

In `onPointerMove` (after the marquee branch, before kfDrag):

```ts
if (fadeDrag.value) {
  const clip = findClip(fadeDrag.value.clipId)
  if (!clip) return
  const dx = e.clientX - fadeDrag.value.startMouseX
  const df = Math.round(dx / pxPerFrame.value)
  // fade-in grows rightward, fade-out grows leftward
  const raw = fadeDrag.value.side === 'in' ? fadeDrag.value.startFade + df : fadeDrag.value.startFade - df
  const v = Math.max(0, Math.min(raw, clip.length))
  store.updateClip(clip.id, fadeDrag.value.side === 'in' ? { fade_in: v } : { fade_out: v })
  return
}
```

In `onPointerUp`, FIRST-ish branch (after marquee): `if (fadeDrag.value) { fadeDrag.value = null; store.endGesture(); return }`.

- [ ] **Step 2: Handles + ramp overlay in the clip template**

Inside the clip div (after the resize handles), shown when selected:

```html
<!-- Fade ramps -->
<svg v-if="(clip.fade_in ?? 0) > 0" class="absolute left-0 top-0 bottom-0 pointer-events-none z-[1]"
  :width="Math.min(clip.length, clip.fade_in ?? 0) * pxPerFrame" :height="trackHeight(track) - 8" preserveAspectRatio="none">
  <polygon :points="`0,${trackHeight(track) - 8} ${Math.min(clip.length, clip.fade_in ?? 0) * pxPerFrame},0 0,0`" fill="rgba(0,0,0,0.45)" />
</svg>
<svg v-if="(clip.fade_out ?? 0) > 0" class="absolute right-0 top-0 bottom-0 pointer-events-none z-[1]"
  :width="Math.min(clip.length, clip.fade_out ?? 0) * pxPerFrame" :height="trackHeight(track) - 8" preserveAspectRatio="none">
  <polygon :points="`${Math.min(clip.length, clip.fade_out ?? 0) * pxPerFrame},${trackHeight(track) - 8} 0,0 ${Math.min(clip.length, clip.fade_out ?? 0) * pxPerFrame},0`" fill="rgba(0,0,0,0.45)" />
</svg>
<!-- Fade handles (selected clip) -->
<template v-if="selectedClipIds.has(clip.id)">
  <div class="absolute top-0 size-2.5 rounded-full bg-white/90 border border-black/60 cursor-ew-resize z-20 -translate-y-1/2"
    :style="{ left: ((clip.fade_in ?? 0) * pxPerFrame - 5) + 'px' }"
    title="Fade in — drag"
    @pointerdown="(e) => onFadePointerDown(clip.id, 'in', e)" />
  <div class="absolute top-0 size-2.5 rounded-full bg-white/90 border border-black/60 cursor-ew-resize z-20 -translate-y-1/2"
    :style="{ right: ((clip.fade_out ?? 0) * pxPerFrame - 5) + 'px' }"
    title="Fade out — drag"
    @pointerdown="(e) => onFadePointerDown(clip.id, 'out', e)" />
</template>
```

- [ ] **Step 3: Manual verify + commit**

Select a clip → two round handles at its top corners; drag the left one right → dark ramp triangle grows and `fade_in` updates live in the inspector (numbers still editable there); ⌘Z once reverts the whole drag; playback shows the fade.

```bash
git add frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(timeline): draggable fade handles with ramp overlay"
```

---

### Task 8: Seconds-first display

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue`

- [ ] **Step 1: Conversion helpers**

```ts
// Seconds at the DISPLAY EDGE only — the model stays in frames.
function fToS(frames: number): string {
  return (frames / store.fps.value).toFixed(2)
}
function sToF(raw: string): number {
  return Math.max(0, Math.round((parseFloat(raw) || 0) * store.fps.value))
}
```

- [ ] **Step 2: Convert the inspector fields**

Start / Length / In point / Fade in / Fade out switch to seconds inputs with a frame suffix. Pattern (repeat for each; Length keeps `min ≥ 1 frame` via `Math.max(1, …)`):

```html
<div>
  <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Start</div>
  <div class="flex items-center gap-1.5">
    <input type="number" step="0.1" min="0" :value="fToS(selectedClipData.start_frame)"
      class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none tabular-nums"
      @change="store.updateClip(selectedClipData!.id, { start_frame: sToF(($event.target as HTMLInputElement).value) })" />
    <span class="text-[9px] text-white/30 tabular-nums shrink-0">{{ selectedClipData.start_frame }}f</span>
  </div>
</div>
```

- Length: `@change` value `Math.max(1, sToF(...))`, suffix `{{ selectedClipData.length }}f`.
- In point: same pattern on `in_frame`.
- Fade in/out: same pattern on `fade_in`/`fade_out` (min 0).

- [ ] **Step 3: Clip label duration in seconds**

In the clip label, replace `{{ clip.length }}f` with `{{ (clip.length / store.fps.value).toFixed(1) }}s` and add a title attribute on the label span's parent: `:title="clip.length + 'f'"`.

- [ ] **Step 4: Manual verify + commit**

Inspector shows `1.50s`-style values with a small `45f` suffix; typing `2` in Length makes the clip 2 seconds (60f at 30fps); clip bars read `2.0s`.

```bash
git add frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(timeline): seconds-first inspector and clip labels"
```

---

### Task 9: Snap toggle + Alt bypass

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue`

- [ ] **Step 1: Setting-backed toggle + Alt inversion**

```ts
const { getLocalSetting, setLocalSetting } = useLocalSettings()  // already imported for the GL flag
const snapEnabled = ref(getLocalSetting('Timeline.Snap') !== 'false')
function toggleSnap() {
  snapEnabled.value = !snapEnabled.value
  setLocalSetting('Timeline.Snap', String(snapEnabled.value))
}
// Alt/Option held during a drag temporarily inverts the setting (NLE convention).
const altHeld = ref(false)
```

Track Alt in the existing global listeners — `handleKeydown` can't see keyup, so add to `onMounted`/`onUnmounted` a pair:

```ts
function onKeyToggle(e: KeyboardEvent) { altHeld.value = e.altKey }
// onMounted:  window.addEventListener('keydown', onKeyToggle); window.addEventListener('keyup', onKeyToggle)
// onUnmounted: remove both
```

Gate `snapFrame`:

```ts
function snapFrame(rawFrame: number, excludeClipId: string | null): number {
  const active = snapEnabled.value !== altHeld.value   // XOR: Alt inverts
  if (!active) { snapGuideFrame.value = null; return rawFrame }
  // …existing body…
}
```

- [ ] **Step 2: Transport-bar magnet button**

Next to the zoom cluster (import `Magnet` from lucide):

```html
<button class="size-6 flex items-center justify-center rounded transition-colors"
  :class="snapEnabled ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-white/40'"
  :title="snapEnabled ? 'Snapping on (Alt bypasses)' : 'Snapping off (Alt snaps)'"
  @click="toggleSnap"><Magnet class="size-3.5" /></button>
```

- [ ] **Step 3: Manual verify + commit**

Magnet lit by default; dragging near another clip edge snaps with the guideline; hold Alt → free drag; click magnet off → free drag, Alt now snaps; reload → setting persisted.

```bash
git add frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(timeline): snap toggle with alt bypass"
```

---

### Task 10: Transport split/delete buttons, Home/End, hint strip

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue`

- [ ] **Step 1: Buttons**

After the zoom cluster in the transport bar:

```html
<div class="flex items-center gap-0.5 ml-3 border-l border-white/10 pl-3">
  <button class="size-6 flex items-center justify-center rounded hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-30"
    :disabled="!store.selectedClipId.value" title="Split at playhead (S)"
    @click="store.selectedClipId.value && store.splitAtPlayhead(store.selectedClipId.value)"><Scissors class="size-3.5" /></button>
  <button class="size-6 flex items-center justify-center rounded hover:bg-red-500/20 text-white/60 hover:text-red-300 disabled:opacity-30"
    :disabled="!selectedClipIds.size" title="Delete selected (⌫)"
    @click="deleteSelection()"><Trash2 class="size-3.5" /></button>
</div>
```

Extract the existing bulk-delete keyboard logic into `deleteSelection()` and call it from both the keyboard handler and this button:

```ts
function deleteSelection() {
  if (selectedClipIds.value.size > 1) {
    const ids = new Set(selectedClipIds.value)
    store.mutate(s => {
      for (const track of s.tracks) track.clips = track.clips.filter(c => !ids.has(c.id))
    })
  } else if (store.selectedClipId.value) {
    store.removeClip(store.selectedClipId.value)
  }
  clearSelection()
}
```

- [ ] **Step 2: Home/End keys**

In `handleKeydown`:

```ts
if (e.key === 'Home') { e.preventDefault(); store.seek(0); return }
if (e.key === 'End') { e.preventDefault(); store.seek(store.totalSec.value); return }
```

- [ ] **Step 3: Hint strip refresh**

Replace the hint-strip contents with the fuller set:

```html
<span><kbd class="px-1 py-px rounded bg-white/5 border border-white/10">Space</kbd> play</span>
<span><kbd class="px-1 py-px rounded bg-white/5 border border-white/10">S</kbd> split</span>
<span><kbd class="px-1 py-px rounded bg-white/5 border border-white/10">⌘C/V/D</kbd> copy·paste·dup</span>
<span><kbd class="px-1 py-px rounded bg-white/5 border border-white/10">⌘A</kbd> all</span>
<span><kbd class="px-1 py-px rounded bg-white/5 border border-white/10">⌫</kbd> delete</span>
<span><kbd class="px-1 py-px rounded bg-white/5 border border-white/10">⌘Z</kbd> undo</span>
<span class="ml-auto"><kbd class="px-1 py-px rounded bg-white/5 border border-white/10">⌥</kbd> free-drag</span>
<span><kbd class="px-1 py-px rounded bg-white/5 border border-white/10">⌘+scroll</kbd> zoom</span>
<span><kbd class="px-1 py-px rounded bg-white/5 border border-white/10">⇧+scroll</kbd> pan</span>
```

- [ ] **Step 4: Manual verify, run the timeline e2e suite, commit**

Buttons enable/disable with selection; Home/End jump. Then run the regression suite:

Run: `cd frontend && npx playwright test tests/timeline.spec.ts`
Expected: PASS (this suite drives the editor UI end-to-end; it's the gate that Tasks 1–10 didn't break existing flows)

```bash
git add frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "feat(timeline): transport split/delete, home/end, refreshed hints"
```

---

### Task 11: Slice 0 — WebGL preview engine promotion

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue:209-215` (flag flip)
- Modify: `frontend/tests/timeline-gl-flag.spec.ts` (opt-out semantics)

- [ ] **Step 1: Flip the flag to opt-out**

```ts
// WebGL preview engine — DEFAULT when WebGL2 is available (Slice 0 promotion).
// Escape hatch: localStorage.setItem('sailor:Engine.WebGLPreview', 'false')
// forces the legacy Canvas2D engine.
const { getLocalSetting } = useLocalSettings()
const wantGl = getLocalSetting('Engine.WebGLPreview') !== 'false'
const useGl = wantGl && webglPreviewSupported()
if (wantGl && !useGl) console.warn('TimelineEditor: WebGL2 unavailable — Canvas2D fallback')
```

- [ ] **Step 2: Update the flag spec**

In `tests/timeline-gl-flag.spec.ts`:
- The existing test drops its `addInitScript` (GL is now the default) and keeps all assertions.
- Add a second test that sets `'sailor:Engine.WebGLPreview'` to `'false'` in `addInitScript` and asserts the canvas does NOT have `data-engine="webgl"` (Canvas2D fallback path).
- Check `tests/timeline.spec.ts` for assumptions that the default engine is Canvas2D (the comment in the flag spec says the default path is covered there); update any `data-engine` expectations to `webgl`.

- [ ] **Step 3: Run the engine gates**

Run: `cd frontend && npx playwright test tests/timeline-gl-flag.spec.ts tests/timeline.spec.ts tests/engine-playback.spec.ts tests/gl-blend-conformance.spec.ts tests/timeline-golden.spec.ts`
Expected: PASS. Any failure = the promotion is blocked and the failure becomes the work (do not commit a red flip).

- [ ] **Step 4: Manual dogfood pass**

Walk `docs/plans/2026-06-09-phase1-m3-dogfooding-checklist.md` against a real timeline (video + audio + image + kinetic text): scrub, play, blend modes, keyframed transform, export, compare preview↔export visually.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/TimelineEditor.vue frontend/tests/timeline-gl-flag.spec.ts frontend/tests/timeline.spec.ts
git commit -m "feat(timeline): promote WebGL preview engine to default (opt-out flag)"
```

---

## Final verification (whole plan)

- [ ] `cd frontend && npx vitest run tests/unit/timeline-gesture.unit.spec.ts tests/unit/timeline-clipboard.unit.spec.ts tests/unit/timeline-trim.unit.spec.ts tests/unit/commands.unit.spec.ts tests/unit/timeline-store-axis-kf.unit.spec.ts tests/unit/interpolate.unit.spec.ts` — all PASS
- [ ] `cd frontend && npx playwright test tests/timeline.spec.ts tests/timeline-gl-flag.spec.ts tests/timeline-golden.spec.ts` — all PASS
- [ ] Manual CapCut-reflex sweep in the dev server: drag clip between tracks → right-click → duplicate → marquee-select three clips → drag them → ⌘Z ×3 restores cleanly → trim a video clip past its source (stops) → fade handles → export still works.
