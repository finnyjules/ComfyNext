# Compositor Paste + Copy-Wired-Into-Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Cmd/Ctrl+V pastes a clipboard image into an open Compositor as a local image layer. (B) A wired image can be "copied into the frame" — baked into a normal local layer at the same position, then the wired slot is hidden — so the frame owns it and it survives unplugging the wire.

**Architecture:** Both reuse existing machinery. Paste calls the same `addImageFromFile` drag-drop uses, registered in the **capture** phase so `VueNodeCanvas`'s global bubble-phase paste (which spawns a graph node) never fires. Copy bakes source pixels + the slot's `maskUrl`, places the layer with the already-unit-tested `wiredCutoutPlacement`, pins its z via `sailor_stackOrder`, and hides the slot via `sailor_hiddenWired` — plus a prune of stale slot flags that fixes a pre-existing invisible-image trap.

**Tech Stack:** Vue 3 SFC (Nuxt 4), Canvas 2D, vitest (node env), `vue-sonner` toasts.

**Spec:** `docs/superpowers/specs/2026-07-24-compositor-paste-and-copy-wired-into-frame-design.md`

## Global Constraints

- **No new persistence primitives.** Reuse `sailor_stackOrder`, `sailor_hiddenWired`, `sailor_lockedWired`, `sailor_wiredTreatments`, and the existing local-layer add path.
- **Paste must not double-fire.** `VueNodeCanvas` registers `window.addEventListener('paste', handlePaste)` (bubble, `VueNodeCanvas.vue:4571`). The modal MUST listen with `capture: true` and call `stopImmediatePropagation()` when it consumes an image, or the user gets a layer *and* a stray Image node.
- **Never hijack a text paste.** Bail when `e.target` or `document.activeElement` is/inside `input, textarea, select, [contenteditable]` — mirror `VueNodeCanvas.handlePaste`'s guard.
- **Copy is "what you see":** native-resolution source pixels with the slot's `maskUrl` baked in (`destination-out`, same polarity as `drawWiredImageLayer`), carrying `opacity`, `blend`, and any `maskedByKey`/`showSource` treatment.
- **Hide only after success.** The wired slot is hidden only once the copied layer has actually been added — a failed upload must never leave an empty frame.
- **Prune is edge-derived and must not run before the node resolves.** `layers` returns `[]` when `compositor.value` is null; pruning then would wipe every flag. Guard on `compositor.value` first.
- **Undo gap is documented, not fixed.** `sailor_hiddenWired` is a node property and is not in the undo history (same as all wired treatments). The Copy button's tooltip says so; recovery is the row's Show toggle. Do NOT add node-property undo in this plan.
- Typecheck: repo has ~400–700 pre-existing `vue-tsc` errors; only NEW errors in touched files matter (`npx vue-tsc --noEmit 2>&1 | grep -iE "<symbol>"`). Unit tests run in vitest `environment: 'node'` — pure helpers only, no DOM.
- Git hygiene: stage ONLY this feature's files per task; parallel sessions dirty the tree (`ArtifactFrameNode.vue` and `CompositorModal.vue` have carried foreign hunks this session — check `git diff --stat` before every commit and use `git apply --cached` for own-hunks-only if needed). Never `git add -A`, never stash. Main-direct commits, each ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Dev URLs use `127.0.0.1`.

---

### Task 1: Pure slot/order helpers + unit tests

