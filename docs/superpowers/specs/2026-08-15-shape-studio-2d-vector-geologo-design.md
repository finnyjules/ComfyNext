# Shape Studio → 2D-vector clone-and-arrange generator (Phase 2)

**Date:** 2026-08-15
**Status:** Approved, ready for implementation plan
**Predecessor:** Phase 1 (`2026-08-15-gem-look-to-3d-studio-design.md`) moved the gem look into 3D Studio, freeing the Shape node for this.

## Plain-language summary

Repurpose Sailor's **Shape Studio** node from a 3D faceted-gem generator into the
flat **2D-vector clone-and-arrange logo generator** inspired by
estudiokrill.com.ar/geologo. It takes one base vector shape, clones it many times,
arranges the clones (radial/grid/linear) with stepped transforms, composites the
overlaps with an **even-odd boolean fill** (the "genius" that makes negative-space
marks read as logos), optionally mirrors and clip-masks the result, and exports
**real SVG** (plus a rasterized PNG for the canvas cascade).

The 3D role is already covered by 3D Studio (Phase 1), so the 3D `lib/shapefx/`
engine is retired here. **Clean break:** old 3D-gem configs won't load; `mergeConfig`
degrades a stray blob to defaults rather than crashing.

Decisions locked with the user: **full geologo parity**, **full paint palette**
(solid/gradient/pattern fills), keep the **"Shape Studio"** node identity.

## Reuse map (why this is tractable)

| Building block | Source | Verdict |
|---|---|---|
| Even-odd/boolean compositing | paper.js (dep); `useVectorSvg.ts` `pathLayerBoolean` reads back `evenodd` | REUSE (factor the paper core out) |
| SVG serializer (even-odd, clip, gradients) | `lib/vector/svg.ts` `shapesToSVG(VectorShape[])` | REUSE — the export target |
| Per-clone affine | `lib/vector/svg.ts` `Transform2D` / `transformCommands` | REUSE |
| Base shapes (ngon/star/hexagon/rounded) | `lib/compositor/polygonGeometry.ts` | REUSE |
| Studio shell/panel/autosave/agent | `StudioModalShell`, `studio/StudioControlPanel`, `lib/studio/autosave.ts`, `useStudioAgent` | REUSE (Vector Type is the template) |
| Node + cascade baker | `ShapeStudioNode.vue`, `lib/studio/cascade.ts` | REUSE / adapt output |
| Clone/arrangement engine | — | BUILD-NEW |
| Irregular-shape jitter | — | BUILD-NEW |
| 3D engine/surface/geometry | `lib/shapefx/engine.ts`, `surface.ts`, Three parts of the surface | GUT / retire |

## Design

### A. Architecture

New `frontend/app/lib/geoshape/` module producing `VectorShape[]`. The
`shape-studio` node identity, persistence key `sailor_shapeStudio`, and
cascade-baker contract stay; only the engine behind them changes. Each pipeline
stage is its own file, testable in isolation:

1. **`shapes.ts`** — base path from `compositor/polygonGeometry.ts`
   (polygon/star/hexagon + corner rounding) plus a new irregular-jitter variant,
   emitted as `VectorCommand[]` (via the path `d` → commands route).
2. **`arrange.ts`** *(build-new)* — clone N times across **radial / grid / linear**
   layouts (radius/spacing), applying per-clone **transform ramps**
   (rotateBase+rotateStep, scaleStart→scaleEnd interpolation, skew, spin,
   angleStep) via `Transform2D` / `transformCommands`.
3. **`boolean.ts`** *(paper.js core, factored out of `useVectorSvg`)* — fold the
   clones with the `fillMode` op (`evenodd` / `unite` / `exclude` / `intersect` /
   `subtract`) into a composite path, reading back the winding rule. The geologo
   core. Follows the repo's paper-scope discipline (`sc.project.clear()` between
   operations).
4. **`symmetry.ts`** — mirror across an axis (with `symmetrySpacing`), re-composite.
5. **`clip.ts`** — arbitrary-shape clip done as a **paper `intersect`** with the
   clip shape (uniform across live preview and SVG; sidesteps `svg.ts`'s
   rect-only clipPath).
6. **`paint.ts`** — map the full `VectorPaint` palette (solid/gradient/pattern)
   onto the composite fill + stroke.
7. **`config.ts` / `controls.ts` / `randomize.ts` / `agentControls.ts`** — schema,
   defensive `mergeConfig`, re-roll with per-section locks, agent vocabulary
   (structure mirrored from `shapefx`, new 2D fields).
8. **`render.ts`** — orchestrates 1–6 → `VectorShape[]`, then either
   `shapesToSVG()` (export) or Path2D-to-canvas (preview/bake).

### B. Surface + node

- **`ShapeStudioSurface.vue`** — replace the Three viewport with a **live 2D
  `<canvas>`** (Path2D, even-odd fill) — genuinely live, since 2D is cheap (an
  upgrade over the old WebGL still-only preview). Keeps `StudioModalShell` +
  `StudioControlPanel` + `useStudioAutosave` + `useStudioAgent`.
- **`ShapeStudioNode.vue`** — `bakeOutput` rasterizes the 2D render → **PNG** for
  the canvas cascade (unchanged `StudioBaker = () => Promise<Blob|null>` contract);
  add a new **"Download SVG"** action via `shapesToSVG`. Card shows a 2D thumbnail.

### C. Full-parity control set

`shape` (polygon/star/hexagon/irregular) · `starInner` · `irregularSeed` · `size`
· `count` · `layout` (radial/grid/linear) · `radius` · `spacing` · `angleStep` ·
`rotateBase` / `rotateStep` · `scaleStart` / `scaleEnd` · `skew` · `spin` ·
`fillMode` (evenodd/unite/subtract/intersect/exclude) · `roundCorners` /
`roundRadius` · `symmetry` / `symmetryAxis` / `symmetrySpacing` · `clipMask` /
`clipMaskSize` · `invert` · `padding` · `strokeWidth` · `seed` · plus full paint
(fill `VectorPaint` + stroke).

### D. Testing (TDD, with real render-proof)

- **Unit:** shape-vertex determinism (seed → identical points); radial/grid/linear
  placement + ramp accumulation (rotateStep sums, scaleStart→End interpolates);
  **paper even-odd fold produces a real hole** (two overlapping squares → a shape
  with an interior hole, not a solid); symmetry produces mirrored bounds;
  clip-intersect removes geometry outside the clip; `mergeConfig` round-trips
  partial/junk blobs.
- **Render-proof (not "it didn't throw"):** `shapesToSVG` output contains
  `fill-rule="evenodd"` and the expected subpath count, AND the rasterized canvas
  is non-blank with detectable interior negative space (pixel check) — per Phase
  1's lesson that a render succeeding is not evidence it's correct.

### E. Risks / watch-items

- **paper.js scope discipline** — shared project scope; `clear()` between
  operations (the codebase already does this — follow it).
- **Retiring `lib/shapefx/`** — confirm no consumer beyond the
  node/surface/cascade/agent-tune before deleting engine files; keep the
  config/controls *structure* as a template. Note: a separate session may be
  touching `shapefx-post-adoption` tests — coordinate deletion.
- **Clean break** — the `sailor_shapeStudio` key gets a new schema; `mergeConfig`
  defaults everything so a stray old 3D blob degrades gracefully.
- **Clip via paper intersect** (not `svg.ts` clipPath) — a deliberate call so the
  clip works identically in the live canvas and the SVG export.
- **Live 2D preview** (vs the old still) — a deliberate upgrade enabled by 2D
  being cheap to render every frame.
