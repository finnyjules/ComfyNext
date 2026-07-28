# Vector Type — the appearance stack

**Date:** 2026-07-28
**Status:** Plan, ready to execute
**Follows:** Vector Type Studio (`003ac333a`..`7423d4fad`), motion presets (`173249a1c`..`7a5f251cc`), fills (`0cdc83e5a`..`29a308a94`)

## The ask

Multiple fills and multiple strokes per text object, Illustrator-Appearance-panel style, plus
**extrude**. Stroke should also stop being invisible.

## Decisions taken (2026-07-28)

1. **Extrude = block shadow + solid sweep.** Repeated offset copies of the glyph path behind the
   face, optionally unioned into one solid body. Both stay **real editable vector**. No new geometry
   library: paper.js is already a dependency and already lazily loaded, and its boolean `unite` is
   already in use in `useVectorSvg.ts`. **True outline offset (stroke-as-geometry) is explicitly out**
   — paper 0.12 has no offset API and that is its own project.
2. **Stable ids, and extract the shared remapper.** Each appearance layer carries a stable id, so
   reorder is a no-op for motion tracks and Collection bindings. The duplicated remap logic comes out
   of Gradient and Shader into `lib/studio`.

## The state of play (verified 2026-07-28 — do not re-derive)

**Stroke already exists and is hidden.** `stroke` is `when: hasStroke`-gated and `strokeWidth`
defaults to `0`, so the colour control never appears until you raise the width. The user reasonably
concluded there was no stroke. The stack fixes this structurally — a stroke layer is visible because
it is *in the list*.

**The seams are unusually cheap:**
- `StudioLayerStack.vue` (66 lines) is already generic and intent-emitting — `select / reorder / add /
  remove / duplicate / toggle`. Gradient and Shader both mount it. Vector Type does not yet.
- `outlinesToShapes` already returns an **array**, so emitting K shapes per glyph is a `flatMap`.
  **`lib/vector/svg.ts` needs no change at all** — its `<defs>` dedupe already collapses shared paint
  servers across shapes.
- The canvas per-glyph body (`canvas.ts` ~624-718) already sets up geometry, transform, clip, blur and
  alpha *outside* the paint step. A layer loop wraps only the fill/stroke pair.

**What does not exist:** any 2D offset, dilate, stroke-to-path or miter routine, anywhere. Extrude is
greenfield. Scene3D's `ExtrudeGeometry` is 3D-only and feeds a raster pipeline.

## The six traps

1. **`normalizePaint` rebuilds every arm field-by-declared-field.** Anything smuggled onto a `Paint`
   survives in memory and is **silently dropped on reload**. This already forced `fillAnchor` to be a
   sibling of `fill` rather than a field inside it. Every per-layer property — anchor, enabled, blend,
   extrude params — must live on the *layer*, never inside its paint.
2. **Positional paths silently re-point on reorder.** `MotionTrack.path` and Collection bindings
   address by index (`layers.2.color`). Splicing the array re-aims them at whatever moved into the
   slot — nothing throws. This is the entire reason for the stable-id decision. Note the failure modes
   differ: a stale *axis* binding is safely ignored (`clampCoords`), a stale *index* binding resolves
   to a **real but wrong** slot.
3. **`getByPath`/`setByPath` are naive positional traversal.** Id-addressed paths need a resolver;
   they cannot be handed to `setByPath` directly. `setByPath` also *creates* missing containers, so a
   typo'd path grows junk into the config and gets saved — `applyMotion` guards this by checking the
   **parent** exists.
4. **Legacy configs hold `fill`, `stroke`, `strokeWidth` as flat fields.** Every saved node. And
   **`ensureConfigDefaults` is NOT on the universal load path** — the node card, the bake and the frame
   source read the raw blob. This assumption has now nearly shipped broken twice in this codebase.
5. **paper.js boolean union is expensive and must not run per frame.** It is lazily imported with its
   own `PaperScope` and no global canvas. A union of N copies × M glyphs per frame will not hold 60fps.
   Live preview draws the un-unioned stack; the union is for bake and export.