**Files:**
- Create: `frontend/app/lib/compositor/wiredSlots.ts`
- Test: `frontend/tests/unit/wired-slots.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 3–4):
  - `pruneWiredSlotFlags(flags: number[], liveSlots: number[]): number[] | null` — drops flag entries whose slot has no wire; returns `null` when nothing changed (so the caller can skip a redundant node write).
  - `insertStackKeyAbove(order: string[], key: string, anchor: string): string[]` — returns a new bottom→top order with `key` directly above `anchor`; appends to the top when the anchor is absent; moves `key` if it was already present (never duplicates).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/wired-slots.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pruneWiredSlotFlags, insertStackKeyAbove } from '~/lib/compositor/wiredSlots'

describe('pruneWiredSlotFlags', () => {
  it('drops flags for slots that no longer have a wire', () => {
    expect(pruneWiredSlotFlags([2, 5], [1, 2])).toEqual([2])
  })
  it('returns null when every flagged slot is still live (no write needed)', () => {
    expect(pruneWiredSlotFlags([2], [1, 2])).toBeNull()
  })
  it('returns null for an empty flag list', () => {
    expect(pruneWiredSlotFlags([], [1])).toBeNull()
  })
  it('drops everything when no slots are wired', () => {
    expect(pruneWiredSlotFlags([2, 3], [])).toEqual([])
  })
  it('preserves the original order of surviving entries', () => {
    expect(pruneWiredSlotFlags([5, 1, 3], [1, 5])).toEqual([5, 1])
  })
})

describe('insertStackKeyAbove', () => {
  it('inserts directly above the anchor (array is bottom→top)', () => {
    expect(insertStackKeyAbove(['w:1', 'w:2', 'l:a'], 'l:new', 'w:2'))
      .toEqual(['w:1', 'w:2', 'l:new', 'l:a'])
  })
  it('appends to the top when the anchor is absent', () => {
    expect(insertStackKeyAbove(['w:1'], 'l:new', 'w:9')).toEqual(['w:1', 'l:new'])
  })
  it('moves the key rather than duplicating it when already present', () => {
    expect(insertStackKeyAbove(['l:new', 'w:1'], 'l:new', 'w:1')).toEqual(['w:1', 'l:new'])
  })
  it('does not mutate the input array', () => {
    const order = ['w:1', 'w:2']
    insertStackKeyAbove(order, 'l:new', 'w:1')
    expect(order).toEqual(['w:1', 'w:2'])
  })
})
```

- [ ] **Step 2: Run — verify RED**

Run: `cd frontend && npx vitest run tests/unit/wired-slots.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/compositor/wiredSlots`.

- [ ] **Step 3: Implement**

Create `frontend/app/lib/compositor/wiredSlots.ts`:

```ts
/**
 * Pure helpers for wired-slot bookkeeping on the Compositor node (no DOM, so
 * they unit-test in the vitest node env).
 *
 * Wired slots are derived from EDGES only, so a slot that isn't in `liveSlots`
 * is genuinely gone — there's no load-time window where a wired slot looks
 * absent. That's what makes pruning safe.
 */

/**
 * Drop hidden/locked flag entries for slots that no longer have a wired source.
 * Returns `null` when nothing changed, so callers can skip a redundant node
 * write (and the node-property churn it causes).
 *
 * Without this, hiding a slot and then unplugging its wire leaves a stale slot
 * number behind, and the NEXT image wired into that port renders invisible with
 * no visible cause.
 */
export function pruneWiredSlotFlags(flags: number[], liveSlots: number[]): number[] | null {
  if (!flags.length) return null
  const live = new Set(liveSlots)
  const kept = flags.filter(s => live.has(s))
  return kept.length === flags.length ? null : kept
}

/**
 * Place `key` directly above `anchor` in a bottom→top stack order. Used when a
 * wired layer is copied into the frame: the copy must hold the wired slot's
 * z-position instead of jumping to the top of the stack.
 *
 * Absent anchor ⇒ append (top). Already-present key ⇒ moved, never duplicated.
 */
export function insertStackKeyAbove(order: string[], key: string, anchor: string): string[] {
  const without = order.filter(k => k !== key)
  const i = without.indexOf(anchor)
  if (i < 0) return [...without, key]
  return [...without.slice(0, i + 1), key, ...without.slice(i + 1)]
}
```

- [ ] **Step 4: Run — verify GREEN**

Run: `cd frontend && npx vitest run tests/unit/wired-slots.unit.spec.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/wiredSlots.ts frontend/tests/unit/wired-slots.unit.spec.ts
git commit -m "feat(compositor): pure wired-slot flag prune + stack-order insert helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Paste an image into the Compositor (Feature A)

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`

**Interfaces:**
- Consumes: existing `addImageFromFile` (from the local layer editor), `toast` (already imported from `vue-sonner` at line ~56).
- Produces: nothing downstream.

- [ ] **Step 1: Add the paste handler**

Insert directly ABOVE the `onMounted(() => window.addEventListener('keydown', handleKeydown))` line (search that exact text; it sits at the end of `<script setup>`):

