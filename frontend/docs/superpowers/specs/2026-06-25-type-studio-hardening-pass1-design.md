# Type Studio — Hardening Pass 1

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Scope:** Stability, performance, consistency, and UX-polish hardening of the existing Type Studio (Space Type) feature. **No new features.**

## Background

Type Studio is mature: 23 effect modules (22 registered + base), ~9k LOC under `app/lib/spacetype/`, ~28 unit-spec files, near-zero TODO debt. Three parallel read-only audits (consistency / performance / production-UX) found that the *engine* is well-centralized (post-FX, hydration, motion) but a **thin layer of production fragility** bites under real use: many nodes on a canvas, bad param combinations, and active edit sessions. Several findings were independently cross-confirmed by multiple audits (broken collapsible sections, missing `Stroke` open-state key, the hardcoded live-param block, dead Escape key), raising confidence.

This pass hardens that layer. A separate **Pass 2 (Enrichment)** and a separate **Vessell color/pattern preset library** project are explicitly out of scope (see Deferred).

## Goals

- Type Studio survives bad params, missing WebGL, and many-node canvases without freezing, leaking, or going black.
- Authoring (dragging sliders in the modal) is smooth.
- The 23 effects feel like one coherent studio (distinct names, consistent section behavior).
- The editor surface is production-safe (closeable, recoverable, accessible basics).

## Non-goals (deferred)

- Presets + seeded randomize (Pass 2).
- Preset/effect **gallery with thumbnails** (Pass 2 — biggest onboarding gap, but a feature).
- Shared/pooled renderer refactor (only if context-gating proves insufficient).
- `fills` vs `textColor` color-model unification (behavioral; Pass 2).
- Font-picker consolidation onto `widgets/FontPicker.vue` (Pass 2).
- **Vessell** brand color/pattern preset library across all studios — separate project, its own spec.

---

## Work items

Grouped by tranche. Each item: problem → files → fix → verification.

### A. Stability foundation (P0)

**A1 — Guard the render loop so a thrown effect can't freeze the studio.**
Today there is no try/catch around `engine.build()`, `effect.update()`, or `renderer.render()`. One bad param combo (NaN into geometry, a font outline failure) escapes the rAF `tick()`, the loop is never re-scheduled, and both the modal preview and the node card silently die with no recovery.
- Files: `app/lib/spacetype/engine.ts` (`build` ~174, `renderFrame`/render ~199-205); the tick loops in `app/components/vue-canvas/SpaceTypeSurface.vue` (~327-346) and `app/components/vue-canvas/SpaceTypeNode.vue` (~64-76).
- Fix: wrap build + per-frame render in try/catch; on failure, keep rAF alive (schedule the next frame), set an error flag, and render a small inline "Effect failed to render" overlay in the modal/card. Log once (not per-frame).
- Verify: unit test a `buildScene` that throws → engine stays alive, error flag set; manual harness screenshot of the overlay.

**A2 — WebGL capability guard + graceful placeholder.**
`new THREE.WebGLRenderer()` is constructed unconditionally in `onMounted` (node card *and* modal). On a machine without WebGL / with a lost context this throws and breaks the node mount.
- Files: `engine.ts` (~44, constructor), `SpaceTypeNode.vue` (~87), `SpaceTypeSurface.vue` (~423).
- Fix: feature-detect WebGL once (shared helper). If unavailable: node card renders a static "3D preview unavailable" placeholder; modal disables authoring with a message. Never throw in `onMounted`.
- Verify: unit test the helper; manual check by forcing the detector false.

**A3 — Release the WebGL context on dispose.**
`SpaceTypeEngine.dispose()` calls `renderer.dispose()` but never `renderer.forceContextLoss()`. Every other 3D surface in the codebase does (`Artifact3DNode.vue:152`, `PoseEditorModal.vue:401`). Without it, contexts linger until GC.
- Files: `engine.ts` (~211-215).
- Fix: `this.renderer.forceContextLoss()` then `this.renderer.dispose()`; null the canvas ref.
- Verify: covered by A4's many-node manual test (no "too many contexts" after add/remove churn).

