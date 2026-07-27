# Vector Type — motion preset gallery

**Date:** 2026-07-27
**Status:** Plan, ready to execute
**Follows:** `2026-07-27-vector-type-studio.md` (10/10 landed, `003ac333a`..`730eeb1fa`)

## The ask

Jitter-style entrance presets in Vector Type's Motion tab: a gallery of live-animated tiles grouped
by category — Appear, Fade, Slide ↑↓←→, Mask ↑↓, Grow, Shrink, Blur, Blur & Slide.

## What already exists — this is mostly reuse

The Compositor motion redesign shipped the gallery already, and **neither gallery component imports
anything Compositor-specific**:

| piece | file | note |
|---|---|---|
| gallery popover | `components/vue-canvas/compositor/MotionPresetPicker.vue` (91) | props `{slotKind, currentId, anchorRect, layerKind?}`, emits `pick/clear/close` |
| live tile | `components/vue-canvas/compositor/PresetThumb.vue` (84) | 72×54 canvas running the **real** engine math |
| shared clock | `lib/motion/thumbClock.ts` (35) | one rAF for all tiles + IntersectionObserver pausing |
| engine | `lib/motion/evaluate.ts` (336, pure, DOM-free) | `IN_EVAL`/`OUT_EVAL`/`LOOP_EVAL`, ~45 presets |
| metadata | `data/kinetic-presets.ts` | labels, `KineticGroup`, param schemas |

`UnitState` already carries `clip`, so **Mask ↑↓ is free**. Blur is not: it exists nowhere in the
canvas-native engine, only as dead GSAP CSS-filter builders.

## Decision taken (2026-07-27)

**Shared presets + axis presets + blur.** The gallery must include a Vector-Type-only section that
animates *variable font axes*, because otherwise every tile in it is something Jitter and After
Effects already do, and the one thing nothing else in the market does — animating `XOPQ`, `GRAD`,
`YTAS` as design parameters — has no tile and is never discovered.

Extend `UnitState` with two optional fields rather than forking the engine:

```ts
export interface UnitState {
  …
  axes?: Record<string, number>   // variable-font deltas — Compositor ignores
  blur?: number                   // px at unit scale — new for both consumers
}
```

Same superset-with-opt-in shape `ControlSpec` already uses. The Compositor ignores `axes`.

## The four traps — pin these before writing code

1. **Coordinate spaces differ.** `UnitState.dx/dy` are **unit-box heights**; `VtGlyphTransform.dx/dy`
   are **output pixels**. The adapter must multiply by em size. Getting this wrong looks *almost*
   right at one font size and wrong at every other — the worst kind of bug.
2. **`vtIsAnimated()` gates the preview loop on `tracks.length > 0`** (`lib/vectortype/canvas.ts`).
   A config with an entrance preset and no tracks renders **frozen**. Must be widened or every
   preset-only setup silently looks broken.
3. **`PresetThumb` draws a synthetic "Aa" card, not text.** An axis tile showing a card get heavier
   communicates nothing. Axis tiles need real outlines — a VT-specific thumb.
4. **`ctx.filter` in the bake path is unverified.** Every existing blur use is Compositor-side. If
   `ctx.filter` is a no-op in the OffscreenCanvas bake, blur previews and exports blank. **Gate
   Task 5 on measuring this first** — do not build on the assumption.

## Tasks

---

### Task 1: Move the gallery to a neutral home

Behaviour-preserving move, first because it has the widest blast radius and is the least interesting.

**Files:** move `compositor/MotionPresetPicker.vue` + `compositor/PresetThumb.vue` →
`components/vue-canvas/motion/`. Modify Compositor importers.

- [ ] **Step 1:** `grep -rn "MotionPresetPicker\|PresetThumb" frontend/app frontend/shared frontend/tests` — list every importer first.
- [ ] **Step 2:** Move both, repoint imports. **No behaviour change, no refactoring, no renames.**
- [ ] **Step 3:** Verify the Compositor's own picker still opens and its tiles still animate — in a browser, not by inspection.
- [ ] **Step 4:** Commit — `refactor(motion): move the preset gallery to a neutral home`

---

### Task 2: Extend `UnitState` with `axes` and `blur`

