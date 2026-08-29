# Frame Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Frame card's three hottest-gesture gaps and land six editor-polish features (per-corner radius, stroke align, dashes, scrub fields, layer thumbnails, OS-clipboard layers).

**Architecture:** Paint features go into the shared pipeline (`useCompositorLayers.ts`) so card/modal/bakes agree by construction; UI lands in the modal inspector + card; one shared scrub composable; clipboard rides `navigator.clipboard` beside the existing in-session clipboard.

**Spec:** docs/superpowers/specs/2026-08-28-frame-polish-hotpaths-design.md (binding, incl. Design constraints and the v1 non-goals).

## Global Constraints

- Absent new fields = today's behavior byte-for-byte; no migrations; SVG export untouched; nothing animatable v1.
- vue-tsc baseline (417 ± deletions; only errors naming your symbols are yours). Existing suites stay green. TDD for pure logic.
- Stage only files you touch; main-direct commits; per-task commit messages as given.
- Live verification per task where the change is visible (Playwright patterns in the scratchpad; frame-lab boots with the modal open; card visible behind it; hard-reload after SFC edits).

### Task 1: Card hot paths (spec A1–A3)

**Files:** `frontend/app/composables/useLocalLayerEditor.ts` (focus contract), `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` (dblclick ordering, textarea autofocus), `frontend/app/components/vue-canvas/CompositorModal.vue` (autofocus from addText), `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (F key ~:1407 handler).
- [ ] Autofocus+select-all on the edit textarea whenever `editingId` becomes set (both hosts; a small shared helper or watch per host — match existing idioms). Card: `onArtboardDblClick` enters edit mode BEFORE `onCanvasDblClick` begins text editing.
- [ ] F places a Frame at viewport center, selected, typing-guarded, in the canvas key handler beside S/C/A.
- [ ] Unit where a seam exists; live checks: Add text → type immediately (both hosts); idle-card dblclick edits without vanishing; F creates a Frame. Commit `fix(frame): type-immediately text editing + idle-dblclick + F-to-create`.

### Task 2: Per-corner radius (spec B4)

**Files:** `frontend/app/composables/useCompositorLayers.ts` (RectLayer.radius type + rounded path builder), `frontend/app/components/vue-canvas/CompositorModal.vue` (radius row expand), tests `frontend/tests/unit/` (extend a compositor spec).
- [ ] `radius: number | [number, number, number, number]`; pure `cornerRadii(radius): [tl,tr,br,bl]` helper, tested (number → uniform; array passes through; clamped to half min dimension).
- [ ] Paint builds the per-corner path in the ONE shared draw for rects (bake parity free). Inspector: linked field + expand-to-four (Figma pattern), plain labels.
- [ ] Live: four different radii render. Commit `feat(frame): per-corner radius on rectangles`.

### Task 3: Stroke alignment + dashed strokes (spec B5–B6)

**Files:** `frontend/app/composables/useCompositorLayers.ts` (stroke pass for closed shapes + dash application), `CompositorModal.vue` (align select on closed-shape rows; Solid/Dashed select + dash/gap fields), tests.
- [ ] `strokeAlign` center/inside/outside on rect/ellipse/polygon/star/path via clip/knockout at 2×width; `strokeDash {dash,gap}` via `setLineDash`, width-normalized, every stroked kind.
- [ ] Pixel-probe tests: inside-align leaves the outside untouched; outside-align leaves the interior untouched; dashes produce gaps (recording-ctx or real-ctx pattern per what the suite supports).
- [ ] Live screenshots of all three alignments + a dashed line. Commit `feat(frame): stroke alignment + dashed strokes`.

### Task 4: Drag-to-scrub numeric fields (spec B7)

**Files:** new `frontend/app/composables/useScrubbableNumber.ts` (or directive — pick the idiom that fits the modal's bespoke inputs), applied across `CompositorModal.vue` inspector number inputs; unit test for the scrub math (px→delta with Shift step, min/max clamp).
- [ ] StudioRow conventions: drag scrubs, Shift bigger steps, plain click still focuses for typing; cursor feedback (`ew-resize`).
- [ ] Live: real pointer drag changes X; typing still works. Commit `feat(frame): scrubbable numeric fields in the inspector`.

### Task 5: Layer thumbnails (spec B8)

**Files:** `CompositorModal.vue` layers panel rows + a small render helper (offscreen `drawLocalLayer` / wired slot content), debounced on layer mutation, work-capped.
- [ ] ~24px thumbs, groups show first-child/stack, wired layers use live content; no per-frame rendering (debounce + only visible rows).
- [ ] Live: thumbs render, and editing a layer updates its thumb. Commit `feat(frame): layer thumbnails in the panel`.

### Task 6: OS-clipboard layers (spec B9)

**Files:** `frontend/app/lib/compositor/layerClipboard.ts` (serialize/parse for the OS payload — pure, tested), `CompositorModal.vue` copy/paste handlers.
- [ ] ⌘C: existing behavior + `navigator.clipboard.write` (Sailor JSON text + composited PNG); wired members materialize per the snapshot rule. ⌘V: prefer Sailor JSON on the clipboard (ids re-minted, offset paste, uploads re-resolved by filename), else existing image paste. Graceful when clipboard permission is denied (fall back silently to in-session).
- [ ] Unit: JSON round-trip, id re-mint, wired refusal in the pure layer. Live: copy in one frame, paste into ANOTHER frame.
- [ ] Commit `feat(frame): layers ride the system clipboard`.

### Task 7: Close-out

- [ ] Full unit sweep + vue-tsc; live umbrella pass; ledger; STATE.md + dashboard + spec flip.
