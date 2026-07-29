# Vector Type — skew and arc

**Date:** 2026-07-28
**Status:** Plan, ready to execute
**Follows:** the appearance stack (`00d307f0b`..`7953f8c4b`) and the extrude silhouette (`bc75c2d30`..`c445d03cf`)

## The ask

Skew the text, and arc it. (Perspective was asked for at the same time and is **deliberately deferred**
to its own design pass — see the end.)

## Decisions taken (2026-07-28)

1. **Arc means rigid-body placement along the curve** — each glyph translated and rotated onto it,
   letterforms unchanged. This is what `utils/textOnPath.ts` already does, what the design doc calls
   "a path deform", and it stays **exactly-correct vector** because rigid placement is affine.
   *Bending the letterforms themselves is out* — that is point-level deformation with the same
   rational-Bézier approximation problem as perspective, and belongs with it.
2. **Skew and arc now; perspective as its own pass.** Both of these are exactly-correct vector and
   reuse machinery that exists. Three features at once is where the sprawl risk lives.

## The design decision that is not obvious

**Do not use paper.js for the arc-length parameterisation.**

paper has exactly the right API — `getPointAt`/`getTangentAt`/`getNormalAt` all take arc-length
offsets. But Task 5 proved three independent ways that `canvas.ts` **cannot reach paper.js**, and that
guarantee is load-bearing (adding a bare `import 'paper'` to the extrude body cache turns its
import-graph test red). Arc placement runs *every frame*, unlike the boolean union.

For the parametric curves v1 needs, arc-length is a cumulative-chord table plus a binary-search
inversion — roughly 15 lines, pure, and far cheaper than a paper round-trip. `lib/spacetype/
tickerGeometry.ts` already does the forward half (`sampleCentreline` builds a `Float64Array cum`)
and its header explains why it exists: *"Ribbon maps u uniformly in the curve parameter t, so glyphs
stretch through bends and bunch on straights. Ticker fixes both — equal arc length gets equal u."*

`utils/textOnPath.ts` gets this **wrong** in exactly that way: it estimates length over 200 uniform
`t` steps then maps advance÷length straight back to `t`, which is only correct for constant-speed
curves. Treat it as a spec for the placement loop, not as a library.

## The five traps

1. **`glyphCellClipRect` is axis-aligned, and the reveal-vs-mask distinction depends on the window
   being FIXED.** `render.ts:120` states it: *"The window is FIXED in output space. Whatever transform
   the glyph carries is applied to the glyph and not to this rect, so the letter slides THROUGH the
   window rather than dragging it along."* A glyph rotated 40° on an arc makes an axis-aligned rect the
   wrong window — a `top` reveal wipes vertically while the letter sits diagonally. **This is the single
   most-underestimated cost in this plan.**
2. **Extrude offsets assume a horizontal cell centre and a baseline pivot** (`extrude.ts:187`
   `extrudeCopyTransform`). On an arc, should a glyph's shadow step in its own rotated frame, or should
   every shadow fall the same absolute direction (one light source)? That is a **decision**, not a default.
3. **Paint boxes are axis-aligned** (`vtRunPaintBox`, `vtGlyphPaintBox`). A `word`-anchored gradient
   across an arc'd run spans the arc's *bounding box*, not the arc. Not wrong exactly — but not what a
   user expects, and worth deciding deliberately.
4. **Skew is whole-run, not per-glyph.** A shear applied about each glyph's own origin makes every
   letter slant while the word does not — the wrong-looking one. Apply once at run level.
5. **`VectorShape` has no `transform` field**, and does not need one. Per-glyph motion already survives
   export through the open `attrs` bag (`attrs.transform = "matrix(…)"`), deliberately, *"so the spine
   stays free of any one studio's motion model."* Follow that; do not grow the spine.

## What already exists

