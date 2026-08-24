# 3D Studio Full Schema Derivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 3D Studio's four gaps vs Gradient — permissive panel fall-through, soft-range row + Transform migration, option display labels, and Geometry/Light/Decal joining the schema — so a control declared in `SCENE_CONTROLS` appears, writes, and reads correctly with zero hand-written UI.

**Architecture:** Extends the just-landed retrofit (spec `2026-08-24-scene3d-full-derivation-design.md`; pattern references: `.superpowers/sdd/task-3-report.md` and `task-5-report.md` from the retrofit, `frontend/app/lib/scene3d/panelPresentation.ts`, `frontend/tests/unit/scene3d-panel-parity.unit.spec.ts`). Same discipline: characterization-first for template swaps, vocabulary dump-diffs, template wins.

**Tech Stack:** Vue 3.5 + TS, vitest. Baselines: vue-tsc 420 errors; known pre-existing unit failures (embed size, gradientfx-motion-path distortAmount, gradientfx-mesh, scene3d-config MATERIAL_TYPES, other sessions' WIP families) — judge by covering specs.

## Global Constraints

- Template wins; characterization before any template deletion.
- Agent (`sceneAgentControls`/`sceneBindableControls`/`gradientAgentControls`), motion (`animatableTargets`, scene3d motion targets), and sweep vocabularies BYTE-IDENTICAL at every task's end (dump before/after across all 10 material types / all layouts). New Task 4 entries carry `agent: false, animatable: false` — zero grants this plan.
- Persisted keys frozen; snapshot diffs = stop and investigate.
- `StudioRow.vue` holds ANOTHER SESSION'S uncommitted readout-interaction WIP: never revert or stage it. Commit own hunks only — for shared files use `git diff -- <file> | git apply --cached` selection or `git add -p`-equivalent scripted hunk selection; verify with `git diff --cached` before each commit that no readout-WIP hunks are staged.
- Typecheck: no new errors naming touched files (baseline 420). Vitest: explicit file paths, never `-t`.
- Commit to main, multiple small commits per task fine.

---

### Task 1 (Part A): Permissive panel — unknown schema keys draw and write

**Files:**
- Modify: `frontend/app/lib/scene3d/panelPresentation.ts:300` (`panelCardOf`), the consumer loops at :447/:453
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue:1392` (`setControl`)
- Test: extend `frontend/tests/unit/scene3d-panel-parity.unit.spec.ts`

**Interfaces:** Produces: `panelCardOf` returns a card for EVERY key whose group is a migrated section (fall through: unmapped `Material`-group key → the material card's main body, sorted after mapped rows; unmapped key in Camera/Lighting/Background groups → that card; keys of NON-migrated groups (Transform until Task 2, Geometry/Light/Decal until Task 4) still return null with a comment saying which task lifts each). `setControl` gains a generic dotted-path fallback: any key not specially handled writes through the same proxy machinery the post block uses (find the existing generic write — the post path — and route the default case there), preserving the special-cased behaviors (relief seeding, degree conversion, multi-select fan-out) for their keys.

- [ ] **Step 1: Failing test** — inject a novel entry into a COPY of SCENE_CONTROLS (do not mutate the real array): `slider('object.material.zzProbe', 'Probe', 0, 1, 0.01, 'Material', 0, undefined, { agent: false, animatable: false })`, render via `scenePanelControls` for a standard-material primitive, assert it is drawn in the Material card; then write 0.7 via the surface's write path (exported seam or the same dotted proxy `setControl` uses) and assert the doc's `material.zzProbe === 0.7` reads back. Also assert a `Lighting`-group novel key draws in Lighting. Run, expect FAIL (drawn: no).
- [ ] **Step 2: Implement fall-throughs.** Keep the allow-list entries as ORDER hints (mapped keys keep their curated position; unmapped append). For `setControl`, the default branch writes via the generic dotted path + records undo the same way neighbors do — read the existing branches first and reuse their shared tail.
- [ ] **Step 3: Green + no drift.** Covering: `npx vitest run tests/unit/scene3d-panel-parity.unit.spec.ts tests/unit/scene3d-controls.unit.spec.ts tests/unit/scene3d-agent-controls.unit.spec.ts tests/unit/scene3d-motion-targets.unit.spec.ts`. Vocabulary dump-diff vs parent: identical. The 15-state render dump (parity spec) must be byte-identical — fall-through must not move any EXISTING row.
- [ ] **Step 4: Commit** `feat(scene3d): unknown schema keys now draw and write — panel allow-lists become fall-throughs`

### Task 2 (Part B): Soft-range row + Transform migration

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts` (slider variant gains `entry?: 'unclamped'`), `frontend/app/lib/studio/row.ts` (`parseTyped` at :51 — clamp becomes conditional), `frontend/app/lib/studio/scrub.ts` (arrow/drag stepping from out-of-range values), `frontend/app/components/vue-canvas/studio/StudioRow.vue` (thread the flag; track-position clamp for DISPLAY stays — `positionOf` at row.ts:27 keeps clamping to [0,1])
- Modify: `frontend/app/lib/scene3d/controls.ts` (Transform entries gain `entry: 'unclamped'`), `frontend/app/lib/scene3d/panelPresentation.ts` (reinstate Transform card + degree/Size conversions — recover from the retrofit's reverted commit: `git show c9023b9a2 -- frontend/app/lib/scene3d/panelPresentation.ts` has the DOC_CARDS.Transform + SceneReadCtx/read/write plumbing that e954626f9 removed; readapt, don't rewrite), `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (delete the bespoke Transform section again)
- Test: `frontend/tests/unit/studio-row-soft-range.unit.spec.ts` (new), scene3d-panel-parity Transform scenarios (replace the revert-guard test with migration assertions INCLUDING the x=35 cases)

**Interfaces:** Produces `entry: 'unclamped'` on slider ControlSpec: typed entry parses without min/max clamp (still snaps to step, still rejects non-numbers), ArrowUp/Down step ±step FROM THE CURRENT VALUE even out of range, drag-scrub still maps track position to [min,max], track-click still jumps within range, display shows true value with handle pinned at 0%/100% when out of range. DEFAULT MODE BYTE-IDENTICAL (characterize both).

- [ ] **Step 1: Failing tests** — soft-range spec: `parseTyped('35', -20, 20, 0.1, {entry:'unclamped'})` → 35 (and default mode → 20); arrow step at 35 → 35.1 not 20; step snapping still applies (35.04 → 35 with step 0.1... verify against parseTyped's real rounding). Parity spec: Transform scenario — nine rows present as PANEL rows with `entry:'unclamped'`, labels/bounds from the schema, plus a behavioral case: value 35 survives a re-parse round-trip.
- [ ] **Step 2: Implement row changes** (smallest diff in row.ts/scrub.ts; StudioRow.vue edits must not touch the readout-WIP hunks — read the file's current working-tree state first and edit around it).
- [ ] **Step 3: Reinstate the Transform migration** from c9023b9a2's version, updated: schema Transform entries get `entry:'unclamped'`; rotation rows keep degree display (schema stores radians ±π — the recovered OVERRIDE/conversion plumbing handles it); Size rows keep the ×baseSize conversion; the revert-guard test in scene3d-panel-parity ('does not migrate the Transform section') is REPLACED by its inverse (panel emits the nine keys; the bespoke aria-labelled inputs are GONE).
- [ ] **Step 4: Full covering set + dumps + every OTHER studio's sliders unchanged** — run the gradient parity spec too (`tests/unit/gradient-panel-parity.unit.spec.ts`) since row.ts is shared. vue-tsc flat.
- [ ] **Step 5: Commit** (two commits: `feat(studio): soft-range rows — display clamps, entry doesn't` then `feat(scene3d): Transform drawn from the schema, unclamped`). Hunk-hygiene check on StudioRow.vue before each.

### Task 3 (Part C): Option display labels

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts` (select variant gains `optionLabels?: string[]`, positionally paired with `options`), `frontend/app/components/vue-canvas/studio/StudioSelect.vue` (+ the row-select renderer if separate — grep RowSelect in StudioRow.vue), `frontend/app/lib/scene3d/controls.ts` (Relief kind entry: labels None/Effect/Image; any other select whose template text drifted — consult scene3d-panel-parity's OVERRIDE/notes), `frontend/app/lib/gradientfx/controls.ts` (focus.shape optionLabels: 'Off — blur everything' / 'Radial — sharp spot' / 'Linear — tilt-shift band'; layer.ramp.shape label back to 'Shape')
- Test: extend `tests/unit/studio-control-panel-chrome.unit.spec.ts` (a select with optionLabels renders label text, emits VALUE on change); parity specs updated where labels are now asserted

**Interfaces:** Produces: `optionLabels[i]` is the display text for `options[i]`; omitted → options shown raw (today's behavior). Stored/emitted values are ALWAYS from `options`. Agent vocabulary: `optionLabels` must be STRIPPED by every stripMeta (extend the destructures: gradientfx, scene3d ×2, shapefx, geoshape, vectortype ×2 — close the carried rider while here) and by `mapControlSpecToDesc`? NO — check what StudioControlDesc consumers want; labels are presentation, keep them OUT of the collection desc unless BindableRow renders selects (it does — check; if the bindings strip shows raw values today, leaving them raw is status quo, note it).

- [ ] Steps: failing render test → implement → apply to the three call sites → snapshot check (agent snapshots MUST NOT gain optionLabels — the strip test from task-4's pattern extends to it) → covering set (chrome spec + both parity specs + gradientfx-controls) → commit `feat(studio): select option display labels — stored values never change`.

### Task 4 (Part D): Geometry, Light, Decal join the schema

**Files:**
- Modify: `frontend/app/lib/scene3d/controls.ts` (new groups `Geometry`, `Light`, `Decal`; entries transcribed from Scene3DStudioSurface.vue template — Geometry per-primitive rows at ~3773-3969 incl. Modifiers/Cloner sliders, Light rows at ~4355-4392 (intensity/distance/decay/angle/penumbra/width/height + castShadow switch), Decal rows at ~4394-4428 (size/spin/wrap/opacity); every entry `agent:false, animatable:false`, `when` gating by object kind / primitive / light type mirroring the template's v-ifs; bespoke button grids (shape-type, modifier axis, cloner mode, light type if buttons) stay OUT of the schema — they become anchors)
- Modify: `frontend/app/lib/scene3d/panelPresentation.ts` (three new cards + anchors + any label/hint overrides), `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (delete the three template sections; keep sculpt/merge/To-mesh block, font pickers if inside Geometry — those are anchors or stay above/below)
- Test: `tests/unit/scene3d-panel-parity.unit.spec.ts` — new scenarios transcribed from the template BEFORE the swap: per primitive kind (box/sphere/text/svgPath at minimum — enumerate what the template branches on), light selected (point/spot/area variants), decal selected

**Interfaces:** Consumes Task 1's fall-through (new groups need `panelCardOf` group→card entries), Task 2's row (Geometry sliders are bounded — normal rows). Produces: zero hand-written plain-control rows outside object-motion/sculpt/merge/tree/add-menus.

- [ ] Steps, strictly in order: (1) characterization scenarios from the template (failing — schema lacks the entries); (2) schema entries until characterization's schema-half passes; (3) vocabulary dump-diff — MUST be identical (all new entries opted out; `stripMeta` handles the fields); (4) template swap, section by section (Geometry, then Light, then Decal — separate commits); (5) delete dead per-row proxies (grep survivors — many `light*`/`decal*` computeds may serve gizmos/renderer: KEEP those); (6) full covering set + vue-tsc + 15-state dump byte-identical for untouched states; (7) commits `feat(scene3d): <section> drawn from the schema`.

### Task 5: Live verification + docs

- [ ] Dev server via the Browser pane (`frontend` config, port 3002; do NOT touch :3000). `/dev/scene3d-lab`: novel-key smoke (add a probe entry locally? NO — instead verify a real Task 4 row end-to-end per section: geometry Detail slider reshapes, light intensity relights, decal opacity fades); Transform: type 35 into Position X via the PANEL row → accepted, sticks, arrow-up → 35.1 (the old bug's exact gesture); Relief dropdown shows None/Effect/Image and picking Effect stores 'shader' (check the lab's debug JSON dump); Gradient lab: focus.shape shows prose labels.
- [ ] Append verification record to this plan; update `docs/STATE.md` (Scene3D row: fully schema-drawn except listed bespoke editors) + ROADMAP Act 1 open-items + dashboard artifact (read live first); memory update (`derived-inspector-retrofit-landed` gains "CLOSED" notes on Transform/allow-list/labels). Commit docs.

---

## Verification Record (2026-08-24, Task 5)

**Live browser (dev server :3002, real gestures):**
- Transform (schema rows, soft-range): typed 35 into Position X → accepted, doc holds `position:[35,0.5,0]`; ArrowUp at 35 → 35.1 (the gesture that used to write 20); 3px drag → +0.8 relative move on the step grid (matches scrub math exactly), no snap-to-bound; Size X double-click reset → doc scale exactly `1` (world display 0.94 = base extent).
- Geometry: icosahedron Detail renders [0,3] (per-kind narrowing); drag to 2, double-click → 0 (the kind's own default — pre-fix this wrote the union default 48); cylinder "Open ended" switch → doc `params.openEnded: 1` (number, engine contract).
- Light: point light shows Intensity 80/600 (spawn value as reset default), Distance/Decay/Cast shadow; Angle/Penumbra/Width/Height correctly absent for point.
- Labels: Gradient focus.shape options render "Off — blur everything / Radial — sharp spot / Linear — tilt-shift band" over raw stored values; Scene3D Relief None/Effect/Image live-proven by Task 3's reviewer (persisted config dumps raw `shader`).
- Playwright: scene3d-grouping + scene3d-svg-import — 6/6 passed serially (one parallel-run flake, passed twice after).

**Suites:** covering sets green at every task; vue-tsc flat at 420 throughout. Vocabulary: ZERO GROWTH at every commit — no key added to or removed from the agent, motion or sweep lists, and Task 4's ~60 new entries are all `agent: false, animatable: false`. Not literally byte-identical, and the one field diff is planned: Task 3 restored `layer.ramp.shape`'s label from 'Radial shape' to 'Shape' (template truth), which the Gradient agent dump carries. Task 4's own dumps ARE byte-identical against their parents — read-side rounding, per-kind narrowing and the Size/Transform patches all live in `panelPresentation`, downstream of `SCENE_CONTROLS`, which is what every vocabulary reads.

**Invariant recorded (third occurrence this plan):** in presentation patches, `min/max/step/label` are description but `default` is BEHAVIOUR — any patch that moves a row's units or range must move its default too.
