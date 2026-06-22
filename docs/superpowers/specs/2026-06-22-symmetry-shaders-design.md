# Symmetry / Mirror / Clone Shaders — Design

**Date:** 2026-06-22
**Studio:** Shader Studio (reuses the `shaderfx` catalog: `shader_effects/*.frag` + `manifest.json`)

## Goal

Add a richer family of mirroring / cloning / kaleidoscope effects to the Shader
Studio. Packaged as **3 powerful multi-mode effects** (one `mode` enum each)
rather than many tiny entries. All animated with a `Speed` param (`Speed = 0`
gives a frozen still), all draggable-center (`centerParam`), all in the
`distortion` category alongside the existing `kaleidoscope` / `blinds`.

## Effects

### 1. `mirror` (NEW) — pure reflection symmetry
Reflection only (no polar log-zoom tiling), to stay visually distinct from
Kaleidoscope.

Modes (`u_mode` enum): **Axis** (single mirror line) · **Quad** (2-axis) ·
**Octal** (8-fold dihedral fold) · **Mirror-ball** (spherical reflection warp).

Params: `u_mode` (enum), `u_angle` (0–360°, mirror axis orientation),
`u_zoom`, `u_speed` (0 = still; rotates axis over time), `u_centerX`,
`u_centerY`.

### 2. `kaleidoscope` (REPLACE existing) — polar wedge + lattice symmetry
Mode 0 **Wedge** keeps the current shader math so the look is preserved and
browser/server parity holds. New modes stack on top.

Modes (`u_mode` enum): **Wedge** (current behavior, default) · **Nested**
(recursive double-fold) · **Wallpaper p4m** (square-lattice mirror tiling) ·
**Wallpaper p6m** (hex-lattice mirror tiling).

Params: `u_mode` (enum, default Wedge), `u_segments` (2–16), `u_rotation`
(0–360°), `u_zoom`, `u_speed` (0 = still; adds to rotation over time),
`u_centerX`, `u_centerY`. Existing params keep their names/defaults.

### 3. `droste` (NEW) — recursive clone / infinite zoom
Log-polar complex mapping. The structurally-different one, on its own.

Modes (`u_mode` enum): **Zoom** (image-in-image recursion) · **Spiral**
(Escher Droste twist) · **Tunnel** (concentric mirror tunnel).

Params: `u_mode` (enum), `u_scale` (size ratio between recursion levels),
`u_twist` (spiral strength), `u_speed` (0 = still; infinite-zoom drift),
`u_zoom`, `u_centerX`, `u_centerY`.

## Architecture / conventions

- Each effect: one `shader_effects/<id>.frag` (GLSL ES 3.00) + one entry in
  `shader_effects/manifest.json`. Single pass each (`passes: 1`).
- Standard header/uniforms: `u_image0`, `u_resolution`, `u_time`, `u_seed`,
  `v_texCoord` in [0,1], `fragColor0` out. Aspect-correct via
  `vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0)`.
- Mode dispatch via `int m = int(u_mode + 0.5)` branching.
- Wrap/fold sampling with `abs(fract(uv*0.5)*2.0 - 1.0)` (triangle mirror, no
  seam) — same trick the current kaleidoscope uses.
- `u_mode` is an `enum` param (a plain float uniform under the hood), resolved
  by the existing `resolveUniforms` / `resolve_params`.

## Testing

1. **Golden parity** — regenerate server-side goldens via
   `.venv/bin/python tests-unit/shaderfx_golden/generate_goldens.py` (renders
   each catalog effect with default params at `u_time=0.7`, `u_seed=42`), then
   run the Playwright parity test `frontend/tests/shaderfx-golden.spec.ts`
   (browser WebGL vs server golden, tolerance: max diff 8/255, mean ≤2.5/255).
   New effects must hold parity at their **default** params.
2. **Unit** — params resolve/clamp/serialize tests still pass
   (`shaderfx-params.unit.spec.ts`).
3. **Visual sign-off (required)** — per standing rule, never ship a visual/WebGL
   effect on unit tests alone. Render every mode of each new effect via the
   `shaderfx-harness` page and capture Playwright screenshots; get user look
   sign-off before declaring done.

## Risks / notes

- Goldens are GPU-calibrated; regenerate on the machine that runs the tests
  (this machine).
- Mode-dispatch branches with heavy `texture()` calls must keep each branch's
  default-param output within browser/server parity tolerance — keep math
  GPU-portable (avoid divergent precision tricks).
- Replacing `kaleidoscope` changes `animated: false → true` and adds params;
  default Wedge output stays equivalent so the catalog/preset wiring is safe.