**Files:** `lib/motion/types.ts`, `lib/motion/evaluate.ts`, `tests/unit/`.

- [ ] **Step 1:** Add both optional fields. Existing presets leave them undefined.
- [ ] **Step 2:** Confirm the Compositor's consumers (`lib/motion/paint.ts`, `animatedText.ts`) ignore
      an unknown field gracefully — read them; do not assume. `blur` **should** eventually apply there
      too, but that is out of scope: verify it no-ops rather than mis-renders.
- [ ] **Step 3:** Test that a preset returning `axes`/`blur` round-trips through `evaluateAnimation`.
- [ ] **Step 4:** Commit — `feat(motion): axes and blur on UnitState`

---

### Task 3: Blur presets in the engine

**Files:** `lib/motion/evaluate.ts`, `data/kinetic-presets.ts`.

- [ ] **Step 1:** Add `blur-in`, `blur-out`, `blur-slide-up` to `IN_EVAL`/`OUT_EVAL`. The ids and
      metadata already exist in `kinetic-presets.ts` — reuse them; do not invent parallel ids.
- [ ] **Step 2:** Blur is in **unit-box px** like `dx`/`dy`, so it scales with type size.
- [ ] **Step 3:** Tests: blur decays to 0 at `e === 1` for in-presets; `blur-slide-up` moves *and* blurs.
- [ ] **Step 4:** Commit — `feat(motion): blur presets`

---

### Task 4: The `UnitState` → `VtGlyphTransform` adapter

**Files:** `lib/vectortype/presetMotion.ts`, tests. **This is the load-bearing task.**

- [ ] **Step 1:** `motion.in/out/loop?: LayerAnimSpec` on `VectorTypeConfig`, strict `mergeConfig`.
      Adopt the existing `LayerAnimSpec` shape verbatim — the picker emits against it.
- [ ] **Step 2:** `presetTransform(cfg, t, i, n) → VtGlyphTransform & { axes, blur, clip }`, calling
      `evaluateAnimation` and **multiplying `dx`/`dy`/`blur` by em size** (trap 1). Test at two
      different `size` values — a single-size test cannot catch this.
- [ ] **Step 3:** Compose with the existing model: preset transform ∘ axis tracks, both on
      `glyphTime()`. Presets and tracks must **add**, not overwrite (the sweep×motion collision in the
      last plan was exactly this failure).
- [ ] **Step 4:** Widen `vtIsAnimated()` to include presets (trap 2). Test that a preset-only config
      reports animated.
- [ ] **Step 5:** Commit — `feat(vectortype): drive glyphs from motion presets`

---

### Task 5: Blur and clip in the canvas renderer — **gated**

**Files:** `lib/vectortype/canvas.ts`.

- [ ] **Step 0 — THE GATE (trap 4).** Before anything else, measure whether `ctx.filter = 'blur(4px)'`
      actually blurs in the **bake** path (OffscreenCanvas / the headless render), not just on screen.
      Diff pixel output with and without. **If it is a no-op, stop and report** — the rest of the blur
      work is worthless until that is solved, and finding out at Task 8 is far more expensive.
- [ ] **Step 1:** Per-glyph blur via `ctx.filter`, reset in the same `save`/`restore`.
- [ ] **Step 2:** Per-glyph clip. Copy the working trick at `lib/motion/animatedText.ts:100-113` —
      clip the **cell box before** the unit transform, so the reveal edge stays fixed while the glyph
      slides under it. Clipping after the transform makes the mask travel with the letter, which looks
      plausible in a thumbnail and is wrong.
- [ ] **Step 3:** Verify Mask ↑↓ reveals rather than translating a clipped glyph — describe what you saw.
- [ ] **Step 4:** Commit — `feat(vectortype): per-glyph blur and clip`

---

### Task 6: Blur and clip in the SVG spine — **be conservative here**

**Files:** `lib/vector/svg.ts`, `lib/vectortype/render.ts`.

`lib/vector/svg.ts` is the deliberately studio-agnostic vector spine and Shape Studio is its intended
second consumer. Keep additions generic; type-specific logic belongs in `render.ts`.

- [ ] **Step 1:** `<defs>` emission — the writer has none today.
- [ ] **Step 2:** `<filter><feGaussianBlur stdDeviation=…>` per **distinct** blur value, deduped and
      referenced by id. Not one filter per glyph.