6. **Export tier becomes `max()` across layers.** One raster-tier layer makes the whole export raster.
   `exportTier()` currently takes a single `Paint`; it must fold over the stack — and it must keep
   *deriving* from the exporter rather than growing a hand-maintained list.

## Model

```ts
export type VtLayerKind = 'fill' | 'stroke' | 'extrude'

export interface VtAppearanceLayer {
  id: string                 // STABLE. Minted once; never positional.
  kind: VtLayerKind
  enabled: boolean
  paint: Paint               // reuses the nine-type fill model as-is
  anchor: VtFillAnchor       // glyph | word | frame — per layer (trap 1: NOT inside `paint`)
  opacity: number
  blend?: BlendKind
  // stroke only
  width?: number             // output px
  // extrude only
  depth?: number             // number of offset copies
  angle?: number             // direction, degrees
  distance?: number          // px between copies
  taper?: number             // per-copy scale falloff
  solid?: boolean            // union the copies (bake/export only — trap 5)
}
```

Array order is paint order, **back to front**. A stroke *below* a fill becomes expressible, which it
is not today (stroke is unconditionally drawn after fill).

`LAYER_MAX` bounds it, matching Gradient and Shader.

---

## Tasks

### Task 1: Extract the list-remap helper, and add id addressing

Widest blast radius, goes first. Gradient has this logic extracted and tested; **Shader Studio
copy-pasted all three functions inline into its `.vue`** with a comment admitting it. A third stack
would triplicate it.

**Files:** create `lib/studio/listRemap.ts` + `lib/studio/idPath.ts`; modify `lib/gradientfx/motion.ts`, `ShaderStudioSurface.vue`.

- [ ] **Step 1:** Move `remapTracksOnReorder` / `dropTracksForLayer` / `remapTracksOnInsert` into
      `lib/studio/listRemap.ts`, generic over the path prefix (Gradient uses `layers.<i>.`, Shader uses
      `effects.<i>.params.`). Keep `gradientfx/motion.ts` re-exporting so its call sites and tests are
      untouched.
- [ ] **Step 2:** Repoint Shader Studio's three inline copies. **Behaviour-preserving** — its regex is
      `^effects\.(\d+)\.params\.(.+)$`; confirm the generic version reproduces it exactly.
- [ ] **Step 3:** `lib/studio/idPath.ts` — resolve `<list>.<id>.<rest>` to a positional path against a
      live config, and back. Trap 3: `getByPath`/`setByPath` cannot take an id path directly.
      **An unresolvable id must return `undefined`, never a fabricated index** — that is the difference
      between "this binding is ignored" and "this binding hit the wrong layer".
- [ ] **Step 4:** Tests for both, including the reorder cases Gradient's spec already pins.
- [ ] **Step 5:** Commit — `refactor(studio): shared list remap + id-addressed paths`

---

### Task 2: The appearance model

**Files:** `lib/vectortype/config.ts`, `controls.ts`, tests.

- [ ] **Step 1:** `appearance: VtAppearanceLayer[]` per the model above, strict `mergeConfig` rebuild.
      Mint ids on load for anything lacking one.
- [ ] **Step 2: Migration (trap 4).** A legacy config's `fill` + `fillAnchor` becomes one `fill` layer;
      `stroke` + `strokeWidth > 0` becomes one `stroke` layer above it. **Trace every read path** — node
      card, bake, frame source, thumbnail, SVG, sweep baker. Task 2 of the fills plan found **11**, one
      of which (`vtThumbConfig`) built a config directly and bypassed the merge. Assume the same here.
- [ ] **Step 3:** Keep `fill`/`stroke`/`strokeWidth` readable as **derived** accessors over layer 0 for
      one release, or delete them outright — decide, justify, and make sure nothing reads them raw.
- [ ] **Step 4:** Controls. Follow Gradient's **relative-prefix** pattern: declare `layer.*` once,
      unindexed, and let consumers expand per layer. The inspector shows the *active* layer's controls
      plus the stack — Gradient's dodge of the dynamic-vocabulary problem, and it works.
