# Edit a Space Type Clip In Place — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user open a Space Type clip on the shipped Timeline into the full Space Type studio, edit it, pop back, and see the change live — without the clip staying pinned to its origin node.

**Architecture:** The `sailor_spaceType` blob a node stores and a clip's `.state` are the *same shape* (`SpaceTypeState`). Introduce a tiny `SpaceTypeStateSource` adapter with two implementations — node-backed (today's behaviour, extracted) and clip-backed (new, via the timeline store). `SpaceTypeSurface.vue` reads/writes through the adapter instead of hard-coding the node path; an optional `clipId` prop selects the clip source. Editing a clip writes back through a new store mutation that also **detaches** the clip from its origin (drops `clip.origin`), so the "Sync from node" affordance never offers to undo a live edit.

**Tech Stack:** Nuxt 4 (Vue 3 + TypeScript), Vitest (`npm run test:unit`), Playwright (`npm run test`), the in-app Browser pane for live verification.

## Global Constraints

- **Detach model:** the first in-place edit drops `clip.origin`. Symbols/instances (change-once-update-everywhere) are **spec 2**, out of scope here.
- **Node path is behaviour-preserving:** editing a Space Type *node* on the canvas must behave exactly as before. This is a regression bar, checked live.
- **No new component-test framework:** this repo has none by design. Pure modules are unit-tested with Vitest; Vue-component behaviour is verified by driving the real app in the Browser pane and reverting the fix to reproduce the bug on the same gesture.
- **Shared types only cross the boundary:** `SpaceTypeState` lives in `shared/spacetype/state.ts` (re-exported from `app/lib/spacetype/state.ts`). New modules import the type from `~~/shared/spacetype/state`. `shared/` must never import from `app/`.
- **Non-goals (do not build):** creating a Space Type clip from scratch on the timeline, making other studios editable-as-clips, lifting the 4-clip cap, AI-video, symbols.
- Commit after every task. Branch first if on `main`.

---

## File Structure

- **Create** `frontend/app/lib/spacetype/stateSource.ts` — the `SpaceTypeStateSource` interface + `nodeSpaceTypeStateSource()` and `clipSpaceTypeStateSource()` factories. Pure, no Vue-component imports.
- **Create** `frontend/tests/unit/spacetype-state-source.unit.spec.ts` — Vitest unit tests for the two sources + the store mutation.
- **Modify** `frontend/app/composables/useTimelineStore.ts` — add `updateSpaceTypeClipState(clipId, next)` (write-back + detach), export it.
- **Modify** `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — add optional `clipId` prop + `clipMode`; route `loadConfig`/`saveConfig`/`autosaveSignature` through a derived `stateSource`; guard node-only features in clip mode.
- **Modify** `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — `sailor:openSpaceTypeClip` listener, a second `SpaceTypeSurface` mount bound to a clip, close handler.
- **Modify** `frontend/app/components/vue-canvas/timeline/SpaceTypeClipInspector.vue` — an always-visible "Edit" affordance that dispatches the open event.
- **Modify** `frontend/tests/embed-spacetype.spec.ts` — a Playwright case: edit a clip's state → the composited render changes; placement/trim survive.

---

### Task 1: The state-source adapter (node impl)

**Files:**
- Create: `frontend/app/lib/spacetype/stateSource.ts`
- Test: `frontend/tests/unit/spacetype-state-source.unit.spec.ts`

**Interfaces:**
- Produces: `interface SpaceTypeStateSource { read(): SpaceTypeState | null; write(next: SpaceTypeState): void; readonly label: string }`
- Produces: `nodeSpaceTypeStateSource(getNode: () => any | undefined): SpaceTypeStateSource` — reads/writes `node.data.properties.sailor_spaceType`, preserving any extra keys already on the blob (e.g. `thumb`).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-state-source.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { nodeSpaceTypeStateSource } from '~/lib/spacetype/stateSource'
import type { SpaceTypeState } from '~~/shared/spacetype/state'

