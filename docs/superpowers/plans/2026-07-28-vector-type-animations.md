# Vector Type — the animation wave

**Date:** 2026-07-28
**Status:** Plan, ready to execute
**Follows:** skew + arc (`f9cd8097b`..`50318329b`)

## The ask

Blink (letters and words), **per-glyph random axis scatter**, grade flicker, draw-on, colour tracks,
misregistration drift and an extrude light sweep.

## The unifying insight — build the primitive once

**Blink, axis scatter and grade flicker are the same thing**: one seeded per-glyph random number
driving a different target. Opacity for blink, an axis coordinate for scatter, `GRAD` for the flicker.
Build that source once, with a **channel** parameter so two effects on the same glyph don't correlate,
and the three presets are thin.

`motion.ts` already has the right primitive:

```ts
function hash32(index: number, seed: number): number {
  let h = (index | 0) ^ Math.imul(seed | 0, 0x9e3779b1)
  …  // 32-bit avalanche. Integer maths only — no floats, no Math.random.
}
```

It exists because the stagger's `random` order had to be **seeded and stable**: a per-frame
`Math.random()` makes the bake flicker and the SVG export non-reproducible. **Blink is literally
per-frame randomness, so this is the trap, not a nicety.** Time must enter as a quantised bucket —
`hash32(index, seed, floor(t / period))` — never as a fresh roll.

## The five traps

1. **Determinism, as above.** The same `(glyph, t)` must give the same value in the preview, the PNG
   bake, the video bake and the SVG export. A test that renders the same frame twice and compares is
   the minimum bar; better is asserting a bake and a preview agree.
2. **There is no word-level unit in this studio.** It is glyphs all the way down — no `splitLevel`
   like the old kinetic catalog had. Word grouping is new. `outline.ts` carries `codePoints` per
   glyph, so spaces are detectable, but decide what a "word" is (what about punctuation, a hyphen,
   a run with no spaces at all?) rather than discovering it in the renderer.
3. **Tracks carry numbers, not colours.** `migrateKinetic.ts:210` records it as the reason
   `color-cycle` and `color-wave` were dropped. `MotionTrack.from`/`to` are numbers and `trackValue`
   returns a number. This is a real type boundary, not an oversight — see Task 6.
4. **`VT_GLYPH_TARGETS` is a closed, hand-declared list** of five channels, and `GLYPH_FIELD` derives
   from it, so adding one is a single edit — but it *is* an edit. Random axis values are **not** a
   glyph target; they belong with the per-glyph axis machinery `presetMotion.ts` already has
   (`transforms[i].axes`).
5. **Draw-on strokes the outline**, so it interacts with the appearance stack's stroke layers — which
   layer does it apply to? Decide before building.

---

## Tasks

### Task 1: Try the free ones first

**Do not build anything until you have measured whether it already works.**

`extrude.angle` is a declared slider, and this studio's guarantee is that *every declared slider is
animatable for free* because it is `f(cfg, t) → paths` with no engine to rebuild. So an **extrude
light sweep** may already work today. **Misregistration drift** may too — it is two fill layers with
animated `glyph.dx`/`dy` and nothing else.

- [ ] **Step 1:** Animate `extrude.angle` and see. Report what happened with pixels.
- [ ] **Step 2:** Two fill layers, offset tracks in opposition. Report.
- [ ] **Step 3:** Whatever already works, **write it up as a preset** rather than a discovery — the
      value is a tile in the gallery, not a possibility.
- [ ] **Step 4:** Commit — `feat(vectortype): extrude sweep and misregistration presets`

---

### Task 2: Seeded per-glyph randomness, and word grouping

**Files:** `lib/vectortype/random.ts`, `lib/vectortype/words.ts`, tests. **Pure — no canvas, no DOM.**

- [ ] **Step 1:** `glyphRandom(index, seed, channel, bucket?) → number` in 0..1, built on the existing
      `hash32`. The **channel** keeps blink and scatter from correlating on the same glyph — without
      it, a letter that blinks off is also the one that scatters furthest, every time.
- [ ] **Step 2:** Word grouping from `codePoints` (trap 2). Decide punctuation and hyphen behaviour
      explicitly; a run with no spaces is one word.
- [ ] **Step 3:** Tests: stable across calls, uncorrelated across channels, uniform enough not to
      clump, and **identical for the same `(index, seed, bucket)` on a second evaluation**. Compare
      channel correlation against a deliberately shared-channel control.
- [ ] **Step 4:** Commit — `feat(vectortype): seeded per-glyph randomness and word grouping`

---

### Task 3: Blink

**Files:** `lib/vectortype/motion.ts` or a preset module, `controls.ts`.

- [ ] **Step 1:** A seeded on/off from `glyphRandom` with a quantised time bucket. Controls: rate,
      duty cycle (how long it stays on), and how many units are out at once.
- [ ] **Step 2:** `unit: 'letter' | 'word'`, using Task 2's grouping.
- [ ] **Step 3:** **Prove determinism** — the same frame rendered twice is identical, and a bake at
      time `t` matches the preview at `t`. This is trap 1 and it is the whole risk of the feature.
- [ ] **Step 4:** Commit — `feat(vectortype): blink`

---

### Task 4: Random axis scatter — *the user's idea, and the distinctive one*

**Files:** `lib/vectortype/presetMotion.ts` or a preset module, `controls.ts`.

Each glyph settles at its **own** randomly-chosen position on a chosen axis, drawn around the base
value. Weight and slant are the obvious ones; it works on any axis the font has.