```ts
// ── Paste an image into the frame ───────────────────────────────────────────
// Cmd/Ctrl+V with an image on the clipboard adds it as a local image layer via
// the SAME path as drag-drop (addImageFromFile), so upload, history and
// selection behave identically. Registered in the CAPTURE phase on purpose:
// VueNodeCanvas listens for 'paste' on window in the bubble phase and would
// otherwise turn the image into a standalone Image node on the graph. Capture
// runs first, and stopImmediatePropagation keeps that handler from firing.
function isEditablePasteTarget(n: EventTarget | null): boolean {
  const el = n instanceof Element ? n : null
  if (!el) return false
  const sel = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
  return el.matches(sel) || !!el.closest(sel)
}
function clipboardImageFile(e: ClipboardEvent): File | null {
  for (const it of Array.from(e.clipboardData?.items ?? [])) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) return f
    }
  }
  const f0 = e.clipboardData?.files?.[0]
  return f0 && f0.type.startsWith('image/') ? f0 : null
}
async function onModalPaste(e: ClipboardEvent) {
  // Never hijack a real text paste (agent prompt bar, layer rename, text edit).
  if (isEditablePasteTarget(e.target) || isEditablePasteTarget(document.activeElement)) return
  const file = clipboardImageFile(e)
  if (!file) return   // nothing for us — let normal paste (incl. node paste) proceed
  e.preventDefault()
  e.stopImmediatePropagation()
  try {
    await addImageFromFile(file)
  } catch (err) {
    console.error('[Compositor] paste image failed:', err)
    toast('Could not paste that image')
  }
}
```

- [ ] **Step 2: Register / unregister the listener**

Replace the existing mount/unmount pair:

```ts
onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('paste', onModalPaste, true)   // capture — see onModalPaste
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('paste', onModalPaste, true)
  detachPointerListeners()
  pause()
})
```

The `true` third argument must be present on BOTH add and remove — a capture listener removed without it leaks.

- [ ] **Step 3: Verify**

- `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "onModalPaste|clipboardImageFile|isEditablePasteTarget"` → no output.
- Serve-compile (dev server on 127.0.0.1, port varies): `curl -s http://127.0.0.1:<port>/_nuxt/components/vue-canvas/CompositorModal.vue | grep -c onModalPaste` → ≥ 2. If no dev server is up, note it.
- Regression: `cd frontend && npx vitest run tests/unit/wired-slots.unit.spec.ts tests/unit/smart-select.unit.spec.ts` → pass.