| piece | file | note |
|---|---|---|
| placement transform | `lib/vectortype/render.ts:75` `glyphTransform` | `{scale, x, y, flipY}` — **no rotation yet** |
| the geometry choke point | `render.ts:159` `placeOutlines` | canvas AND svg both consume its output |
| affine helpers | `lib/vector/svg.ts:163-219` | `Affine`, `multiplyAffine`, `invertAffine` |
| the two mirrored transform writers | `canvas.ts:1516` `glyphSvgTransform`, `:1558` `glyphSvgMatrix` | a test parses one against the other |
| glyph origin carried separately | `outline.ts:42` `GlyphOutline.x/y` | *"placement is carried separately rather than baked into the commands"* — this is what makes arc cheap |
| the placement loop, as a spec | `utils/textOnPath.ts:169-188` | accumulate half-advance, place centre, rotate to tangent |
| cumulative-chord sampling | `lib/spacetype/tickerGeometry.ts:65` | the forward half; the inversion is new |

---

## Tasks

### Task 1: Skew

Cheapest real win, ships alone, unblocks nothing — so it goes first and gets out of the way.

**Files:** `lib/vectortype/config.ts`, `controls.ts`, `canvas.ts`.

- [ ] **Step 1:** `skewX` / `skewY` in degrees on the config, in the `Layout` group. Whole-run (trap 4).
- [ ] **Step 2:** Compose the shear into the run transform — `[1, tan(skewY), tan(skewX), 1, 0, 0]`.
      Canvas is one `ctx.transform`; SVG goes through the existing `attrs` bag (trap 5). Both of the
      mirrored writers must agree; there is already a test holding them together.
- [ ] **Step 3:** `invertAffine` is load-bearing for run-anchored gradients (`gradientTransform` holds
      the inverse). A shear is invertible unless degenerate, but the inverse now has off-diagonal
      terms — **test a word-anchored gradient under skew** specifically.
- [ ] **Step 4:** Label it honestly. `controls.ts` already says *"Slant — a true oblique, not a skew"* of
      the `slnt` axis; a skew slider is the cruder effect and the hint should say so.
- [ ] **Step 5:** Canvas-vs-SVG diff with a broken control, per the bar this codebase holds (correct
      results land at 0.0000%, broken controls at 95–100%).
- [ ] **Step 6:** Commit — `feat(vectortype): skew`

---

### Task 2: A paper-free arc-length curve module

**Files:** create `lib/vectortype/curve.ts` + tests. **Pure — no canvas, no DOM, no paper.**

The best test leverage in this plan: it is plain numbers in, plain numbers out.

- [ ] **Step 1:** A curve type for v1 — an **arc** (radius, start/end angle), shaped so `circle`/`wave`/
      `line` can follow without redesign. `utils/textOnPath.ts`'s `PathType` union is the vocabulary to
      match, since absorbing that widget later is the stated intent.
- [ ] **Step 2:** `curveLength(curve)` and `pointAtLength(curve, s) → { x, y, angle }`, via a cumulative
      chord table plus **binary-search inversion**. Equal arc length must give equal spacing — that is
      the property `textOnPath.ts` gets wrong on non-constant-speed curves.
- [ ] **Step 3:** Tests: even spacing on a constant-speed curve **and on a wave**, where naive
      `t`-uniform sampling visibly bunches. Compare against a deliberately naive implementation and show
      the difference — that is what proves the inversion is doing work.
- [ ] **Step 4:** Commit — `feat(vectortype): arc-length curve sampling`

---

### Task 3: Arc placement

**Files:** `lib/vectortype/render.ts`, `canvas.ts`.

- [ ] **Step 1:** Extend the placement transform to carry **rotation**. `render.ts:75`'s
      `Required<Transform2D>` is `{scale, x, y, flipY}` today. This is the one structural change.
- [ ] **Step 2:** Place each glyph per `textOnPath.ts:169-188`'s algorithm — accumulate half-advance,
      place the centre, rotate to the tangent — but using **fontkit's shaped `xAdvance`**, not
      `ctx.measureText`. The existing widget has no kerning, shaping or ligatures; Vector Type does.
- [ ] **Step 3:** It must flow through `placeOutlines` so canvas and SVG stay one implementation.
- [ ] **Step 4:** Verify the SVG matches canvas with a broken control, and that glyph **spacing is even
      along the curve** — measure inter-glyph distance, don't eyeball it.