- [ ] **Step 5:** Commit — `feat(vectortype): appearance layer model`

---

### Task 3: Canvas rendering — the layer loop

**Files:** `lib/vectortype/canvas.ts`.

- [ ] **Step 1:** Replace the `if (paints) {…}` + `if (strokeWidth > 0) {…}` pair with a loop over
      enabled layers, **back to front**. Everything outside it (transform, clip, blur, alpha) is
      per-glyph-invariant and stays put.
- [ ] **Step 2:** `runPm`/`runStyle` — currently two hoisted locals for the word/frame anchors —
      become **per layer**. Cheap: a small array. Each layer keeps its own anchor.
- [ ] **Step 3:** Per-layer `opacity` and `blend` compose with the glyph's own motion opacity. Decide
      multiply-vs-replace and test the composition, not just each alone.
- [ ] **Step 4:** Prove a stroke **below** a fill renders correctly — that ordering is impossible today
      and is a headline of this work.
- [ ] **Step 5:** Commit — `feat(vectortype): render the appearance stack`

---

### Task 4: Extrude — the block shadow

**Files:** `lib/vectortype/extrude.ts`, `canvas.ts`.

The face is drawn once; extrude is *N copies of the same path* translated behind it. No new geometry.

- [ ] **Step 1:** `extrudeOffsets(layer) → {dx, dy, scale}[]` — pure, from `depth`/`angle`/`distance`/
      `taper`. Testable without a canvas; test it that way.
- [ ] **Step 2:** Draw back-to-front beneath the face. Each copy takes the layer's paint, so a gradient
      or shader extrude works for free.
- [ ] **Step 3:** `depth` interacts with `LAYER_MAX` on cost — N copies × M glyphs. Measure the frame
      time at a plausible worst case (long word, deep extrude) and **state the number**. Bound it if
      needed, and `log` what was bounded rather than silently capping.
- [ ] **Step 4:** Commit — `feat(vectortype): extrude as offset copies`

---

### Task 5: Extrude — the solid sweep

**Files:** `lib/vectortype/extrude.ts`, bake/export paths.

- [ ] **Step 1:** Union the offset copies via paper.js `unite`, behind `solid: true`.
      Follow `useVectorSvg.ts`'s existing pattern exactly — lazy `await import('paper')`, own
      `PaperScope`, never a visible canvas, no global scope.
- [ ] **Step 2: Trap 5 — this must not run per frame.** Live preview draws the un-unioned stack; the
      union runs on bake and export. Make the boundary explicit in code, with a comment, so nobody
      later calls it from a draw loop.
- [ ] **Step 3:** Verify the unioned path is a single closed body and that its SVG is one `<path>`, not
      N overlapping ones. Compare its rasterisation against the un-unioned stack — they should agree
      except where overlapping translucent copies previously double-darkened.
- [ ] **Step 4:** Commit — `feat(vectortype): solid extrude via boolean union`

---

### Task 6: SVG — K shapes per glyph

**Files:** `lib/vectortype/render.ts`, `canvas.ts`.

- [ ] **Step 1:** `outlinesToShapes` already returns an array — `flatMap` to K shapes per glyph.
      **Confirm `lib/vector/svg.ts` needs no change**; if it does, say exactly what and why.
- [ ] **Step 2:** Paint-server dedupe should already collapse shared ramps across layers and glyphs.
      Verify the emitted `<defs>` count is per distinct paint, not per shape.
- [ ] **Step 3:** Canvas-vs-export diff with a **deliberately broken control**, per the bar this
      codebase now holds: correct results have been landing at 0.0000% with broken controls at 95–100%.
      Cover a multi-layer stack, a stroke-below-fill, and an extrude.
- [ ] **Step 4:** Commit — `feat(vectortype): multi-layer SVG export`

---

### Task 7: Export tier over a stack

**Files:** `lib/vector/exportTier.ts` (or wherever Task 7 of the fills plan put it), `VectorTypeSurface.vue`.

- [ ] **Step 1:** Fold over the stack — one raster-tier layer makes the whole export raster.
      **Keep deriving from the exporter** (trap 6); do not grow a kind-name list.