**A4 — Gate the per-node context + rAF on visibility and editing state.**
Each mounted SpaceTypeNode holds its own live WebGL2 context and a forever-running rAF, with no IntersectionObserver, no `visibilitychange`, and it keeps rendering *behind the open modal* (a second redundant context+loop). ~10-14 nodes hits the browser's ~16-context cap → black previews. SpaceType is the only studio that does this (others preview to a 2D canvas).
- Files: `SpaceTypeNode.vue` (`startPreview`/`stopPreview` ~64-95); a shared "editing node id" signal already exists via `spaceTypeOpenForId` in `VueNodeCanvas.vue` (~4765).
- Fix (gating approach, not the shared-renderer refactor):
  1. IntersectionObserver on the node card → `stopPreview()` when offscreen, resume when visible.
  2. `visibilitychange` → pause all node loops when the tab is hidden.
  3. When `spaceTypeOpenForId === props.id`, the node calls `stopPreview()`; resume on close.
- Verify: manual — add ~15 nodes, scroll/switch tabs/open-close the modal, confirm no black previews and no "too many contexts" console errors.

### B. Performance (P1)

**B1 — Debounce the modal's structural rebuild.**
The structural-params watch in the modal calls `rebuild()` → `engine.build()` (dispose + rebuild geometry/materials/textures + `makeTextTexture` raster + `await ensureEffectFonts()`) synchronously on every change. The *node* debounces this at ~80 ms; the *modal* — where the user actually drags structural sliders — does not.
- Files: `SpaceTypeSurface.vue` (~440-477); reuse the debounce pattern from `SpaceTypeNode.vue` (~131-141).
- Fix: debounce the rebuild side at ~80 ms. Live/per-frame params are already excluded from the structural signature, so only true structural edits pay it.
- Verify: manual — drag a structural slider (e.g. tunnel rings), confirm smoothness; ensure final value still rebuilds.

**B2 — `preserveDrawingBuffer` only on the bake path.**
The renderer is constructed with `preserveDrawingBuffer:true` for its whole lifetime so `canvas.toBlob()` works during bake, but this taxes every preview frame of every node.
- Files: `engine.ts` (~44, ~204-208 `frameToBlob`).
- Fix: preview renderer uses `preserveDrawingBuffer:false`; bake renders to an explicit RenderTarget and reads back via `readRenderTargetPixels` (or a short-lived dedicated bake renderer).
- Verify: bake output still correct (existing `spacetype-bake` test + a manual bake); preview unaffected.

**B3 — Per-frame waste cleanups (batch).**
- `elastic` redraws its CanvasTexture (`drawMatte` + `tex.needsUpdate`) every frame even when `cycles === 0` (frozen). `elastic.ts` (~218-224) — skip redraw when time/uniforms unchanged; short-circuit when frozen after first draw.
- Hoist per-frame `new THREE.Color()` allocations to module-level scratch and `.set()`: `echo.ts` (~199, 206-207), `cylinder.ts` update (follow the existing `_qFace`/`_AXIS_*` pattern).
- Complete `PostChain.dispose()` to also dispose `renderPass` and `gradePass` (ShaderMaterial). `post.ts` (~140-143).
- Verify: existing effect unit tests stay green; visual parity in harness.

### C. Consistency (P0-P2)

**C1 — Distinct effect display names.**
Every effect sets `label:'Text'` (string sets `'Path'`), so the effect picker shows "Text" 21×. `label` is the human display name on the `SpaceTypeEffect` interface but is being misused as the text-input caption.
- Files: every `app/lib/spacetype/effects/*.ts` (`label:` field); picker render at `SpaceTypeSurface.vue` (~643); text-field caption should come from the `text` control's own `label`.
- Fix: give each effect a distinct `label` ("Ribbon", "Cylinder", "Tunnel", …). Source the text-field caption from the `text` control instead of `effect.label`.
- Verify: unit test asserting all registered effect `label`s are unique and non-"Text".

**C2 — Move the live/structural param split into the seam.**
`SpaceTypeSurface.vue` (~440-475) hardcodes, per effect, which keys are read live in `update()`. Every new effect must remember to register here or each slider drag triggers a full rebuild. Worse, globally-excluded keys (`strokeColor`/`strokeWidth`/`perspective`) are skipped for *all* effects — the exact hazard that forced `boost` to invent `extrudePerspective` (`boost.ts:129`).
- Files: `app/lib/spacetype/effect.ts` (the `SpaceTypeEffect` interface ~48-56); `SpaceTypeSurface.vue` (delete the hardcoded block ~440-475); each effect declares its own live keys.
- Fix: add optional `liveKeys: string[]` (or `isLiveKey(key): boolean`) to the seam. The surface reads it to build the structural-rebuild signature. Effects own their live/structural split; the global exclusion list goes away.
- Verify: unit test — for each effect, dragging a declared live key does not change the structural signature; a structural key does.