This is the axis equivalent of a scramble, and **nothing else in the market can do it** — it needs
per-glyph variable-axis shaping, which is this studio's whole reason to exist.

- [ ] **Step 1:** Controls: which **axis**, a **spread** around the configured base, and a **mode** —
      *settle* (an entrance: scatter, then resolve to the base) versus *wander* (a loop).
- [ ] **Step 2:** Values come from `glyphRandom` on its own channel, **clamped to the font's own axis
      range** (`clampCoords` already exists and degrades a stale binding to ignored rather than wrong).
- [ ] **Step 3:** It must compose with the existing axis tracks — a scatter *and* a weight wave should
      both be visible. The composition rule for the rest of this studio is offsets add, scale and
      opacity multiply; pick one for axes, justify it, and **test the composition**, not just each alone.
- [ ] **Step 4:** Verify on **Roboto Flex** (13 axes) and confirm a graceful result on **Inter** (2).
      Prove the outlines actually re-shape — command count constant, ink and advances moving.
- [ ] **Step 5:** Commit — `feat(vectortype): random per-glyph axis scatter`

---

### Task 5: Grade flicker

**Files:** the axis preset table.

`GRAD` changes weight **without changing width**, so the line never reflows. Paired with blink this is
a convincing broken-sign look that a warp-based tool cannot produce.

- [ ] **Step 1:** A flicker preset on `GRAD`, seeded, on its own channel.
- [ ] **Step 2:** **Prove the no-reflow property** the way it was proven for Grade Pulse: shaped
      advances identical to the un-animated run (0.000% change) while ink swings, against a `wght`
      control that moves advances. Without that measurement this is just a weight flicker.
- [ ] **Step 3:** Gracefully absent on fonts without `GRAD` — disabled with the reason, matching how
      the axis presets already handle a missing axis.
- [ ] **Step 4:** Commit — `feat(vectortype): grade flicker`

---

### Task 6: Colour tracks

**Files:** `lib/studio/track.ts` or a colour-track variant, `motion.ts`, `controls.ts`.

The named gap. It killed two presets in the KineticType migration and blocks a whole family — colour
cycling, per-glyph hue drift, animated gradient stops.

- [ ] **Step 1:** Decide the shape and justify it. Two candidates:
      **(a)** three numeric tracks on H/S/L components — cheap, composes with everything that exists,
      but exposes three sliders where a user wants one thing;
      **(b)** a genuine colour track kind — cleaner UX, but `MotionTrack.from`/`to` are numbers and
      `trackValue` returns a number, so it is a real type boundary and every consumer must cope.
- [ ] **Step 2:** **Interpolation space matters.** A naive RGB lerp passes through grey and looks
      dead. Use a perceptual space (OKLab or at least HSL) and **show the difference** against an RGB
      control — that comparison is the justification for the choice.
- [ ] **Step 3:** Canvas and SVG must agree, at the studio's usual 0.0000% bar with a broken control.
- [ ] **Step 4:** Commit — `feat(vectortype): colour motion tracks`

---

### Task 7: Draw-on

**Files:** `lib/vectortype/pathLength.ts`, `canvas.ts`, `render.ts`.

Letters drawing themselves. The canonical vector-type animation, and it stays **real editable SVG** —
`stroke-dasharray` / `stroke-dashoffset` are genuine attributes, not a raster trick.

- [ ] **Step 1:** Per-glyph path length. Needs Bézier arc length; `lib/vectortype/curve.ts`'s
      cumulative-chord + binary-search approach is the pattern to follow, and it is already proven
      here. **Do not reach for paper.js** — a draw-on runs every frame, and the guarantee that a draw
      frame cannot reach paper is load-bearing and guarded by three tests.
- [ ] **Step 2:** Canvas via `setLineDash`/`lineDashOffset`; SVG via the attributes. The two must agree.
- [ ] **Step 3:** **Which layer draws on?** (trap 5) The stack may hold several strokes. Decide — the
      active stroke layer, all of them, or a per-layer flag — and justify.
- [ ] **Step 4:** Canvas-vs-SVG at 0.0000% with a broken control, at several progress values.
- [ ] **Step 5:** Commit — `feat(vectortype): draw-on`

---

### Task 8: Live verification

- [ ] Every new preset applied and observed, with a measurement each.
- [ ] **Determinism end-to-end**: the same frame twice, a bake vs the preview, and an SVG export at a
      given `t` — all identical. This is the risk that runs through blink, scatter and flicker alike.
- [ ] Scatter on Roboto Flex and gracefully absent where an axis is missing.
- [ ] Grade flicker's no-reflow property, measured.
- [ ] Draw-on in the SVG opening as real dash attributes.
- [ ] Colour tracks in both renderers.
- [ ] **All of it on an arc**, since arc rotates glyphs and every one of these is per-glyph.
- [ ] The Compositor and Space Type unaffected.

**"I looked and it rendered" is not evidence.** Diff pixels or use a broken control. Known traps: a
**stale Vite module instance** (four times in this series now), and a frozen node card. And note the
methodological lesson from the last verification: **the `core %` metric is blind to geometry** — a
wrong matrix can read 0.00% — so carry a second ink-XOR/IoU metric.

---

## Out of scope

Perspective (its own pass) · bending letterforms · scramble that rewrites glyphs to different
characters (different problem from axis scatter, though it would look related) · per-word units for
anything beyond blink until something else needs them.

## The number to watch

**Determinism.** Three of these features are randomness, and this studio's whole promise is that what
you preview is what you export. If a bake and a preview at the same `t` ever disagree, the feature is
broken even when it looks right — and it will look right.
