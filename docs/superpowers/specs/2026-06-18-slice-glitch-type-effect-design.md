# Slice Glitch — Space Type effect

**Date:** 2026-06-18
**Status:** Design approved, pending spec review
**Branch:** to be created (`feat/slice-glitch-type-effect`) at implementation time

## Goal

Add a new pluggable Space Type effect that reproduces a kinetic color-slice
glitch poster: a heavy condensed headline ("THE / MEANING / OF ALL / MOTIONS /
SHAPES & / SOUNDS") that starts as clean white-on-black stacked type and
animates into a horizontal-slice glitch — bands displaced left/right, flooded
with flat vibrant colors, hand-drawn doodles floating over the top.

Reference: user-supplied carousel (5 frames). The clean stacked type is the
*start* state; the sliced-color glitch is the developed state.

## Decisions (from brainstorming)

- **Rendering approach:** A — canvas-composite + strip displacement. A 2D
  flat-plane effect (Elastic family): an offscreen canvas is redrawn each frame
  and carried on a full-screen plane as a `CanvasTexture`.
- **Motion:** support BOTH a clean→glitch reveal (animated, baked to video) AND
  a static still. One `glitch` amount (0→1) is the single driver; a `revealMode`
  control switches between animated ramp+churn and a held still.
- **Palette:** curated bright set as default, editable via the existing
  `fillList` control.
- **Doodles:** in scope for v1.
- **Width morph:** yes — each line's horizontal `scaleX` is driven by the glitch
  amount (natural centered widths when clean → stretched edge-to-edge when
  glitched). This is the visual morph between the start state and the look.
- **Default tuning:** tune defaults (palette, density, font, doodle count)
  tightly to the reference screenshots via a Playwright screenshot loop before
  wiring into the Surface.

## Architecture

New effect file `frontend/app/lib/spacetype/effects/sliceGlitch.ts` implementing
the `SpaceTypeEffect` interface (`frontend/app/lib/spacetype/effect.ts`),
registered by appending to `SPACE_TYPE_EFFECTS` in
`frontend/app/lib/spacetype/effects/index.ts`. No core changes required.

- `id: 'sliceglitch'`, `label: 'Slice Glitch'`
- `buildScene(three, params, textTexture, env)` — creates a single full-screen
  plane (the engine's existing flat/ortho path, mirroring Elastic) with a
  `CanvasTexture`. Captures the offscreen canvas + 2D context + texture in
  closure/userData so `update` can redraw. The supplied `textTexture` is not
  used for the glyphs (we rasterize per frame for the per-line scaleX morph);
  follow Elastic's exact state-capture pattern (confirm by reading
  `effects/elastic.ts` during implementation).
- `update(t01, params)` — derive `glitch` from `t01` + `revealMode`, recompute
  the seeded layout, redraw the offscreen canvas, set `texture.needsUpdate`.
  Pure in `t01` (deterministic for a given params + t01).

### Per-frame canvas composition

1. **Type stack** — lines from `textList`, heavy condensed font, negative
   tracking, line-height ~0.85 so rows kiss. Centered. Rasterized per frame.
2. **Width-fit morph** — per line, `scaleX` interpolates from natural width
   (glitch=0) toward target band width (glitch=1).
3. **Color blocks** — each line band partitioned into a few seeded random-width
   vertical segments filled from the palette; some segments left as background.
   Drawn behind the type.
4. **Type layer** — drawn over the blocks; per-line type color = white / palette
   / mixed per `typeColorMode`.
5. **Slice displacement** — the composited canvas is cut into horizontal strips,
   each blitted with a seeded x-offset in two layers: coarse **band shift**
   (chunky per-line tears) + fine **scanline tear** (`tearFrequency`). Optional
   **RGB channel split** (`rgbSplit`) draws the composite 3× with small R/G/B
   x-offsets.
6. **Doodles** — seeded hand-drawn strokes drawn last, over everything.

### Glitch driver

- `glitch ∈ [0,1]` is the single amount controlling width morph, block opacity,
  displacement magnitude, and doodle presence.
- `revealMode = 'animate'`: `glitch` ramps 0→1 over the first portion of the
  loop, then churns — a **time-quantized seed** advances a few times per second
  so offsets/colors flicker (the stuttery frame-to-frame feel). `speed` scales
  the timeline; `churnRate` sets flicker frequency.
- `revealMode = 'hold'`: `glitch` is fixed to the `glitchAmount` slider and the
  seed is static → a frozen still (deliverable #3). Holding `glitchAmount = 1`
  gives a full-glitch still; `0` gives the clean stacked type.

## Pure modules (unit-tested)

- `frontend/app/lib/spacetype/sliceGlitchLayout.ts` — given `{lines, width,
  height, glitch, seed, ...}` returns band rects, per-line `scaleX`, color
  segments (palette indices + widths), per-line type color, and strip x-offsets
  (coarse + fine). No Three.js, no canvas — pure data.
- `frontend/app/lib/spacetype/doodleField.ts` — seeded doodle placement +
  stroke-path generation (loops, spirals, zigzags, scribble-circles, flicks)
  returning an array of polyline/bezier stroke commands. Pure.
- Seeded RNG: reuse an existing helper if one exists in `lib/spacetype/`;
  otherwise add a small deterministic PRNG (e.g. mulberry32) used by both
  modules so the same seed reproduces the same composition.

The canvas-drawing code (`sliceGlitch.ts`) consumes these pure outputs and is
the only part touching the 2D context / Three.js.

## Controls (declarative `ControlSpec[]`)

- **Type:** `lines` (textList), `font` (font, default `Anton`), `weight`
  (slider), `tracking` (slider, negative-capable), `lineHeight` (slider),
  `fitWidth` (slider — max width-morph target)
- **Color:** `palette` (fillList, default curated bright set), `blockDensity`
  (slider — segments per band), `typeColorMode` (select: white/palette/mixed),
  `bgColor` (color, default near-black `#141414`)
- **Glitch:** `revealMode` (select: animate/hold), `glitchAmount` (slider — used
  in hold), `bandShift` (slider), `tearAmount` (slider), `tearFrequency`
  (slider), `rgbSplit` (slider), `churnRate` (slider)
- **Doodles:** `doodlesOn` (select on/off or slider 0/1), `doodleCount`
  (slider), `doodleSize` (slider), `doodleColorMode` (select)
- **Motion:** `speed` (slider)

Defaults tuned to the reference during the screenshot loop.

## Export

Reuses existing motion-bake rails (`lib/spacetype/bake.ts`,
`engine.renderFrame` → PNG → `ensureSpaceTypeBake`). No new export plumbing.
Hold mode produces a single representative still; animate mode bakes the loop.

## Verification plan

1. Unit tests for `sliceGlitchLayout` and `doodleField` (determinism for a seed,
   monotonic displacement with glitch, segment widths sum to band width, layout
   stable across calls).
2. Standalone HTML harness rendering the effect, iterated with Playwright
   screenshots against the reference frames until the default look matches
   (per the standing "verify visuals with screenshots" rule — no shipping a
   WebGL effect on unit tests alone).
3. In-app verify in the SpaceTypeSurface modal: effect appears in the picker,
   controls drive the look, reveal animates, hold produces a still, bake exports
   frames.

## Out of scope (v1 / deferred)

- Shader-based displacement / aberration pass (Approach C upgrade).
- Audio-reactive timing.
- Per-doodle hand authoring (doodles are procedural/seeded in v1).

## Open implementation notes

- Confirm Elastic's exact per-frame state-capture pattern before writing
  `buildScene`/`update`.
- Confirm whether a seeded-RNG helper already exists under `lib/spacetype/`.
- The clean state must reproduce the reference's last image (centered,
  natural-width, tightly leaded white type on near-black).