- [ ] **Step 3:** `<clipPath>` for mask reveals, likewise deduped.
- [ ] **Step 4:** Both are real SVG that vector editors treat as live effects, so the "genuine export"
      claim holds — but **verify it, don't assert it**: rasterise the export and diff against the
      canvas, the way Task 8 of the previous plan proved the y-flip (a deliberately broken control,
      to show the check can detect the bug it rules out).
- [ ] **Step 5:** Commit — `feat(vector): filter and clip-path emission in the SVG spine`

---

### Task 7: Vector-Type-only axis presets

**Files:** `lib/vectortype/axisPresets.ts`, `data/` metadata, tests.

- [ ] **Step 1:** A `VT_EVAL` table returning `axes`: **Weight In**, **Weight Wave**, **Width Breathe**,
      **Grade Pulse**, **Optical Drift**. Each declares the axis tag it needs.
- [ ] **Step 2:** Availability is per font — Inter has 2 axes, Roboto Flex 13. A tile whose axis the
      loaded font lacks must **gray out with the reason**, not silently no-op. Same
      "declare the frame, derive the contents" problem shader-as-fill solved; follow that.
- [ ] **Step 3:** Tests: each preset names a real axis tag; availability filtering is correct for a
      2-axis and a 13-axis font.
- [ ] **Step 4:** Commit — `feat(vectortype): variable-axis motion presets`

---

### Task 8: A real-outline thumbnail for axis tiles (trap 3)

**Files:** `components/vue-canvas/motion/VectorTypeThumb.vue`.

- [ ] **Step 1:** A tile that renders **actual glyph outlines** through the VT renderer, so a weight
      preset visibly thickens letters. Register with `thumbClock` like `PresetThumb` — do **not** add
      a second rAF.
- [ ] **Step 2:** Steal `TextEffectGalleryModal`'s idea of previewing **the user's own typed word**
      rather than "Aa", falling back to "Type" when empty.
- [ ] **Step 3:** Fonts load async and tiles are many. Show a resting state until loaded; never block
      the gallery opening on a font fetch.
- [ ] **Step 4:** Commit — `feat(vectortype): live outline thumbnails for axis presets`

---

### Task 9: Mount the gallery in the Motion tab

**Files:** `VectorTypeSurface.vue`.

- [ ] **Step 1:** In/Out/Loop slots using the moved picker, axis section **first** so the studio's
      differentiator is what the user sees before the conventional presets.
- [ ] **Step 2:** Presets and hand-authored axis tracks must coexist in the UI — the tracks editor
      stays. Make it legible that both are active.
- [ ] **Step 3:** Overlay hygiene: `pointer-events-none` root, `pointer-events-auto` children, or the
      popover eats canvas wire drags.
- [ ] **Step 4:** Commit — `feat(vectortype): motion preset gallery in the Motion tab`

---

### Task 10: Live verification

Nothing before this is runtime-proven. The previous plan found **four** bugs at exactly this point
that ~200 green unit tests had missed, all of them composition or host-environment failures.

- [ ] Each of the user's screenshot presets applied and observed: Appear, Fade, Slide ↑↓←→, Mask ↑↓,
      Grow, Shrink, Blur, Blur & Slide.
- [ ] An axis preset on Roboto Flex, and the same tile correctly grayed out on Inter.
- [ ] A preset **composed with** an axis track — both visibly active.
- [ ] PNG bake and SVG export both carry blur and mask.
- [ ] Stagger still travels across the word with a preset applied.
- [ ] The Compositor's own gallery still works — Task 1 moved its files.

**"I looked and it rendered" is not evidence.** Diff pixels across time, or assert the path ran.

---

## Out of scope

Blur on Compositor layers (the field exists after Task 2; wiring `paint.ts` is separate) · per-glyph
`copies` · colour presets (tracks carry numbers, not colours) · scramble/glitch text rewriting ·
morphing between strings.

## The number to watch

Every tile in the gallery that a competitor also has is table stakes. **The axis section is the
reason this studio exists** — if it ships gray, empty, or buried below Slide, the work has added a
conventional kinetic-text tool to a product that already retired two of them.