function sampleState(over: Partial<SpaceTypeState> = {}): SpaceTypeState {
  return {
    effectId: 'cylinder',
    params: { text: 'NOIR' },
    gradientStops: [],
    fps: 30,
    loopDuration: 6,
    dimsKey: '16:9',
    transparent: true,
    bgColor: '#000000',
    ...over,
  }
}

describe('nodeSpaceTypeStateSource', () => {
  it('reads sailor_spaceType off the node, null when absent', () => {
    let node: any = { data: { properties: {} } }
    const src = nodeSpaceTypeStateSource(() => node)
    expect(src.read()).toBeNull()
    node.data.properties.sailor_spaceType = sampleState()
    expect(src.read()?.effectId).toBe('cylinder')
  })

  it('write persists onto the node and PRESERVES extra keys (thumb)', () => {
    const node: any = { data: { properties: { sailor_spaceType: { thumb: '/view?x' } } } }
    const src = nodeSpaceTypeStateSource(() => node)
    src.write(sampleState({ effectId: 'ribbon' }))
    const blob = node.data.properties.sailor_spaceType
    expect(blob.effectId).toBe('ribbon')
    expect(blob.thumb).toBe('/view?x') // extra key survived
  })

  it('read/write is a no-op-safe round trip when the node is missing', () => {
    const src = nodeSpaceTypeStateSource(() => undefined)
    expect(src.read()).toBeNull()
    expect(() => src.write(sampleState())).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- spacetype-state-source`
Expected: FAIL — `Cannot find module '~/lib/spacetype/stateSource'`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/spacetype/stateSource.ts`:

```ts
// frontend/app/lib/spacetype/stateSource.ts
/** Where a Space Type studio reads and writes its state. Two implementations:
 *  a canvas node (today's behaviour) and a timeline clip (edit-in-place). The
 *  studio consumes this interface instead of hard-coding the node path — the
 *  seam symbols/instances (spec 2) will later hang off. */
import type { SpaceTypeState } from '~~/shared/spacetype/state'

export interface SpaceTypeStateSource {
  /** Current state, or null when there is nothing saved yet (fresh node). The
   *  studio's loadConfig tolerates missing optional fields (seamless/W/H),
   *  so a source returns the raw blob without back-filling. */
  read(): SpaceTypeState | null
  /** Persist the full state. Implementations preserve any non-state keys they
   *  already hold (the node blob also carries `thumb`). */
  write(next: SpaceTypeState): void
  /** Short human label for the studio chrome / breadcrumb. */
  readonly label: string
}

/** State stored on a canvas node at data.properties.sailor_spaceType. */
export function nodeSpaceTypeStateSource(getNode: () => any | undefined): SpaceTypeStateSource {
  return {
    label: 'Space Type',
    read() {
      const c = getNode()?.data?.properties?.sailor_spaceType
      return c ?? null
    },
    write(next) {
      const n = getNode()
      if (!n) return
      if (!n.data) n.data = {}
      if (!n.data.properties) n.data.properties = {}
      const prev = n.data.properties.sailor_spaceType || {}
      n.data.properties.sailor_spaceType = { ...prev, ...next }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- spacetype-state-source`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/stateSource.ts frontend/tests/unit/spacetype-state-source.unit.spec.ts
git commit -m "feat(spacetype): SpaceTypeStateSource adapter + node impl"
```

---

### Task 2: Clip state source + store write-back with detach

**Files:**
- Modify: `frontend/app/composables/useTimelineStore.ts` (add `updateSpaceTypeClipState`, export it near `syncSpaceTypeClipFromNode` ~line 243 and in the return object ~line 463)
- Modify: `frontend/app/lib/spacetype/stateSource.ts` (add `clipSpaceTypeStateSource`)
- Test: `frontend/tests/unit/spacetype-state-source.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: the timeline store singleton `useTimelineStore()` — its `state` ref, `updateClip(clipId, patch)`.
- Produces: `updateSpaceTypeClipState(clipId: string, next: SpaceTypeState): void` on the store — replaces `clip.state` AND drops `clip.origin` (detach), through `updateClip` (so it is undoable + persisted).
- Produces: `clipSpaceTypeStateSource(clipId: string): SpaceTypeStateSource` — reads `clip.state`, writes via `updateSpaceTypeClipState`.

- [ ] **Step 1: Write the failing test (extend the unit spec)**

Append to `frontend/tests/unit/spacetype-state-source.unit.spec.ts`:

```ts
import { clipSpaceTypeStateSource } from '~/lib/spacetype/stateSource'
import { useTimelineStore } from '~/composables/useTimelineStore'
import { createSpaceTypeClip } from '~/composables/timelineSpaceTypeClip'

describe('clipSpaceTypeStateSource + updateSpaceTypeClipState', () => {
  it('reads clip.state, writes it back, and DETACHES origin on write', () => {
    const store = useTimelineStore()
    // seed a bound timeline with one track holding a spacetype clip that HAS an origin
    store.bind('tl-node-1', () => null, () => {})
    store.addTrack('video')
    const trackId = store.state.value.tracks[store.state.value.tracks.length - 1]!.id
    const clip = createSpaceTypeClip({ startFrame: 0, state: sampleState(), originNodeId: 'origin-node' })
    store.addClip(trackId, clip)

    const src = clipSpaceTypeStateSource(clip.id)
    expect(src.read()?.effectId).toBe('cylinder')
    expect(clip.origin).toBeTruthy() // pre: pinned to origin

    src.write(sampleState({ effectId: 'ribbon' }))
    const after = store.state.value.tracks.flatMap(t => t.clips).find(c => c.id === clip.id) as any
    expect(after.state.effectId).toBe('ribbon')  // edit applied
    expect(after.origin).toBeFalsy()              // detached
  })

  it('write preserves the clip window (in_frame / length / start_frame)', () => {
    const store = useTimelineStore()
    store.bind('tl-node-2', () => null, () => {})
    store.addTrack('video')
    const trackId = store.state.value.tracks[store.state.value.tracks.length - 1]!.id
    const clip = createSpaceTypeClip({ startFrame: 90, state: sampleState(), length: 45 })
    store.addClip(trackId, clip)

    clipSpaceTypeStateSource(clip.id).write(sampleState({ effectId: 'ribbon', loopDuration: 3 }))
    const after = store.state.value.tracks.flatMap(t => t.clips).find(c => c.id === clip.id) as any
    expect(after.start_frame).toBe(90)
    expect(after.in_frame).toBe(0)
    expect(after.length).toBe(45)  // trim untouched by a content edit
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- spacetype-state-source`
Expected: FAIL — `clipSpaceTypeStateSource` / `updateSpaceTypeClipState` not defined.

- [ ] **Step 3a: Add the store mutation**

In `frontend/app/composables/useTimelineStore.ts`, immediately after `syncSpaceTypeClipFromNode` (ends ~line 250), add:

```ts
  /** Edit a Space Type clip's content in place. Replaces state and DETACHES the
   *  clip from its origin node (spec 1's detach model): once edited, the clip is
   *  its own thing, so the "Sync from node" affordance stops offering to revert
   *  the edit. Placement and trim are untouched — only `state` and `origin`. */
  function updateSpaceTypeClipState(clipId: string, next: SpaceTypeState) {
    const clip = state.value.tracks.flatMap(t => t.clips).find(c => c.id === clipId) as SpaceTypeClip | undefined
    if (!clip || clip.kind !== 'spacetype') return
    updateClip(clipId, {
      state: JSON.parse(JSON.stringify(next)),
      origin: undefined,
    } as Partial<Clip>)
  }
```

Then add `updateSpaceTypeClipState,` to the returned object (the `return { ... }` block, next to `syncSpaceTypeClipFromNode,`).

- [ ] **Step 3b: Add the clip source factory**

In `frontend/app/lib/spacetype/stateSource.ts`, add:

```ts
import { useTimelineStore } from '~/composables/useTimelineStore'

/** State stored on a timeline clip's .state. Reads/writes through the singleton
 *  timeline store, so it shares the store's undo history and persistence. */
export function clipSpaceTypeStateSource(clipId: string): SpaceTypeStateSource {
  const store = useTimelineStore()
  return {
    label: 'Space Type · clip',
    read() {
      const clip = store.state.value.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === clipId)
      return clip && clip.kind === 'spacetype' ? clip.state : null
    },
    write(next) {
      store.updateSpaceTypeClipState(clipId, next)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- spacetype-state-source`
Expected: PASS (5 tests total). If `SpaceTypeState`/`SpaceTypeClip`/`Clip` are not yet imported in `useTimelineStore.ts`, add them to the existing import from `~~/shared/timeline/types` and `~~/shared/spacetype/state` (check the file head — `SpaceTypeState` is already imported for `addSpaceTypeClip`).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useTimelineStore.ts frontend/app/lib/spacetype/stateSource.ts frontend/tests/unit/spacetype-state-source.unit.spec.ts
git commit -m "feat(timeline): updateSpaceTypeClipState (write-back + detach) + clip state source"
```

---

### Task 3: Route the studio through the state source (node parity)

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (`loadConfig` ~905, `saveConfig` ~942, `autosaveSignature` ~967)

**Interfaces:**
- Consumes: `nodeSpaceTypeStateSource` (Task 1), `SpaceTypeStateSource`.
- Produces: a `stateSource` computed the rest of the studio reads/writes through. In this task it is *always* the node source — behaviour must be byte-identical to today.

This component has no unit harness (repo convention). The test cycle here is **live verification with revert-to-reproduce**.

- [ ] **Step 1: Add the import and the `stateSource` computed**

Near the other imports at the top of `<script setup>`, add:

```ts
import { nodeSpaceTypeStateSource, type SpaceTypeStateSource } from '~/lib/spacetype/stateSource'
```

After `function currentNode()` (~line 90), add:

```ts
// The studio reads/writes its state through this adapter instead of hard-coding
// the node path. Task 4 makes it clip-aware; here it is always the node source,
// so behaviour is identical to before.
const stateSource = computed<SpaceTypeStateSource>(() => nodeSpaceTypeStateSource(currentNode))
```

- [ ] **Step 2: Point `loadConfig` at the source**

In `loadConfig()` (~905), replace:

```ts
  const n = currentNode()
  const c = n?.data?.properties?.sailor_spaceType
  if (!c) return // first edit of a fresh node — keep the defaults.
```

with:

```ts
  const c = stateSource.value.read()
  if (!c) return // nothing saved yet — keep the defaults.
```

Leave the rest of `loadConfig` (the per-field `typeof` guards) exactly as-is — those guards ARE the default-filling for a clip snapshot that omits `seamless`/`W`/`H`.

- [ ] **Step 3: Point `saveConfig` at the source**

In `saveConfig()` (~942), replace the whole node-write body:

```ts
  const n = currentNode(); if (!n) return
  if (!n.data) n.data = {}
  if (!n.data.properties) n.data.properties = {}
  const prev = n.data.properties.sailor_spaceType || {}
  n.data.properties.sailor_spaceType = {
    ...prev,
    effectId: effectId.value,
    params: { ...params },
    gradientStops: gradientStops.map(s => ({ ...s })),
    post: { ...post },
    fps: fps.value, loopDuration: loopDuration.value, seamless: seamlessLoop.value,
    dimsKey: dimsKey.value, W: W.value, H: H.value, transparent: transparent.value, bgColor: bgColor.value,
    projection: projection.value,
    panX: panX.value, panY: panY.value,
  }
```

with:

```ts
  stateSource.value.write({
    effectId: effectId.value,
    params: { ...params },
    gradientStops: gradientStops.map(s => ({ ...s })),
    post: { ...post },
    fps: fps.value, loopDuration: loopDuration.value, seamless: seamlessLoop.value,
    dimsKey: dimsKey.value, W: W.value, H: H.value, transparent: transparent.value, bgColor: bgColor.value,
    projection: projection.value,
    panX: panX.value, panY: panY.value,
  })
```

(The node source's `write` does the `{ ...prev, ...next }` merge, so `thumb` is still preserved.)

- [ ] **Step 4: Compile-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i spacetypesurface || echo "no new SpaceTypeSurface type errors"`
Expected: `no new SpaceTypeSurface type errors` (pre-existing baseline errors elsewhere are fine — see [typecheck-baseline-anchoring]).

- [ ] **Step 5: Live-verify node parity (with revert-to-reproduce)**

Start the app (`preview_start` name from `.claude/launch.json`, or `cd frontend && npm run dev`), open a project, add a Space Type node, open its studio, change the effect + text, close, reopen. Confirm the edit persisted (loadConfig round-trips through the source). Screenshot as proof.

Then, to prove the source is actually load-bearing: temporarily make `stateSource.value.read()` return `null` (revert step), reload the studio — the saved scene should FAIL to restore. Restore the code — it restores again.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "refactor(spacetype): studio reads/writes state through the source adapter (node parity)"
```

---

### Task 4: Clip mode in the studio

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (props ~80, the `stateSource` computed, `onMounted` param-baker registration ~1151, `onBeforeUnmount` ~1168, the image-upload handler ~1450)

**Interfaces:**
- Consumes: `clipSpaceTypeStateSource` (Task 2).
- Produces: an optional `clipId` prop and a `clipMode` computed; when set, `stateSource` is clip-backed and node-only features are inert.

- [ ] **Step 1: Make `nodeId` optional and add `clipId`**

Change the props definition (~line 80) from:

```ts
const props = defineProps<{ nodeId: string; nodes: any[]; edges?: any[] }>()
```

to:

```ts
const props = defineProps<{ nodeId?: string; nodes?: any[]; edges?: any[]; clipId?: string }>()
```

Then make `currentNode` tolerate the optional arrays — change (~line 90):

```ts
function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }
```

to:

```ts
function currentNode() { return (props.nodes ?? []).find((n: any) => n.id === props.nodeId) }
```

Add, right after it:

```ts
const clipMode = computed(() => !!props.clipId)
```

- [ ] **Step 2: Make `stateSource` clip-aware**

Change the `stateSource` computed (added in Task 3) to:

```ts
import { clipSpaceTypeStateSource } from '~/lib/spacetype/stateSource'
// ...
const stateSource = computed<SpaceTypeStateSource>(() =>
  props.clipId
    ? clipSpaceTypeStateSource(props.clipId)
    : nodeSpaceTypeStateSource(currentNode))
```

- [ ] **Step 3: Guard node-only features in clip mode**

In `onMounted` (~1151), wrap the param-baker registration so it only runs for a node:

```ts
  if (!clipMode.value && props.nodeId) registerStudioParamBaker(props.nodeId, renderBlobWithOverrides)
```

In `onBeforeUnmount` (~1168), guard the matching unregister:

```ts
  if (!clipMode.value && props.nodeId) unregisterStudioParamBaker(props.nodeId)
```

At the top of the image-upload handler (~1450, the function that writes `thumb` back to the node and dispatches `sailor:spaceTypeOutput` with `nodeType: 'Image'`), add a first-line guard:

```ts
  if (clipMode.value) return  // no origin node to attach an uploaded image to
```

(VARS wiring, collection open, and "send to timeline" all key off `props.nodes`/`props.nodeId`; with clip mode passing `:nodes="[]"` and no `nodeId`, their computeds resolve to null and their panels render nothing — no template edit needed.)

- [ ] **Step 4: Compile-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i spacetypesurface || echo "no new SpaceTypeSurface type errors"`
Expected: `no new SpaceTypeSurface type errors`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(spacetype): clip-mode — studio binds to a clip's state, node-only features inert"
```

---

### Task 5: Open-from-clip wiring, Edit affordance, and back

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (open-state ref + handler near ~3079; listener add/remove ~5007/5086; a second mount near ~7961)
- Modify: `frontend/app/components/vue-canvas/timeline/SpaceTypeClipInspector.vue`

**Interfaces:**
- Consumes: the `clipId` prop on `SpaceTypeSurface` (Task 4).
- Produces: the `sailor:openSpaceTypeClip` event (`detail: { clipId: string }`) and a mounted clip-editor instance.

- [ ] **Step 1: Add the Edit affordance to the inspector**

In `frontend/app/components/vue-canvas/timeline/SpaceTypeClipInspector.vue`, add an Edit button that is ALWAYS shown (independent of `canSync`). Replace the `<template>` block with:

```html
<template>
  <div class="space-y-2">
    <button
      type="button"
      class="w-full rounded bg-white/10 px-2 py-1 text-[11px] text-white/80 hover:bg-white/15 transition-colors"
      @click="openEditor"
    >
      Edit in studio →
    </button>
    <div v-if="canSync" class="space-y-1.5">
      <div class="text-[10px] uppercase tracking-[0.12em] text-white/40">Source</div>
      <button
        type="button"
        class="w-full text-left text-[10px] text-white/70 hover:text-white transition-colors"
        @click="emit('sync', clip.id)"
      >
        Sync from node — origin state has changed ↺
      </button>
    </div>
  </div>
</template>
```

And in the `<script setup>`, add the dispatcher after the `canSync` computed:

```ts
function openEditor() {
  window.dispatchEvent(new CustomEvent('sailor:openSpaceTypeClip', { detail: { clipId: props.clip.id } }))
}
```

- [ ] **Step 2: Add the open-state + handler in VueNodeCanvas**

After `closeSpaceTypeEditor` (~line 3092), add:

```ts
// Space Type CLIP editor (edit-in-place on the timeline). Separate from the node
// editor above: it binds the studio to a clip's state, not a node's. The Timeline
// editor stays mounted underneath — closing this returns to it.
const spaceTypeClipEditId = ref<string | null>(null)
function handleOpenSpaceTypeClip(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.clipId) spaceTypeClipEditId.value = String(detail.clipId)
}
function closeSpaceTypeClipEditor() { spaceTypeClipEditId.value = null }
```

- [ ] **Step 3: Register/unregister the listener**

After `window.addEventListener('sailor:openSpaceType', handleOpenSpaceType)` (~5007) add:

```ts
  window.addEventListener('sailor:openSpaceTypeClip', handleOpenSpaceTypeClip)
```

After `window.removeEventListener('sailor:openSpaceType', handleOpenSpaceType)` (~5086) add:

```ts
  window.removeEventListener('sailor:openSpaceTypeClip', handleOpenSpaceTypeClip)
```

- [ ] **Step 4: Mount the clip editor over the timeline**

After the existing Space Type editor `</Teleport>` block (~7968), add:

```html
    <!-- Space Type CLIP editor (edit-in-place; teleported over the open Timeline) -->
    <Teleport to="body">
      <VueCanvasSpaceTypeSurface
        v-if="spaceTypeClipEditId"
        :clip-id="spaceTypeClipEditId"
        :nodes="[]"
        @close="closeSpaceTypeClipEditor"
      />
    </Teleport>
```

- [ ] **Step 5: Live-verify the whole loop**

In the Browser pane: build the bridge-probe piece (or any project with a Space Type clip on a Timeline). Open the Timeline editor, select the Space Type clip → the inspector shows **Edit in studio →**. Click it → the full studio opens over the timeline, showing that clip's effect/text. Change the effect and text, close → back on the timeline, scrub → the clip now shows the edit. Reopen the clip → the change persisted (write-back round-tripped). Confirm the clip's start/length on the timeline are unchanged. Confirm the "Sync from node" line is gone (detached). Screenshot each.

Revert-to-reproduce: temporarily make `openEditor` dispatch nothing — the Edit button does nothing; restore it.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/timeline/SpaceTypeClipInspector.vue
git commit -m "feat(timeline): open a Space Type clip into the studio, edit in place, back"
```

---

### Task 6: Regression + edit-then-retime Playwright coverage

**Files:**
- Modify: `frontend/tests/embed-spacetype.spec.ts`

**Interfaces:**
- Consumes: `updateSpaceTypeClipState` (Task 2) exercised through the running app.

- [ ] **Step 1: Add the edit-reflects + trim-survives case**

Add a test to `frontend/tests/embed-spacetype.spec.ts` that (following the file's existing harness conventions): mounts a Timeline with one Space Type clip; captures a preview frame; calls the store's `updateSpaceTypeClipState(clipId, next)` with a visibly different effect via `page.evaluate`; captures again and asserts the two frames DIFFER (edit reached the pixels); and asserts the clip's `start_frame`/`length` are unchanged (trim survived a content edit). Mirror the existing Layer-2 structure in that file — do not invent a new harness.

```ts
test('editing a Space Type clip in place changes the render but not its trim', async ({ page }) => {
  // ... reuse this file's existing harness to mount a Timeline with one spacetype clip
  //     and expose the store on window (as embed-parity/embed-gradient do).
  const before = await capturePreviewFrame(page)  // existing helper in this file's style
  const trimBefore = await page.evaluate((id) => {
    const s = (window as any).__timelineStore
    const c = s.state.value.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === id)
    return { start: c.start_frame, len: c.length }
  }, clipId)

  await page.evaluate((id) => {
    const s = (window as any).__timelineStore
    const c = s.state.value.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === id)
    s.updateSpaceTypeClipState(id, { ...c.state, effectId: 'ribbon' })
  }, clipId)

  const after = await capturePreviewFrame(page)
  const trimAfter = await page.evaluate((id) => {
    const s = (window as any).__timelineStore
    const c = s.state.value.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === id)
    return { start: c.start_frame, len: c.length }
  }, clipId)

  expect(pixelDiff(before, after)).toBeGreaterThan(0)   // the edit reached the render
  expect(trimAfter).toEqual(trimBefore)                 // trim untouched
})
```

If exposing the store on `window` requires a hook the harness lacks, add the minimal `window.__timelineStore = store` assignment behind the same dev/test gate the file's other cases use — do not expose it in production.

- [ ] **Step 2: Run the case**

Run: `cd frontend && npm run test -- embed-spacetype -g "editing a Space Type clip"`
Expected: PASS.

- [ ] **Step 3: Run the whole Space Type unit + embed suite as a regression gate**

Run: `cd frontend && npm run test:unit -- spacetype && npm run test -- embed-spacetype`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/embed-spacetype.spec.ts
git commit -m "test(timeline): edit-in-place reaches the render, trim survives"
```

---

## Deferred to a follow-up (not this plan)

- **Pause the Timeline editor's preview rAF while the clip editor is open.** Correctness does not need it (the studio covers the timeline); it is a perf nicety. Wire it through the existing occlusion signal when convenient.
- **Breadcrumb chrome** (an explicit "‹ Timeline" label in the studio header for clip mode). Close already returns to the timeline; the label is polish.
- Everything in the Room UX spec (`2026-08-28-timeline-room-ux-design.md`) — the doors, the rail, export-as-job — is its own plan.

## Self-review notes

- **Spec coverage:** state-source adapter (T1) · node impl (T1) · clip impl + store write-back (T2) · studio consumes the source (T3) · clip mode + node-only gating (T4) · open-from-clip navigation + Edit affordance (T5) · detach model (T2, verified T5) · tests incl. write-preserves-window and node regression (T2, T6). The spec's "read fills defaults for seamless/W/H" is satisfied by `loadConfig`'s existing per-field `typeof` guards (noted in T3 step 2) rather than new code.
- **Type consistency:** `SpaceTypeStateSource`, `nodeSpaceTypeStateSource`, `clipSpaceTypeStateSource`, `updateSpaceTypeClipState` are used with identical names/signatures across T1–T5.
- **No component-test framework:** T3–T5 use live-verify with revert-to-reproduce by design; pure logic (T1, T2) and the render-diff (T6) carry the automated coverage.
