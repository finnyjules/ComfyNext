# Vector Type — the stroked extrude silhouette

**Date:** 2026-07-28
**Status:** Plan, ready to execute
**Follows:** the appearance stack (`00d307f0b`..`7953f8c4b`)

## The ask

An extrude layer should be able to carry its own **stroke** — one outline around the whole extruded
body, the classic outlined-3D-lettering look.

## Why this is not just "set `lineWidth`"

`width` is currently **inert** on an extrude layer, deliberately. And stroking the copies individually
would draw an outline around *each* of them — internal seam lines through the block, not a silhouette.

A silhouette requires the **union**. You cannot get an outer contour from N overlapping paths without
fusing them first.

## The constraint that shapes everything here

The union costs **~1.3 ms per copy** — 575× the 2.25 µs it takes to *draw* one. Task 5 proved three
independent ways that a draw frame cannot reach paper.js:

1. `canvas.ts`'s transitive import graph never reaches `paper` (a test that initially **missed a bare
   `import 'paper'`** and was fixed by breaking it)
2. `drawVectorType` is synchronous where the union is an `AsyncFunction`
3. the renderer's input is a `ReadonlyMap` of plain commands keyed by layer id, not a callable

**That guarantee is not being reopened.** Instead:

> The live path **reads** the cached body. It never **triggers** a union.

`solidExtrudeBodyCached` already memoises on the union's whole geometric input — commands, copies,
origin, advance — *not* on a guess about what is animated. Extrude geometry is time-invariant unless
an extrude parameter is itself animated, so the cache hits on essentially every frame after the first.
It took a 120-frame bake from 111.5 s to 1.12 s.

A cold frame draws **unstroked**, then the stroke appears once the body lands. That is exactly the
posture `resolveField` already takes: it returns `null` while a shader field is still cooking and the
caller falls back to the input rather than blocking.

## The traps

1. **Do not let `canvas.ts` import paper, even transitively.** Task 5's import-graph test exists and
   must keep passing. The cache therefore lives in its own **paper-free** module that `extrudeSolid.ts`
   writes to and `canvas.ts` reads from. A static import of `extrudeSolid.ts` from `canvas.ts` would
   *probably* be fine (its `paper` import is `await import(…)` inside a function) — but "probably" is
   not what that test is for.
2. **`ControlSpec` has no boolean kind.** `layer.solid` is undeclared for a documented reason: faking
   one as a `select` over `['off','on']` ships a toggle that appears to work and **forgets itself on
   reload**, because `mergeLayer` reads `typeof o.solid === 'boolean'` and drops the string. Its home
   is a stack row beside `enabled`, not the schema.
3. **Stroke is a flat colour in this studio, deliberately.** Task 2 of the fills plan decided that and
   justified it. Do not widen it to a `Paint` here as a side effect.
4. **The paint-box clipping bug is live** (`resolvePaint` returns a `no-repeat` pattern; a `Fill`-form
   gradient loses ~68% of an extrude's ink at the `glyph` anchor). It is reported, not fixed, and it is
   **not yours**. Do not let it confuse a measurement — test the silhouette with solid colours.

---

## Tasks

### Task 1: A paper-free body cache the live path can read

**Files:** create `lib/vectortype/extrudeBodyCache.ts`; modify `extrudeSolid.ts`, `canvas.ts`.

- [ ] **Step 1:** Move the memo out of `extrudeSolid.ts` into a module with **zero paper dependency** —
      a plain keyed store of command lists. `extrudeSolid.ts` writes; anyone may read.
- [ ] **Step 2:** A synchronous `peekSolidBody(key)` returning the body or `undefined`. **It must never
      compute.** Name it so that is obvious.
- [ ] **Step 3:** `canvas.ts` reads it. Task 5's import-graph test must still pass — **run it and say
      so**. If it does not, the cache module has a paper edge and the split is wrong.
- [ ] **Step 4:** Something must trigger the union off the draw loop when extrude params change. The
      surface is the natural owner (a watcher); bake and export already trigger it. Wire it, and make
      sure a rapid slider drag does not queue a hundred unions — coalesce.
- [ ] **Step 5:** Commit — `feat(vectortype): paper-free extrude body cache`

---

### Task 2: The silhouette stroke

**Files:** `lib/vectortype/config.ts`, `controls.ts`, `canvas.ts`, `render.ts`.

- [ ] **Step 1:** Make `width` live on an extrude layer, and add a stroke colour to the layer (flat
      colour — trap 3). Strict `mergeLayer` rebuild; per-layer props go on the **layer**, never inside
      its `paint` (they vanish on reload otherwise).
- [ ] **Step 2:** Canvas: stroke the cached body. **No body → no stroke, no error, no blocking.**
- [ ] **Step 3:** SVG: the body is already emitted as one `<path>` per body; add the stroke attributes
      to it. Confirm `lib/vector/svg.ts` still needs no change.
- [ ] **Step 4:** Verify the stroke is a **silhouette**, not per-copy outlines — count the stroke's ink
      against a deliberately per-copy control. Internal seam lines are the failure signature.
- [ ] **Step 5:** Commit — `feat(vectortype): stroke the extruded silhouette`

---

### Task 3: `solid` as a stack row

**Files:** `StudioLayerStack.vue` or `VectorTypeSurface.vue`.

- [ ] **Step 1:** A per-row toggle beside the eye, for extrude layers only. **Do not declare it in
      `ControlSpec`** (trap 2) — it must round-trip as a real boolean.
- [ ] **Step 2:** `StudioLayerStack` is shared with Gradient and Shader. **Do not fork it.** If it needs
      a slot or an optional prop, add one that those two ignore, and say what you added.
- [ ] **Step 3:** Prove the toggle survives a reload — that is the exact failure the schema was avoiding.
- [ ] **Step 4:** Commit — `feat(vectortype): solid extrude toggle in the stack`

---

### Task 4: Live verification

- [ ] A stroked silhouette on canvas, at several depths and angles.
- [ ] The same in SVG export — one `<path>` per body carrying the stroke.
- [ ] **A cold load draws unstroked and then fills in** — the fallback, observed, not assumed.
- [ ] A rapid `depth` drag does not stall the UI.
- [ ] Task 5's import-graph test still passes; `canvas.ts` still cannot reach paper.
- [ ] The `solid` toggle round-trips through a reload.
- [ ] Bake and export still union correctly, and the 120-frame bake is still ~1 s, not ~110 s.

**"I looked and it rendered" is not evidence.** Diff pixels, or compare against a broken control.
Earlier tasks hit a **stale Vite module instance** twice — assert the app's own import exports what you
expect before trusting a measurement.

---

## Out of scope

Per-copy stroking as a second mode · widening extrude stroke to a full `Paint` · fixing the
`resolvePaint` paint-box clipping (reported separately, shared with the Compositor) · inter-glyph
union (the body is per glyph by design).

## The number to watch

A draw frame must never block on paper.js. If the live path can trigger a union, a deep extrude will
drop 67 consecutive frames and the studio will feel broken — which is precisely why the union was
walled off in the first place.
