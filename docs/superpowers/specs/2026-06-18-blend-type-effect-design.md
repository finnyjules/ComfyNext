# Blend — Space Type effect (design)

**Date:** 2026-06-18
**Status:** Approved, ready for implementation
**Home:** Space Type / Type Studio suite (`frontend/app/lib/spacetype/effects/`), NOT the shaderfx catalog.

## Overview

A new `SpaceTypeEffect` that takes a word/glyph and replicates it into **N echoes**, each
stepped through a cumulative 3D transform and colored from a gradient — the "Illustrator blend
tool meets 3D rotation" light-trail look (reference: a number "6" drawn as many rotated,
color-swept concentric outlines on black).

Distinct from `onionburst` (which maps each *character* onto its own spinning tube). Here a
single word is *blended* into rotated, color-cycled copies of itself.

## Why Space Type, not shaderfx

- Real 3D glyph geometry with true perspective rotation (`InstancedMesh` + per-instance
  `setMatrixAt`), vs a faked 2D image re-projection.
- The seam exposes real `color`/`fillList` controls + gradient-lerp helpers, so "each step a
  different color" is a clean gradient across the fills list (no RGB-slider workaround that
  shaderfx's float-only params would force).
- Additive **and** Over compositing come free from Three.js material blending; `update(t01)`
  gives seamless animation + video bake on the existing motion-bake rails.

## Architecture

New module `app/lib/spacetype/effects/blend.ts` implementing `SpaceTypeEffect`
(`id`, `label`, `controls`, `buildScene`, `update`), registered in `effects/index.ts`'s
`SPACE_TYPE_EFFECTS` array. **No engine or surface changes** — the surface auto-builds the UI
from `controls`, and the engine applies the standard `scale` + scene `rotateX/Y/Z` + background
generically (engine.ts:171-180).

### buildScene(three, params, _textTexture, env)

1. Build the glyph texture with `layoutChars` (own texture, like Cascade — the shared
   `textTexture` is ignored). For **Outline** style, render the glyph as a stroke with a
   transparent fill (`strokeColor` set, fill alpha 0, `strokeWidth` from the control); for
   **Solid**, render the filled glyph. One texture for the whole first line of `text`.
2. Create ONE `InstancedMesh` of N quad planes (`PlaneGeometry(1,1)` with the glyph texture
   mapped, `MeshBasicMaterial({ map, transparent: true, alphaTest, side: DoubleSide, depthWrite:
   false, blending }))`). `blending` = `AdditiveBlending` (Additive mode) or `NormalBlending`
   (Over mode).
3. For each instance `i ∈ [0, N)`:
   - **Transform:** start from identity and apply the *cumulative* per-step deltas ×`i`:
     rotate X/Y/Z per step, scale per step (multiplicative, nests in/out), spread X/Y per step
     (additive position drift). Compose into the instance matrix via `setMatrixAt`.
   - **Color:** `setColorAt(i, colorAt(i))` where `colorAt` lerps across the parsed fills'
     primaries at `i/(N-1)` when "gradient across steps" is on, else cycles the fills by slot
     (reuse Cascade's `lerpColors` / slot pattern).
4. Wrap in a `subGroup` scaled to world units; return the root. Stash state (mesh, N, parsed
   deltas) on a module-scoped `state` for `update`.

### update(t01, params)

- Static by default. An optional **Spin** control (integer cycles per loop, like onionburst)
  rotates the whole instanced stack about a chosen axis by `t01 * spin * 2π` — seamless at loop
  ends so the video bake is clean. When `spin = 0`, `update` is a no-op after the initial build.
- Recompose instance matrices only if `spin > 0` (cheap; N matrices).

## Controls

| Group | Controls |
|---|---|
| Type | `text` (text), `font` (font), `typeWeight` (slider 100–900), `tracking` (slider) |
| Blend | `steps` (slider 2–80, default 40), `rotStepX/Y/Z` (slider, radians per step, small range e.g. −0.4..0.4), `scaleStep` (slider 0.8–1.2, default 0.985), `spreadX`/`spreadY` (slider, default 0) |
| Style | `style` (select Outline/Solid, default Outline), `strokeWidth` (slider, outline thickness), `blendMode` (select Additive/Over, default Additive) |
| Color | `fills` (fillList, default a spectrum-on-dark recipe), `gradientMode` (select off/on, default on) |
| Transform | `scale` (slider), `rotateX/Y/Z` (slider) — applied by the engine |

Reference look ≈ high `steps` · `rotStep*` about a tilted axis winding ~1–2 turns total ·
`scaleStep` slightly <1 · Outline · Additive · spectrum gradient · dark background.

## Decisions / assumptions

- **Additive assumes a dark background** (the suite's background control); default fills are a
  spectrum tuned for dark.
- **Cumulative per-step deltas**, not an explicit start→end two-pose blend — simpler controls and
  it can wind past 360° for the vortex look. Switching to a two-pose model later is localized to
  the matrix-composition step.
- **Name "Blend"** (`id: 'blend'`, `label: 'Blend'`).

## Testing

- Unit tests (Vitest, like the other spacetype helpers) on the *pure* logic extracted into small
  functions: per-step cumulative matrix composition (e.g. a `stepTransform(i, params)` returning
  position/quat/scale), gradient `colorAt(i, N)` mapping, and `defaultsFromControls(controls)`.
- In-app visual + video-bake verification is the usual Space Type GPU-gated user check
  (consistent with the other effects' "in-app verify pending" status).

## Deferred (v2)

- Explicit two-pose (A→B) blend model with independent start/end transforms.
- Per-echo opacity falloff / trail fade.
- Depth-sorted Over mode (true back-to-front) if z-fighting shows up.
