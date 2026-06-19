# Gradient Studio — "Stack" layout (rotated gradient circles)

**Date:** 2026-06-18
**Branch:** `feat/gradient-3d-relief` (worktree)
**Status:** Approved — implementing

## Goal

Reproduce the reference ripple-disc via its real construction: a **stack of concentric
circles of decreasing radius, each filled with the same linear gradient rotated a step
further per ring**. The rotating gradient across the overlapping rings fakes the 3D ripple
and the off-center spiral core. Prototype confirmed the look (2D-canvas).

Ships as a **new `stack` layout** alongside linear/radial/orbit. The existing orbit/relief
effect is untouched.

## Construction (validated by prototype)

- N circles, radius `r_i = maxR · (1 − f·0.92)` where `f = i/(N−1)` (i=0 largest).
- Each circle filled with the color ramp as a linear gradient along its local vertical,
  rotated by `ang_i = i · rotStep`.
- Circle center orbits the pivot: `c_i = (cos·ang, sin·ang) · pivot · maxR · f` (pivot 0 =
  concentric; >0 = off-center spiral pinch).
- Visible pixel color = the **smallest** circle containing it (drawn last/on top).

## Design

Per-pixel in the existing single fragment shader (no new render path).

- **types.ts:** add `'stack'` to `LayoutKind` + `LAYOUTS`. Add optional `rotStep` (deg/ring)
  and `pivot` (0–1) to `ShapeConfig`; reuse `shape.count` as the ring count. Optional →
  back-compat. Defaults applied in `ensureConfigDefaults`/builders.
- **shaders.ts:** at the top of `computeLayer`, a `stack` branch — bounded loop (≤40) over
  rings small→large, containment test per pivot-orbited circle, sample the ramp rotated by
  the ring angle for the first (smallest) hit; outside all → background. New uniforms
  `u_rotStep` (radians), `u_pivot`. Reuses `u_count`, `u_aspect`, `u_margin`, the ramp.
- **renderer.ts:** upload `u_rotStep` (deg→rad) and `u_pivot`; `LAYOUT_IDX.stack = 3`.
- **Surface.vue:** when layout = Stack, show **Ring count** (`count`), **Rotation / ring**,
  **Pivot**, plus the existing **Color stops** (the gradient); hide bands/wave shape controls.
- **randomize.ts:** `stackConfig()` preset (low rotStep + slight pivot + spectrum ramp, near
  the reference); `buildConfig`/`reroll` may pick `stack` and seed its params.

## Scope (YAGNI)

- Ring shrink factor fixed at 0.92; gradient base direction fixed to local-vertical (rotation
  is the variable). No per-ring color, no falloff control in v1.
- Single primary layer drives the stack (layer 0); a 2nd layer composites as today.

## Testing

- WebGL harness (esbuild + Playwright): render the stack preset — assert a non-black disc
  with ring structure (lum variance), no GLSL errors; visual sign-off vs the reference.
- Vitest: `stackConfig` shape + new-field defaulting/back-compat.