- [ ] **Step 5:** Commit — `feat(vectortype): place glyphs along a curve`

---

### Task 4: The consequences — clip, extrude, paint boxes

**Files:** `render.ts`, `canvas.ts`, `extrude.ts`, possibly `lib/vector/svg.ts`.

Trap 1 is the real work here. **Do not skip straight to a fix** — decide first.

- [ ] **Step 1: the clip window.** A rotated glyph breaks the axis-aligned cell rect. Either rotate the
      window with the glyph (which changes what "slides through a stationary window" means — the
      design's whole reveal-vs-mask distinction), or let `VectorShape.clip` accept a rotated quad
      (which touches the studio-agnostic spine). **Decide, justify, and say what it costs.** If it needs
      the spine, keep the addition generic — Shape Studio is its intended second consumer.
- [ ] **Step 2: extrude on an arc** (trap 2). Rotated frame per glyph, or one absolute light direction?
      Pick, justify, and make it observable.
- [ ] **Step 3: paint boxes on an arc** (trap 3). A `word`-anchored gradient currently spans the
      bounding box. Decide whether that is acceptable and say so.
- [ ] **Step 4:** Verify a mask preset, an extrude and a word-anchored gradient all on an arc'd run.
- [ ] **Step 5:** Commit — `feat(vectortype): clip, extrude and paint on a curve`

---

### Task 5: Controls, motion and the agent

**Files:** `controls.ts`, `agentControls.ts`.

- [ ] **Step 1:** Declare skew and arc params in `Layout`. **Motion is free** — `animatableTargets`
      admits any slider where `animatable !== false`, because Vector Type is `f(cfg, t) → paths` with
      no engine to rebuild. Confirm rather than assume.
- [ ] **Step 2:** Agent vocabulary + guidance prose naming only keys that exist (there is a test).
- [ ] **Step 3:** An animated arc radius, and an animated skew, both proven to move.
- [ ] **Step 4:** Commit — `feat(vectortype): skew and arc in the schema`

---

### Task 6: Live verification

- [ ] Skew at several angles, canvas and SVG.
- [ ] A word-anchored gradient **under skew** (the `invertAffine` case).
- [ ] Arc at several radii — glyph spacing even, letters upright to the curve.
- [ ] Arc **plus** the appearance stack: a stroke, an extrude, and a mask preset.
- [ ] SVG export of an arc'd run opening as real paths with per-glyph `transform` matrices.
- [ ] Motion on both, including a **reorder** of the appearance stack while an arc is active.
- [ ] The Compositor and Space Type unaffected.

**"I looked and it rendered" is not evidence.** Diff pixels or use a broken control. Known traps: a
**stale Vite module instance** (twice now), and a frozen node card.

---

## Out of scope

**Perspective** — its own design pass. It is the only one of the three that cannot be an SVG
`transform` (affine-only, stated twice in this codebase's own comments), so it needs point-level
homography on control points plus subdivision, and its output *approximates* the true projection
because a projected Bézier is rational and SVG path data has no weights. The math already exists
(`lib/compositor/warp.ts`'s `squareToQuad`/`applyHomography`, pure and unit-tested; `utils/textWarp.ts`'s
4×4 with a real perspective divide). What does not exist is Bézier subdivision, a tolerance model, and
a caching answer for animating it. **Note the trap for whoever takes it:** a browser renders
`style="transform: perspective(…)"` on an SVG element and it does *not* round-trip to Illustrator —
that is a rendering instruction, not geometry.

Also out: bending letterforms around the curve · absorbing the TextOnPath widget itself (this builds
the capability; retiring the widget is a separate call) · arbitrary user-drawn paths.

## The number to watch

Skew and arc must both stay **exactly** correct in SVG — 0.0000% against canvas, with broken controls
in the 95–100% range, the bar every SVG task in this studio has met so far. The moment a transform
stops being affine, that guarantee is gone, and that is precisely the line between this plan and the
perspective one.
