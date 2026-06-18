# Gradient Studio — 3D Relief & Off-Center Core

**Date:** 2026-06-17
**Branch:** `feat/gradient-3d-relief` (worktree off `origin/main`)
**Status:** Approved — implementing

## Goal

Let Gradient Studio reproduce the "3D embossed concentric ripple" look (reference:
rainbow orbit disc whose rings read as raised, directionally-lit ridges, rippling out
from an off-center core). Three capabilities, all building on the existing orbit/radial
layout in `frontend/app/lib/gradientfx/`.

## Capabilities

1. **3D embossed relief.** Replace the current cosmetic `relief` (a global vertical
   sine, `shaders.ts:252`) with real directional lighting of the ring height-field.
2. **Off-center core.** A `canvas.center` offset so radial/orbit rings ripple out from
   a movable point, producing the "pinch" nub.
3. **Rainbow-ripple preset.** One-click config that reproduces the reference.

## Design

Data flow is unchanged: `GradientConfig` → `renderer.ts` → one fragment shader.

### Types (`types.ts`)
- `ReliefConfig.light?: { azimuth: number; elevation: number }` (degrees) — light
  direction. Optional for back-compat with persisted configs.
- `CanvasConfig.center?: { x: number; y: number }` (each −0.5…0.5) — orbit/radial origin
  offset. Optional for back-compat.
- `DEFAULT_LIGHT = { azimuth: 135, elevation: 45 }`, `DEFAULT_CENTER = { x: 0, y: 0 }`.
- Pure helpers (unit-tested): `lightVector(az, el)` → normalized `[x,y,z]`;
  `reliefLight(relief)` / `canvasCenter(canvas)` (defaulted accessors);
  `ensureConfigDefaults(cfg)` (backfills the optional fields in place).

### Shader (`shaders.ts`)
- New uniforms: `vec3 u_light` (normalized direction), `vec2 u_center`.
- New `float bandHeight(int i, vec2 q)`: reruns the linear/polar mapping at an arbitrary
  screen point and returns the ring **height** — a rounded ridge per band
  (`sin(bl·π)` shaped by `rounding`, scaled by the band's field depth), 0 outside the
  mask. Radial/orbit subtract `u_center` before the transform.
- `main()` replaces the fake sine relief with **finite-difference emboss**: sample
  `bandHeight(0, …)` at the pixel and ±ε in x/y → surface normal → Lambert shade against
  `u_light` → `col *= mix(1, shade, u_relief)`. Driven by layer 0 (primary structure).
  Finite differences (not `dFdx`) because the mask early-`return`s make hardware
  derivatives undefined.
- `sampleField`/`sampleRamp` switch to `textureLod(…, 0.0)` (well-defined in the new
  non-trivial call sites; textures are mip-less so the result is identical).

### Renderer (`renderer.ts`)
- Upload `u_light` (from `lightVector(reliefLight(c.relief))`) and `u_center`
  (`canvasCenter(c.canvas)`), defaulting when the config omits them — no migration script.

### UI (`GradientStudioSurface.vue`)
- Canvas section: **Center X / Center Y** sliders (radial/orbit only).
- Relief section: **Light azimuth / elevation** sliders.
- A **"Rainbow ripple" preset** button (applies the reference config).
- `loadConfig` calls `ensureConfigDefaults` so legacy node blobs get the new fields.

### Randomize (`randomize.ts`)
- `rippleConfig(seed)` — the preset builder (orbit, spectrum stops, relief+light tuned
  to the reference).
- `defaultConfig`/`buildConfig` include `center` + `light`; full re-rolls vary
  center/light/relief on orbit. Add a `spectrum` palette scheme.

## Scope boundaries (YAGNI)
- Relief driven by **layer 0** only (not a 2-layer blend).
- **Center is static** in v1 (animating it would mean extending the shape-only motion
  system — deferred).
- No new shape type; rings reuse the existing `bands` shape.

## Testing
- **Vitest (pure):** `lightVector` math, `ensureConfigDefaults` backfill,
  `defaultConfig`/`buildConfig`/`rippleConfig` include + shape the new fields,
  `reroll` never leaves them undefined.
- **WebGL:** extend the existing esbuild + Playwright headless harness to render the
  orbit-emboss preset and assert it renders (non-black disc, no GLSL errors) and visually
  resembles the reference.