Runtime behavior is verified in Task 5.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git diff --stat   # confirm ONLY CompositorModal.vue
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): paste a clipboard image into the frame as a local layer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Copy a wired image into the frame (Feature B)

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`

**Interfaces:**
- Consumes: `insertStackKeyAbove` (Task 1), `wiredCutoutPlacement` (`~/lib/compositor/smartSelect`, signature `(bbox, layer: WiredXform, iw, ih, capW, capH, W, H)`), existing modal internals: `layers`, `wiredImageEls`, `wiredTreatments`, `compositor`, `readSlotArr`/`writeSlotArr`, `stackKeys`, `localKey`, `wiredKey`, `localLayers`, `addImageFromName`, `inpaint.uploadDataUrl`, `loadImage`, `canvasDisplay`, `renderStack`, `toast`.
- Produces: `copyWiredIntoFrame(slot)` + `copyingSlot` (used by the row button).

- [ ] **Step 1: Add imports**

Add `Copy` to the existing `lucide-vue-next` import block (it already imports `Eye, EyeOff, ...`). Add to the compositor-lib imports:

```ts
import { insertStackKeyAbove } from '~/lib/compositor/wiredSlots'
```

and add `wiredCutoutPlacement` to the existing `~/lib/compositor/smartSelect` import (it already imports `wiredImageAffine`, `applyAffine`, etc. — check whether `wiredCutoutPlacement` is already there from the smart-select work and only add it if missing).

- [ ] **Step 2: Add the small write helpers**

Place next to the existing `toggleWiredFlag` (search `function toggleWiredFlag`):

```ts
/** Set (not toggle) a wired slot's hidden flag. */
function setWiredHidden(slot: number, hidden: boolean) {
  const cur = readSlotArr('sailor_hiddenWired')
  if (cur.includes(slot) === hidden) return
  writeSlotArr('sailor_hiddenWired', hidden ? [...cur, slot] : cur.filter(s => s !== slot))
}
/** Persist a full bottom→top stack order. */
function writeStackOrder(arr: StackKey[]) {
  const node = compositor.value
  if (!node) return
  if (!node.data.properties) node.data.properties = {}
  ;(node.data.properties as any).sailor_stackOrder = arr
}
```

- [ ] **Step 3: Add the copy action**

Place after the wired-mask helpers (search `function clearWiredMask` — put it directly after that function):

```ts
// ── Copy a wired image into the frame ───────────────────────────────────────
// Bakes what you SEE for a wired slot (source pixels + any painted/smart-select
// mask) into a normal local image layer at the same z-position, transform,
// opacity and blend — then hides the wired slot so you see one image, not two.
// The frame then owns the image: it survives unplugging the wire and supports
// every local-layer feature (Generate fill, destructive edits, …).
const copyingSlot = ref<number | null>(null)
async function copyWiredIntoFrame(slot: number) {
  if (copyingSlot.value != null) return
  const layer = layers.value.find(l => l.slot === slot)
  const el = wiredImageEls.value[slot]
  const iw = el ? (('naturalWidth' in el ? el.naturalWidth : el.width) || 0) : 0
  const ih = el ? (('naturalHeight' in el ? el.naturalHeight : el.height) || 0) : 0
  if (!layer || !el || !iw || !ih) { toast('That layer’s image isn’t ready yet'); return }
  copyingSlot.value = slot
  try {
    // 1. Bake: native-resolution source with the slot's visibility mask applied
    //    (destination-out — same polarity drawWiredImageLayer uses).
    const c = document.createElement('canvas'); c.width = iw; c.height = ih
    const ctx = c.getContext('2d')!
    ctx.drawImage(el, 0, 0, iw, ih)
    const tr = wiredTreatments.value[`w:${slot}`]
    if (tr?.maskUrl) {
      try {
        const mi = await loadImage(tr.maskUrl)
        ctx.globalCompositeOperation = 'destination-out'
        ctx.drawImage(mi, 0, 0, iw, ih)
        ctx.globalCompositeOperation = 'source-over'
      } catch { /* unreadable mask → copy the image unmasked rather than failing */ }
    }
    let dataUrl: string
    try { dataUrl = c.toDataURL('image/png') }
    catch (err) {
      console.error('[Compositor] copy into frame: pixel read failed', err)
      toast('Can’t read this image’s pixels')
      return
    }
    const name = await inpaint.uploadDataUrl(dataUrl, 'framecopy')
    // 2. Place it exactly where the wired image sits. A full-image bbox makes
    //    wiredCutoutPlacement reproduce the wired transform (its own unit test).
    const place = wiredCutoutPlacement(
      { minX: 0, minY: 0, maxX: iw - 1, maxY: ih - 1 },
      { x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation },
      iw, ih, iw, ih, canvasDisplay.w, canvasDisplay.h,
    )
    const before = new Set(localLayers.value.map(l => l.id))
    addImageFromName(name, iw / ih, {
      ...place,
      opacity: layer.opacity,
      blend: layer.blend,
      // A wired image clipped by another layer's silhouette stays clipped —
      // carried as the same treatment rather than baked into the pixels.
      ...(tr?.maskedByKey ? { maskedByKey: tr.maskedByKey, maskShowSource: tr.showSource || undefined } : {}),
    } as any)
    const added = localLayers.value.find(l => !before.has(l.id))
    // 3. Hold the wired slot's z-position (else the copy jumps to the top).
    if (added) writeStackOrder(insertStackKeyAbove(stackKeys.value, localKey(added.id), wiredKey(slot)) as StackKey[])
    // 4. Hide the now-redundant wired slot — only after the copy landed, so a
    //    failed upload never leaves an empty frame.
    setWiredHidden(slot, true)
    if (layer.cloner?.enabled) toast('Copied the base image — cloner repeats aren’t carried over.')
    renderStack()
  } catch (err) {
    console.error('[Compositor] copy into frame failed:', err)
    toast('Could not copy that layer into the frame')
  } finally {
    copyingSlot.value = null
  }
}
```

- [ ] **Step 4: Add the row button**

In the Layers-panel row template, directly AFTER the visibility (Eye/EyeOff) button block and before the group-opacity slider (search `title="Hide"` / `toggleRowHidden(row)` to locate it):

```html
              <!-- Copy a wired image into the frame: bake a local copy, hide the wire -->
              <button v-if="row.kind === 'wired'"
                class="transition cursor-pointer opacity-0 group-hover/row:opacity-100 text-white/40 hover:text-white/80 disabled:opacity-30 disabled:cursor-default"
                :disabled="copyingSlot != null"
                title="Copy into frame — bakes a local copy and hides the wired layer (not undoable; use Show to restore)"
                data-testid="wired-copy-into-frame"
                @click.stop="copyWiredIntoFrame(row.slot)">
                <Copy class="size-3.5" />
              </button>