- [ ] **Step 2:** Say *which* layer causes it. "Layer 3 (shader) exports as an embedded image" beats a
      generic warning when a stack has six layers.
- [ ] **Step 3:** Extrude is vector, so an extruded gradient stack must still report `vector`.
- [ ] **Step 4:** Commit — `feat(vectortype): export tier folds over the appearance stack`

---

### Task 8: The stack UI

**Files:** `VectorTypeSurface.vue`.

- [ ] **Step 1:** Mount `StudioLayerStack` in the `#aside` slot, exactly as Gradient and Shader do.
      Do not fork it; if it needs a prop it lacks, say so rather than copying it.
- [ ] **Step 2:** Layer labels derived from **what the layer is**, not its position — follow
      `gradientfx/layerLabel.ts`, including its de-duplicating ordinals ("Gradient", "Gradient 2").
      Its header explains why: positional names renumber on reorder and make motion targets look like
      they jumped. Labels must also be **unique**, because motion builds its dropdown from them.
- [ ] **Step 3:** Add-layer offers the three kinds. **A new stroke layer must be visible immediately** —
      a non-zero default width. The invisible-stroke problem is what prompted this work.
- [ ] **Step 4:** Overlay hygiene: `pointer-events-none` root, `pointer-events-auto` children.
- [ ] **Step 5:** Commit — `feat(vectortype): appearance stack UI`

---

### Task 9: Motion, Collection and the agent

**Files:** `lib/vectortype/motion.ts`, `agentControls.ts`, `lib/collection/studioControls.ts`.

- [ ] **Step 1:** Animatable targets expand per layer, id-addressed. Follow `animatableTargets`'
      relative-prefix expansion in `gradientfx/motion.ts`.
- [ ] **Step 2:** **Prove reorder is a no-op** — set a motion track on layer 0, reorder, confirm it
      still animates the same layer. This is the whole point of the stable-id decision; a test that
      does not actually reorder proves nothing.
- [ ] **Step 3:** Collection bindings likewise. A binding to a **deleted** layer must degrade to
      ignored, never to a wrong layer (trap 2).
- [ ] **Step 4:** Agent vocabulary over the stack, with `VT_GUIDANCE` naming only keys that exist.
- [ ] **Step 5:** Commit — `feat(vectortype): motion, sweeps and agent over the appearance stack`

---

### Task 10: Live verification

Nothing above is runtime-proven. The last three waves of this work each found bugs at exactly this
point that green unit tests missed — a reactive-proxy crash, a sweep×motion collision that baked five
identical PNGs, a cold-start export that silently wrote the wrong file.

- [ ] A stack of ≥4 layers rendering correctly, back to front.
- [ ] **A stroke below a fill** — impossible before this work.
- [ ] Extrude: block shadow, and solid sweep, both on canvas and in SVG.
- [ ] A **legacy saved node** opening with its fill and stroke intact (trap 4).
- [ ] Reorder with a motion track and a Collection binding attached — **both still point at the same
      layer** (trap 2).
- [ ] Per-layer anchors: a word-anchored gradient under a glyph-anchored stroke.
- [ ] PNG bake and SVG export carrying the whole stack.
- [ ] Export tier naming the right layer.
- [ ] Gradient Studio and Shader Studio still work — Task 1 moved their remap logic.

**"I looked and it rendered" is not evidence.** Diff pixels, or compare against a deliberately broken
control.

---

## Out of scope

True outline offset / stroke-as-geometry (needs a library paper.js doesn't have — its own project) ·
boolean ops *between glyphs* · per-layer clipping masks · widening the font list beyond the 10 curated
variable families (needs a family→repo-path resolver that exists nowhere) · 3D-projected extrude
(Scene3D already does that, and it leaves the vector pipeline).

## The number to watch

Every layer added must survive **reorder** with its motion and its bindings intact. The positional-path
hazard is the one failure in this design that is silent, plausible-looking, and destroys user work
rather than erroring — which is exactly why the stable-id route was chosen over matching the existing
two stacks.
