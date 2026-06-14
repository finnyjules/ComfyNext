# Space Type: Ribbon v2 (STG-faithful snaking ribbon)

**Date:** 2026-06-14
**Status:** Approved direction, pending spec review
**Builds on:** docs/superpowers/specs/2026-06-13-space-type-ribbon-design.md
(the engine, `SpaceTypeEffect` seam, deterministic bake, and timeline/export
pipeline are unchanged and reused.)

## Why

v1 shipped a *stacked parallel rows* interpretation of STG's ribbon. Reading the
live `spacetypegenerator.com/ribbon` panel showed the real model is different: a
**single (or few) ribbon(s) snaking through space** along an S-curve, **two-sided**
(a gradient/text front face, a solid-color back face revealed as it folds), with a
much richer control set. This spec rebuilds `effects/ribbon.ts` to match that look
and brings STG's controls across. The Space Type *engine, effect seam, bake, and
export path do not change* — only the ribbon effect's geometry/material and a small
set of engine/surface additions.

## Principle

**The effect owns the geometry; the suite owns everything else.** Ribbon v2 is a
drop-in replacement implementing the same `SpaceTypeEffect` interface
(`buildScene` / `update(t01)` / `controls`). The deterministic frame-index render,
seamless-loop guarantee, alpha, `motion_bake` export, and timeline integration all
keep working because the contract is unchanged.

## The model

### Geometry — a swept snaking ribbon

Replace the N flat stacked planes with a **strip swept along a parametric path**,
generated into a `THREE.BufferGeometry`:

- Sample `segments+1` points along `t ∈ [0,1]`. Centerline:
  `P(t) = ( (t-0.5)·L , A·sin(2π·F·t + φ) , 0 )`
  where `L` = ribbon length (Stretch), `A` = snake amplitude, `F` = snake frequency
  (Segment Count drives `F`/sample density; Segment Space drives spacing).
- At each sample, emit two vertices offset by `±Height/2` along the band's "across"
  vector (perpendicular to the path tangent, in the view plane), forming a band of
  width `Ribbon Height`.
- UVs: `u = t · uRepeat` (text + gradient flow along the length), `v = 0..1` across
  the height.
- Triangle-strip indices. Consistent winding so `gl_FrontFacing` separates the two
  faces.
- `Ribbon Count > 1`: build `count` such ribbons, each offset in depth/Y by
  `Ribbon Spacing` and phase-shifted by `Ribbon Offset`; `Alternate` flips the
  snake direction (`φ → φ+π` / negated amplitude) on every other ribbon.

The geometry generator is a **pure function** (`buildRibbonGeometryData(params) →
{ positions, uvs, indices }`) so it is unit-testable (vertex/index counts, UV
range, symmetry) without WebGL.

### Material — two-sided via the shader

One `MeshBasicMaterial` per ribbon with `side: DoubleSide` and an `onBeforeCompile`
injection:
- **Front face** (`gl_FrontFacing == true`): sample the text texture, multiply by
  the gradient ramp (A-side).
- **Back face**: output the solid **B-Side** color.
- The per-vertex wave from v1 is dropped — the snaking path now provides the form;
  motion is the text scrolling along `U` plus an optional animated snake phase.

### Gradient

Build a 1×N **gradient ramp texture** from the enabled A-side color stops
(blue→red→yellow… as in STG), sampled by `U` along the ribbon length. `Gradient
Mode` off ⇒ flat A-side color. Stops are on/off toggles + colors (start with up to
4 stops). `No stripes` toggles the alternating dark banding STG applies between
text rows (v2: a simple on/off; full stripe styling can follow).

### Text texture

Reuse `textTexture.ts`, extended to honor: **Font** (family + variable-font axes
from the curated `VARIABLE_FONTS` catalog), **Type Height** (font size), **Tracking**
(`ctx.letterSpacing`), and **Type Stroke** (outline via `ctx.strokeText`). The
chosen font's CSS is loaded (inject `cssUrl` link + `document.fonts.load(...)`)
before building the texture and before any bake, mirroring the existing motion-bake
font-readiness step.

### Camera & scale (engine additions)

Generalize the single `cameraTilt` into **Rotate X / Y / Z** (applied as scene or
camera Euler rotation each frame) plus **Scale** (camera dolly / root scale = zoom).
These are read from `params` in `renderFrame`, so they stay per-effect controls and
remain deterministic.

## Controls (STG → ours)

The surface auto-builds these from `ribbonEffect.controls` (plus a new `font`
select kind):

- **Type:** `text`, `font` (select from catalog), `typeHeight`, `tracking`, `typeStroke`
- **Ribbon:** `ribbonHeight`, `ribbonStretch`, `ribbonCount`, `ribbonSpacing`, `ribbonOffset`, `alternate`, `scale`
- **Snake:** `segmentCount`, `segmentSpace` (drive `F`/sample density + amplitude)
- **Motion:** `speed`
- **Camera:** `rotateX`, `rotateY`, `rotateZ`
- **Color:** `gradientMode`, gradient stops (`stop1..4` colors + on/off), `bSideColor` (B-Side/Text), `bgColor` (Background), `noStripes`

A new `ControlSpec` kind `font` (a labeled select over `VARIABLE_FONTS`) is added so
the panel renders a font dropdown generically — future effects get it free.

## Determinism & seamless loop (unchanged guarantees)

`update(t01)` stays pure in `t01`. The text scroll and any animated snake phase
advance by **integer cycles** over the loop, so frame 0 and the loop boundary match
— the same seamless guarantee v1 proved. The geometry is static per `build`; only
texture offset / phase animate. The bake remains frame-index-driven and cache-keyed
(`spaceTypeSourceKey` already hashes all params).

## Scope

**In:** the snaking two-sided gradient geometry, the full control set above, font
picker + axes + tracking + type height + stroke, camera X/Y/Z + scale, gradient
ramp, `motion_bake` export (unchanged).

**Out (deliberate follow-ups):** STG's 12 named **presets** (trivial once the param
set is stable — add as a preset list applying param snapshots); advanced stripe
styling beyond on/off; the timeline scrub-preview-shows-baked-frames item already
tracked separately.

## Non-goals

- No change to the engine's deterministic bake, `SpaceTypeEffect` interface shape
  (still `id/label/controls/buildScene/update`), `sourceKey`, `bake.ts`, or the
  `default.vue` timeline/poster wiring.
- No new ComfyUI/Python changes.
- No new 3D dependency (Three.js already present).