```

- [ ] **Step 5: Verify**

- `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "copyWiredIntoFrame|copyingSlot|setWiredHidden|writeStackOrder|insertStackKeyAbove"` → no output.
- Serve-compile: `curl -s http://127.0.0.1:<port>/_nuxt/components/vue-canvas/CompositorModal.vue | grep -c copyWiredIntoFrame` → ≥ 2 (else note no dev server).
- Regression: `cd frontend && npx vitest run tests/unit/wired-slots.unit.spec.ts tests/unit/smart-select.unit.spec.ts tests/unit/wired-mask-plan.unit.spec.ts` → all pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git diff --stat   # confirm ONLY CompositorModal.vue
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): copy a wired image into the frame as a local layer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Prune stale wired slot flags (the invisible-image trap)

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue`

**Interfaces:**
- Consumes: `pruneWiredSlotFlags` (Task 1), `layers`, `compositor`, `readSlotArr`/`writeSlotArr`.

**Why:** `sailor_hiddenWired` / `sailor_lockedWired` hold bare slot numbers and are never cleaned up. Hide a slot → unplug its wire → the entry survives → the NEXT image wired into that port renders invisible with no visible cause. Task 3's auto-hide makes hitting this much more likely.

- [ ] **Step 1: Add the prune watch**

Add `pruneWiredSlotFlags` to the `~/lib/compositor/wiredSlots` import from Task 3. Place the watch directly after the `hiddenWired` / `lockedWired` computeds (search `const lockedWired = computed`):

```ts
// Drop hidden/locked flags for slots that no longer have a wire. Slots come
// from EDGES only (see the `layers` computed), so an absent slot is genuinely
// gone — there's no load-time window where a legitimately hidden slot looks
// absent. Without this, hiding a slot and unplugging it leaves a stale entry
// and the NEXT image wired into that port renders invisible.
watch(layers, (ls) => {
  // `layers` is [] while the node is still resolving — pruning then would wipe
  // every flag, so require a resolved compositor node first.
  if (!compositor.value) return
  const live = ls.map(l => l.slot)
  for (const key of ['sailor_hiddenWired', 'sailor_lockedWired'] as const) {
    const pruned = pruneWiredSlotFlags(readSlotArr(key), live)
    if (pruned) writeSlotArr(key, pruned)   // null ⇒ unchanged, skip the write
  }
}, { immediate: true })
```

- [ ] **Step 2: Verify**

- `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "pruneWiredSlotFlags"` → no output.
- Serve-compile: `curl -s http://127.0.0.1:<port>/_nuxt/components/vue-canvas/CompositorModal.vue | grep -c pruneWiredSlotFlags` → ≥ 1 (else note).
- Regression: `cd frontend && npx vitest run tests/unit/wired-slots.unit.spec.ts` → pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git diff --stat   # confirm ONLY CompositorModal.vue
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "fix(compositor): prune stale hidden/locked flags for unwired slots

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: E2E verification in the running app

**Files:** none (verification; fix-forward into the task files above).

Harness notes from prior sessions: patch `Element.prototype.setPointerCapture = () => {}` before synthetic pointer events; `javascript_tool`'s 30s cap kills only the caller (page-side async keeps running); the blank-project button often needs a full synthetic mouse sequence (`pointerdown/mousedown/pointerup/mouseup/click`); a `[data-smart-bar]`-style guard can swallow drags near overlays. **Creating a real Image→Compositor edge is NOT achievable via synthetic events** (vue-flow's connection system ignores them) — so Feature B's wired steps below need either a manually-wired project or a hand check by the user.

- [ ] **Step 1: Verify paste (Feature A) — fully automatable**

Open a blank project → add a Compositor node → open it. Then, in the page:
1. Build a `File` from a canvas blob, wrap it in a `DataTransfer`, and dispatch `new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })` on `window`.
2. Assert: exactly one new image layer appears in the Layers panel, AND `document.querySelectorAll('.vue-flow__node').length` is unchanged (no stray Image node — this is the capture-phase/`stopImmediatePropagation` contract).
3. Focus the agent prompt bar (`textarea`) and repeat the paste → assert NO new layer is added (the editable-target guard).

- [ ] **Step 2: Verify copy-into-frame (Feature B) — needs a wired image**

With an image wired into a Compositor (hand-wired):
1. Hover the wired row → the Copy button (`[data-testid="wired-copy-into-frame"]`) appears; click it.
2. The composite looks unchanged (capture the stack canvas data URL before/after — the copy should be visually near-identical; small PNG-resample differences are acceptable, a jump in position/size is not).
3. The Layers panel shows a new local image layer at the wired slot's z-position, and the wired row is now hidden (eye off).
4. Paint a mask on a wired image first, then copy → the hidden region is baked into the copy.
5. Unplug the wire → the copy survives unchanged.
6. Wire a *different* image into that same port → it is **visible** (the prune fix; before this it would render invisible).

- [ ] **Step 3: Update memory + report**

Record what landed, what was verified live vs. statically, and any residual minors in the auto-memory. Be explicit about which Feature-B steps were hand-checked vs. not run.
