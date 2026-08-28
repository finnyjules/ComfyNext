# Frame Wired/Native Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wired layers become native layers (one species: unified selection, align, group, nudge, resize, hide/lock/rename), and the Compositor modal's stage goes full-bleed with hideable panels.

**Architecture:** A new `wired` LocalLayer kind stores the transform/box; the wire slot becomes a pure content feed resolved at draw time via a host-registered provider (same indirection pattern as `_registerMotionPainter`). A one-way write-through mirrors each wired layer's transform into the `layer{N}_*` widgets so the Python Compositor node and server Render are untouched. A versioned migration (`sailor_frameSchema: 2`) synthesizes wired layers from the old widget/registry state on first open.

**Tech Stack:** Vue 3.5 / Nuxt 4, TypeScript, canvas 2D, vitest (`frontend/tests/unit/*.unit.spec.ts`), Playwright-style browser verification via `frontend/app/pages/dev/frame-lab.vue`.

**Spec:** `docs/superpowers/specs/2026-08-27-frame-wired-native-unification-design.md`

## Global Constraints

- Modal-first: `CompositorModal.vue` is the real editor; `ArtifactFrameNode.vue` (the card) must keep painting correctly from the unified model but does NOT gain new verbs.
- Liveness is sacred: wired content must keep updating when upstream re-runs; studio slots keep animating.
- Server Render path unchanged in v1: the Python node keeps reading `layer{N}_x/y/rotation/scale/opacity/blend/protect` widgets (one-way write-through).
- v1 restrictions: ⌘D on a wired layer materializes a snapshot copy (existing copy-wired-into-frame path), never a second live reference. Wired resize is corner-anchored and aspect-locked (no edge-stretch; content keeps natural aspect).
- Known repo gotchas (from memory, verify before relying): `convertToLiteGraph` silently drops unknown `node.data` fields — every new persisted key must survive a save/reload round-trip; port schema sync merges by NAME at rehydration; no commas inside comments on export lines (mlly scanner bug); Vue 3.5 template ref in `v-for` is an array; run `npx vue-tsc --noEmit` against the existing baseline (pre-existing errors that don't name your types are not yours).
- Commit style: small commits per task, main-direct, stage ONLY files you touched (parallel sessions may be active — never `git add -A`, never stash).
- All UI copy plain-language; action blue is the only accent; use `StudioButton` for buttons on studio chrome.

## File Structure

- Create: `frontend/app/lib/compositor/wiredLayer.ts` — WiredLayer helpers: factory, slot-transform read/write mapping (pure, no Vue).
- Create: `frontend/app/lib/compositor/wiredMigration.ts` — schema-2 migration (pure, operates on a node-shaped object).
- Create: `frontend/tests/unit/wired-layer.unit.spec.ts`, `frontend/tests/unit/wired-migration.unit.spec.ts` — unit coverage.
- Modify: `frontend/app/composables/useCompositorLayers.ts` — `WiredLayer` type in the `LocalLayer` union; paint dispatch for `kind: 'wired'` via a registered content provider.
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` — write-through hook on commit; delete-disconnects-edge contract surface.
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` — run migration on open; retire `selectedSlot`; unified selection/handles/verbs; Part B stage/chrome.
- Modify: `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` — build stack items from unified model; keep lite behavior.
- Modify: `frontend/app/pages/dev/frame-lab.vue` — fixture gains wired slots for browser verification.

---

### Task 1: WiredLayer type + factory + slot-transform mapping

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (types at :16 and :325, `LayerCommon` at :150, `ImageLayer` at :289 as the model)
- Create: `frontend/app/lib/compositor/wiredLayer.ts`
- Test: `frontend/tests/unit/wired-layer.unit.spec.ts`

**Interfaces:**
- Produces: `WiredLayer` (in the `LocalLayer` union), `createWiredLayer(slot, partial?)`, `wiredBoxFromWidgets(tf, natural, canvas)`, `widgetsFromWiredBox(layer, natural, canvas)`.
- `WiredLayer extends LayerCommon { kind: 'wired'; slot: number; w: number; lastAspect: number; unlinked?: boolean }` — `w` normalized to canvas width like every layer; render height derives from the LIVE content aspect (`h = w * (contentH/contentW) * (canvasW/canvasW)` in width-normalized units, i.e. `h = w * aspectInv`); `lastAspect` (h/w of content) persists the last-known aspect for the unlinked state.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/unit/wired-layer.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { createWiredLayer, wiredBoxFromWidgets, widgetsFromWiredBox } from '~/lib/compositor/wiredLayer'

describe('wired layer mapping', () => {
  const natural = { w: 800, h: 600 }          // content pixels
  const canvas = { w: 1024, h: 1024 }

  it('creates a wired layer with defaults matching the old default placement', () => {
    const l = createWiredLayer(3)
    expect(l.kind).toBe('wired')
    expect(l.slot).toBe(3)
    expect(l.x).toBeCloseTo(0.5)
    expect(l.y).toBeCloseTo(0.5)
    expect(l.rotation).toBe(0)
    expect(l.opacity).toBe(1)
  })

  it('round-trips widget transform -> box -> widget transform', () => {
    const tf = { x: 0.1, y: -0.2, rotation: 15, scale: 1.5, opacity: 0.8 }
    const box = wiredBoxFromWidgets(tf, natural, canvas)
    const back = widgetsFromWiredBox({ ...createWiredLayer(0), ...box }, natural, canvas)
    expect(back.x).toBeCloseTo(tf.x, 5)
    expect(back.y).toBeCloseTo(tf.y, 5)
    expect(back.rotation).toBeCloseTo(tf.rotation, 5)
    expect(back.scale).toBeCloseTo(tf.scale, 5)
    expect(back.opacity).toBeCloseTo(tf.opacity, 5)
  })

  it('identity transform maps to the same box the old fit-draw produced', () => {
    // scale=1, x=y=0 must reproduce the legacy "fit to canvas" box so migrated
    // frames render pixel-identically.
    const box = wiredBoxFromWidgets({ x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }, natural, canvas)
    expect(box.x).toBeCloseTo(0.5)
    expect(box.y).toBeCloseTo(0.5)
    // 800x600 in 1024x1024: fit => width-limited => w = 1 (full canvas width)
    expect(box.w).toBeCloseTo(1)
  })
})
```

- [ ] **Step 2: Run and confirm failure** — `cd frontend && npx vitest run tests/unit/wired-layer.unit.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement.** First READ the legacy fit+transform draw (`drawWiredImageLayer` in `useCompositorLayers.ts`, and `fitSize` at `CompositorModal.vue:321`) and copy its exact fit math into `wiredBoxFromWidgets` / `widgetsFromWiredBox` so the identity test passes against the real formula, not an assumed one. Then:
  - In `useCompositorLayers.ts`: add `'wired'` to `LocalLayerKind` (:16), add the `WiredLayer` interface next to `ImageLayer` (:289), add it to the `LocalLayer` union (:325).
  - In `wiredLayer.ts`: `createWiredLayer` mirrors the other factories (id generation, defaults); the two mapping functions are pure math over `{x,y,rotation,scale,opacity}` widgets ↔ `{x,y,w,rotation,opacity}` box.

- [ ] **Step 4: Run tests to green**, plus `npx vue-tsc --noEmit` — every switch over `LocalLayer['kind']` that fails to compile now gets an explicit `wired` arm (find them via the type errors; handle as no-op where wired can't occur yet).

- [ ] **Step 5: Commit** — `feat(frame): WiredLayer type + widget/box mapping`

### Task 2: Paint dispatch for wired layers (live content via provider)

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (`StackItem` at :1486, `paintLayerStack` at :1627, `drawLocalLayer` dispatch, `layerPaints` — wired returns `[]` or `[tint]` if you carry tint over)
- Test: `frontend/tests/unit/wired-layer.unit.spec.ts` (extend)

**Interfaces:**
- Produces: `_registerWiredContent(provider: (slot: number) => CanvasImageSource | null)` — module-level indirection, same pattern as `_registerMotionPainter` (:66). `drawLocalLayer` gains a `wired` case: resolve content, draw into the layer's box (center x/y, width w, height from live aspect; fall back to `lastAspect` when provider returns null and mark nothing — the caller renders the unlinked badge from `layer.unlinked`).
- Consumes: `WiredLayer` from Task 1.

- [ ] **Step 1: Failing test** — a fixture provider returning a 2×1 `OffscreenCanvas`; paint a `WiredLayer {w: 0.5, x: 0.5, y: 0.5}` into a 100×100 canvas via `paintLayerStack` with `items = [{type:'local', key:'l:a', layer}]`; assert pixels at the box center are the provider's color and the corner is transparent.
- [ ] **Step 2: Run, confirm FAIL** (wired case not drawn).
- [ ] **Step 3: Implement** the provider registry + `wired` draw case. Route through the SAME code path that gives locals blend/opacity/effects/mask/cloner/animation (the generic `LayerCommon` machinery in the item loop) — do not fork a parallel path. The aspect used is `content.height/content.width` from the provider's source each frame (liveness); if provider returns null use `lastAspect`.
- [ ] **Step 4: Green + vue-tsc.**
- [ ] **Step 5: Commit** — `feat(frame): paint wired layers through the local-layer pipeline`

### Task 3: Migration to `sailor_frameSchema: 2`

**Files:**
- Create: `frontend/app/lib/compositor/wiredMigration.ts`
- Test: `frontend/tests/unit/wired-migration.unit.spec.ts`

**Interfaces:**
- Produces: `migrateFrameToUnifiedLayers(node: FrameNodeShape, naturalDims: Record<number, {w:number,h:number}|undefined>): boolean` (returns true if it migrated; false if already schema 2 or no frame data). `FrameNodeShape` is the minimal structural type: `{ data: { properties: Record<string, any>, widgetsValues: any[], widgets?: ... }, ... }` — model the widget-index lookup on the existing `widgetIdx` helper in `ArtifactFrameNode.vue` (read it first; reuse, don't reinvent).
- Consumes: `createWiredLayer`, `wiredBoxFromWidgets` (Task 1).

Migration folds ALL per-slot registries into the layer, for each CONNECTED slot:
- transform widgets → box via `wiredBoxFromWidgets` (when `naturalDims[slot]` is unknown, create the layer with `w` unset sentinel `-1` and `lastAspect: 1`; the first paint with real content finalizes `w` via the same function and persists — this keeps migration synchronous),
- `sailor_hiddenWired` → `visible: false`; `sailor_lockedWired` → `locked: true`,
- `sailor_wiredCloners[slot]` → `layer.cloner`,
- wired treatments (`useWiredTreatments` keys: `maskedByKey`, `showSource`) → `layer.maskedByKey` / `layer.maskShowSource`,
- `sailor_stackOrder`: every `w:<slot>` key replaced IN PLACE by `l:<newLayerId>`; any `maskedByKey: 'w:<slot>'` on other layers rewritten to the new `l:` key,
- set `sailor_frameSchema = 2`; leave the old registries in place untouched (rollback safety) but never read them again on schema 2.

- [ ] **Step 1: Failing tests** — cover: (a) full migration of a 2-slot fixture node (transform, hidden, locked, cloner, treatment, stackOrder rewrite, maskedByKey rewrite), (b) idempotence: second call returns false and changes nothing (`JSON.stringify` before === after), (c) no-connected-slots node gets the flag and no layers, (d) unknown naturalDims → sentinel `w: -1` layer.
- [ ] **Step 2: FAIL.** — module not found.
- [ ] **Step 3: Implement** per the contract above.
- [ ] **Step 4: Green.**
- [ ] **Step 5: Verify persistence survives serialization:** find `convertToLiteGraph` (grep in `frontend/app/`), confirm `sailor_frameSchema` and `sailor_localLayers` (already carried) survive the round-trip; add the key to its field allowlist if one exists. Add a unit test if the function is importable.
- [ ] **Step 6: Commit** — `feat(frame): schema-2 migration folds wired registries into layers`

### Task 4: Widget write-through

**Files:**
- Modify: `frontend/app/lib/compositor/wiredLayer.ts` (add `syncWiredWidgets`)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (call it from the single mutation choke point — `commit`/`setLocal`; the editor doc at :127 says it IS the choke point)
- Test: `frontend/tests/unit/wired-layer.unit.spec.ts` (extend)

**Interfaces:**
- Produces: `syncWiredWidgets(node, layer: WiredLayer, naturalDims)` — writes `layer{slot+1}_x/y/rotation/scale/opacity/blend` (+ `protect`) widget values from the layer via `widgetsFromWiredBox`. Called after every mutation that touches a wired layer (move, resize, rotate, opacity, blend, delete leaves widgets alone — the edge disconnect is what removes it server-side).
- Consumes: Task 1 mapping; editor internals.

- [ ] **Step 1: Failing test** — mutate a wired layer's box on a fixture node, call `syncWiredWidgets`, assert the widget values match `widgetsFromWiredBox` output.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: green + vue-tsc.**
- [ ] **Step 5: Commit** — `feat(frame): one-way write-through of wired transforms to slot widgets`

### Task 5: Modal adopts the unified model (migration on open, selectedSlot retired)

This is the surgery task. The implementer MUST read `CompositorModal.vue` regions cited below before editing.

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` — 14 `selectedSlot` sites (grep); selection at :772-783; hit test `layerHitAt`/`hitTopStackKey` :1141-1168; invisible pointer-target imgs :3737-3751; `buildStackItems` :1901; wired move/scale `onLayerPointerDown`/`onScalePointerDown` :1072/:1083; layers panel rows (`row.kind === 'wired'` branches near :1540); amber handle template.
- Modify: `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` — `buildStackItems` :457 emits unified `l:` items for wired layers (register the card's slot-content provider); wired-specific selection (`selectedWiredSlot`, `startWiredMove` :328) keeps working by routing to the wired LAYER instead of widgets.
- Test: behavioral, via frame-lab (Task 7) + existing unit suites must stay green.

**Contract:**
- On modal open (and card mount), run `migrateFrameToUnifiedLayers` once; register the host's wired-content provider (`_registerWiredContent`) backed by the existing slot image/live-studio feeds.
- **Provider scoping (Task 2 review carry-over):** the provider registry is a single module global and slot numbers are host-scoped — two live hosts (card + modal on the same or different frames) must not fight over it. Scope the provider per node (e.g. provider takes `(nodeId, slot)` or hosts re-register before each paint pass, matching how the occlusion contract already arbitrates card vs modal). Note the provider sits on the HIT-TEST path too (`localLayerBox` resolves it), so a scoping bug mis-sizes selection handles, not just pixels. The provider must be a cheap, frame-stable accessor (documented on `_registerWiredContent`).
- **DOF parity (Task 2 review carry-over, blocker for the flip):** `paintLayer` gates DOF on `kind === 'image'` (depth keyed by filename); legacy `drawWiredImageLayer` supports a host-supplied depth image. Before retiring the legacy StackItem path, either extend the DOF gate to wired layers (depth keyed by slot content) or verify no shipped frame uses DOF on a wired slot and record the drop explicitly.
- **Ratified deviation:** a wired layer's bbox uses the LIVE content aspect when the provider yields content (falls back to `lastAspect`; `unlinked` always uses `lastAspect`) — the box hugs what actually paints. Selection/handles build on this.
- **Legacy `maskUrl` (per-slot mask):** decided at Task 3 — stays on the treatments registry, read by slot, until this task retires the legacy draw path; do not silently drop it.
- **Submit-path double-count (Task 3 review carry-over, lands WITH the migration call, same commit):** `injectCompositorOverlays` (`VueNodeCanvas.vue:5266-5288`), `ArtifactFrameNode.vue:401`, and `CompositorModal.vue:794` all build present-keys as `w:<slot+1>` for every connected slot PLUS `l:<id>` for local layers — on a migrated frame both exist for the same slot, double-adding it (z-order corruption at server render; `injectRun` would also bake a wired layer as a local). Schema-2 frames must emit only the `l:` entry for wired layers at all three sites.
- **naturalDims base mismatch:** the migration/write-through API is 0-based; `CompositorModal`'s own `naturalDims` ref is 1-based; the card keys by URL. Shift keys explicitly at each call site — a silent off-by-one produces wrong widths, not a crash.
- **Sentinel finalizer preserves scale:** a migrated layer with `w: -1` (dims unknown at migration) still has its `layer{N}_scale` widget intact; the first-paint finalizer must set `w = fit * scale` (via `wiredBoxFromWidgets` with the surviving widget transform), not `fit` alone. Pin with a test.
- `selectedSlot` ref deleted; wired layers select into `selectedIds` like any layer. The pixel hit test already re-renders per layer — wired layers now go through the same local-layer path (provider-drawn), so the special wired branch collapses.
- Amber handles and `onScalePointerDown` (uniform-from-center) deleted; wired layers use the standard handle set with corner-anchored aspect-locked resize (reuse the text/line resize behavior — aspect-locked corners — NOT the free rect resize).
- New edge lands → `createWiredLayer(slot)` appended + selected (find where slot connection changes are observed — the card watches wired inputs; mirror there). Edge disconnected → `layer.unlinked = true`, keep last bitmap via `lastAspect`; badge in the selection outline + layers panel row. Re-connect on the same slot → `unlinked = false`.
- Deleting a wired layer dispatches the edge-disconnect (find how the canvas removes edges — grep `removeEdges` / `sailor:` events in `VueNodeCanvas.vue`) AND removes the layer, as ONE undo step (editor history already snapshots layers; the edge restore must ride the same undo — if graph-level undo can't compose, delete becomes: disconnect edge + mark layer `unlinked` + remove layer, and undo restores the layer as unlinked with a toast telling the user to re-wire; pick whichever is achievable and note it in the commit).
- ⌘D / copy-paste on a wired layer: materialize via the existing "copy wired into frame" snapshot path (`CompositorModal.vue:3642` button); never clone the live link.

- [ ] **Step 1:** Migration + provider registration on open; `buildStackItems` in BOTH hosts emits wired layers as local items. Verify visually in frame-lab: existing fixture renders identically before/after (screenshot diff by eye).
- [ ] **Step 2:** Retire `selectedSlot` + amber handles; unified selection and resize. Run `npx vue-tsc --noEmit` and the full unit suite.
- [ ] **Step 3:** Edge lifecycle (land/disconnect/delete/undo) per contract.
- [ ] **Step 4:** Commit per step — `refactor(frame): modal runs on unified layers`, `feat(frame): unified selection + handles for wired layers`, `feat(frame): wired edge lifecycle (land/unlink/delete/undo)`.

### Task 6: Verbs sweep + layers panel

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (align bar gate :4075-4098; group/nudge/duplicate/copy in `useLocalLayerEditor.ts:342-410` — these operate on `localLayers` and now see wired layers automatically; the work is REMOVING the `row.kind === 'wired'` special cases in the panel and toolbar gates, wiring hide/lock/rename to layer fields, and confirming ⌘D routes to snapshot for wired)
- Test: extend `frontend/tests/unit/wired-layer.unit.spec.ts` — `alignSelected`/`nudgeLayers`/`duplicateLayers` over a mixed wired+text selection (pure functions from `~/lib/compositor/layerEdits`).

- [ ] **Step 1: Failing unit test** — mixed selection: align-left puts both layers' left edges equal; nudge moves both; duplicate of the mix produces a snapshot image layer for the wired member (assert the copy's `kind` is `image`, not `wired`).
- [ ] **Step 2: FAIL → implement → green.**
- [ ] **Step 3:** Sweep the panel: hide/lock/rename rows read/write layer fields for every kind; `toggleWiredFlag` and the `sailor_hiddenWired`/`sailor_lockedWired` reads (:1371-1495) become schema-2-dead (guard: only consulted when `sailor_frameSchema !== 2`).
- [ ] **Step 4: Commit** — `feat(frame): full verb parity for wired layers`

### Task 7: frame-lab fixture + live browser verification (Part A gate)

**Files:**
- Modify: `frontend/app/pages/dev/frame-lab.vue` — fixture node gains 2 wired slots (static images from the repo's test assets) + one text layer, pre-migration state (schema absent) to exercise migration live.

- [ ] **Step 1:** Extend the fixture; hard-reload the page (HMR-stale trap).
- [ ] **Step 2:** Browser pass, in the REAL modal (gate on `[data-ready]`, click by ref): migrate-on-open renders identically; shift-click a wired + the text layer → align bar appears, align works; ⌘G groups them; arrows nudge; corner-resize a wired layer is anchored + aspect-locked; hide/lock/rename from the panel; ⌘Z undoes each. Screenshot proof at each step.
- [ ] **Step 3:** Save/reload round-trip: reload the page, confirm schema flag + layers persisted (no re-migration, no duplicates).
- [ ] **Step 4:** In the real app (not the lab): wire a generated image into a Frame, re-run upstream, confirm the placed layer updates in place; server Render output matches the on-screen composite (write-through proof). Assert the real path ran — no graceful-fallback pass.
- [ ] **Step 5: Commit** — `test(frame): frame-lab wired fixture + live verification notes`

### Task 8: Part B — full-bleed stage

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` — stage box :3700-3714 (`left-[272px] right-[320px] overflow-hidden` → `inset-0`; matte constants :239-241 shrink to `STAGE_MATTE_X = 24`, `TOP = 24`, `BOTTOM = 24` with the fit math unchanged); panels :3539 and :4314 stay exactly as they are visually (they already float `absolute z-20`).

**Contract:** the stage spans the modal; `fitCanvasToStage` fits within the PANEL GAP still (so Fit never hides content under panels — compute avail from panel widths, not stage width); wheel/pinch/space-drag work over the whole stage; zoomed content slides under the floating panels instead of cropping at their edge. Stage background clicks that land on panels must not clear selection (panels already sit above and stop propagation — verify).

- [ ] **Step 1:** Make the change; verify in frame-lab: zoom in, drag content — it renders under the glass panels; wheel works in the former dead zones; marquee/handles still pixel-accurate at zoom (hit-testing reads `getBoundingClientRect`, which reflects the transform — confirm unchanged).
- [ ] **Step 2:** Commit — `feat(frame): full-bleed modal stage`

### Task 9: Part B — hideable chrome + legible zoom

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` — keydown handlers :707/:3416 gain ⌘\ (toggle both panels, `ref` persisted to `sessionStorage` key `sailor:compositor:panels`); zoom pill moves into the bottom toolbar as a menu: Fit (⌘0 → refit, i.e. `resetView()` + `fitCanvasToStage()`), 100%, 200%, Zoom to selection (⌘2 → `zoomAround` on the selection bbox center to fill ~60% of the gap); prompt bar collapses to a pill until focused (CSS + focus state, keep the textarea mounted so focus works).

- [ ] **Step 1:** Implement ⌘\ + panel state; frame-lab check both directions, plus reopen remembers.
- [ ] **Step 2:** Zoom menu + ⌘0/⌘2; verify zoom-to-selection centers a selected layer.
- [ ] **Step 3:** Prompt-bar pill; confirm it expands on focus and collapses on blur without losing draft text.
- [ ] **Step 4:** Shortcut hints: the zoom menu lists "Space — pan · Pinch/⌘ scroll — zoom · ⌘\ — hide panels".
- [ ] **Step 5:** Commit — `feat(frame): hideable panels + zoom menu + prompt pill`

### Task 10: Close-out

- [ ] Full unit suite + `npx vue-tsc --noEmit` against baseline; sanity-check vitest actually collected the full count (`uptime`/load trap).
- [ ] Update `docs/STATE.md` AND the live build dashboard artifact (standing rule: read the live one first, update both).
- [ ] Final commit + spec status flip to `landed` with any deviations noted.