**C3 — Make `group` required; fix section open-state source.**
`group` is optional, with a dead `?? 'Other'` fallback (`SpaceTypeSurface.vue:185`) — `'Other'` isn't a section, so a group-less control is silently hidden. `openSections` (~182) is hand-listed and out of sync: phantom `Post` key, missing `Stroke`.
- Files: `effect.ts` (ControlSpec type — `group` required); `app/lib/spacetype/sections.ts`; `SpaceTypeSurface.vue` (~182, ~185); `tests/unit/spacetype-sections.unit.spec.ts`.
- Fix: make `group` required on `ControlSpec`; remove the `?? 'Other'` fallback; derive `openSections` keys from `SPACE_TYPE_SECTIONS`; extend the sections test to fail if any control omits `group`.
- Verify: extended unit test green; manual check that Stroke section default-collapse is correct per effect.

### D. UX polish (P0-P1)

**D1 — Fix collapsible sections.**
`StudioSection.vue` does `const isOpen = ref(props.open)` with no `watch` on `props.open`, so per-effect default open/closed state is dead after the first user toggle (and `v-for` reuses instances across effect switches).
- Files: `app/components/vue-canvas/studio/StudioSection.vue` (~8).
- Fix: `watch(() => props.open, v => isOpen.value = v)`. Pairs with C3's `openSections` derivation (adds the missing `Stroke` key).
- Verify: manual — switch effects, confirm sections honor each effect's intended defaults.

**D2 — Escape-to-close + dialog semantics.**
The modal header shows an "esc" hint chip but nothing handles Escape; no focus trap, no `role="dialog"`/`aria-modal`, focus can tab to the canvas behind.
- Files: `app/components/vue-canvas/studio/StudioModalShell.vue` (~36).
- Fix: keydown Escape → `emit('close')`; add `role="dialog"` + `aria-modal="true"`; basic focus trap + focus-return on close. (Shared shell — benefits all studios using it; verify no regression for the others.)
- Verify: manual — Escape closes; focus returns; tab stays within modal.

**D3 — Per-effect "Reset to defaults" + surface the existing reset hint.**
Today the only recovery from a bad param state is an undiscoverable double-click-a-slider (`plugins/studio-reset.client.ts`). No per-effect reset.
- Files: `SpaceTypeSurface.vue` (controls header/section).
- Fix: add a per-effect "Reset" affordance that restores the current effect's defaults; add a small visible hint for double-click-to-reset on individual sliders.
- Verify: manual — Reset restores defaults; hydration/persistence unaffected.

---

## Architecture notes

- **No new modules.** All changes are edits to existing engine/surface/effect files, plus one shared WebGL-detect helper (small, under `app/lib/spacetype/`).
- **The seam change (C2)** is the only interface change: an optional field on `SpaceTypeEffect`. Backward compatible — effects without it fall back to "all keys structural" (today's safe-but-slow default), so partial rollout is fine.
- **Shared-shell edits (D2)** touch `StudioModalShell.vue` used by all studios — verify Gradient/Shader/Texture modals still behave.
- **Verification posture:** per project convention, visual/WebGL changes (A1, A2, B2, B3) are verified with the standalone-harness + screenshot loop, not unit tests alone. Logic changes (C1, C2, C3) get unit tests.

## Suggested sequencing

1. A1–A4 (stability) — highest value, mostly independent, de-risks everything else.
2. B1–B3 (performance) — B1 is the biggest authoring-feel win.
3. C1, C3, D1 (cheap consistency/UX, partly overlapping via `openSections`).
4. C2 (seam refactor) — touches all effects; do after the suite is otherwise green.
5. D2, D3 (modal UX) — D2 is shared-shell, verify other studios.

## Next project (not this spec)

**Vessell color/pattern preset library across the board** — a cross-studio brand design-system: a default Vessell palette + pattern set surfaced as presets in Type / Gradient / Shader / Texture studios and Compositor fills. Relates to the existing brand-library work. Gets its own brainstorm + spec after Pass 1 lands.
