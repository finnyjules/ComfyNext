# Gem Look → 3D Studio (Phase 1)

**Date:** 2026-08-15
**Status:** Approved, ready for implementation plan

## Plain-language summary

Sailor's **Shape Studio** is a 3D faceted-gem generator. Sailor's **3D Studio**
(`scene3d`) is a full 3D scene editor that already overlaps almost entirely with
it — same primitives, same faceted/prismatic shading, jitter, surface fills, and
even a clone/arrange modifier. The two tools are largely redundant.

The larger goal (a later phase) is to free up the "Shape" node and repurpose it
into a flat **2D-vector "clone-and-arrange" logo tool** (inspired by
estudiokrill.com.ar/geologo) that outputs real SVG — a capability Sailor does not
have today. Before we retire Shape Studio's 3D role, we must not lose its
distinctive **faceted-gem look**. This spec covers **Phase 1 only**: carry that
gem look + controls into 3D Studio.

The good news from the capability gap analysis: **3D Studio already has ~80% of
the gem look.** The prismatic/faceted/smooth "cut-gem" shading is already on the
GPU (literally named after Shape Studio in the code), and jitter, surface fills,
grain, and background are all present. Phase 1 is therefore **purely additive to
3D Studio** and does not touch Shape Studio at all.

## Scope

**In scope (this phase):**
1. **Gem primitive** — a randomized convex-hull "stone" primitive kind (core).
2. **Harmony palette** — auto-generate a harmonious color ramp from one
   hue/sat/light seed instead of hand-authoring stops (core).
3. **scatter coloring** — random discrete swatch per facet (extra).
4. **ombre coloring** — per-facet dithered gradient (extra).
5. **screen-space distortion** — final-image UV-warp, added to the shared post
   stack so all studios gain it (extra).

**Out of scope (explicitly deferred):**
- Randomize / re-roll with per-section locks (3D Studio has no seed/lock
  infrastructure; deferred by decision).
- Any change to Shape Studio (`shapefx`) — untouched until Phase 2.
- **Phase 2** itself: repurposing the Shape node into the 2D-vector geologo tool,
  and the clean-break removal of the 3D gem engine. Gets its own spec.

## Reference: the capability gap (why this scope)

| Area | Verdict |
|---|---|
| Gem convex-hull primitive | **PORT** — `gemPoints` + `ConvexGeometry` + `ensureUV` missing; flatten/normals/jitter already in scene3d |
| Prismatic/faceted/smooth cut-gem shading | **REUSE** — already GPU-implemented in scene3d |
| Harmony-driven palette | **PORT** — scene3d makes users hand-author stops |
| scatter coloring | **PORT** — no random per-facet swatch path |
| ombre coloring | **PORT** — scene3d grain is full-screen post, not a per-facet ramp dither |
| Surface fills onto mesh | **REUSE** — same `fillTile`/`paintTileBox` path already renders all fill types onto UVs |
| Screen-space distortion | **PORT** — scene3d has geometry twist/bend/noise but no screen-space UV warp |
| Background / grain / scale / projection | **REUSE** — existing scene3d homes |
| Config/control declaration slots | **REUSE** — clean extension points exist |

## Design

### A. Architecture

3D Studio (`frontend/app/lib/scene3d/`) has clean extension slots; the port adds
one primitive kind and extends the existing material-coloring and shared-post
systems. No architectural change.

- **New file** `frontend/app/lib/scene3d/gem.ts` — self-contained hull builder
  (port of `shapefx`'s `gemPoints` + `ConvexGeometry` + `ensureUV`). We
  **duplicate rather than import from `shapefx`** on purpose: Phase 2 retires
  `shapefx`, so a dependency on it would be a landmine. The seeded RNG uses
  scene3d's existing RNG utility (or a small local port if none is shared).
- All other work is edits to existing scene3d files.

### B. Gem primitive (core)

- Add `'gem'` to `PrimitiveKind` (`config.ts:23`) and **append** to
  `PRIMITIVE_KINDS` (`config.ts:348`) — honoring its "append, never reorder"
  drift test.
- `geometryFor()` (`engine.ts:83`) gains a `case 'gem'` that calls `gem.ts`:
  seeded point cloud → `ConvexGeometry` → planar UV backfill, with a
  `TetrahedronGeometry` degenerate fallback when points are collinear/coincident.
- `PRIMITIVE_PARAMS['gem']` (`primParams.ts:47`): `points` (facet density),
  `spread`, `depth`, plus the object seed. The existing **facet flatten, jitter
  modifier, and prismatic shading apply on top for free**, so a fresh gem
  immediately reads as a cut stone.
- Add gem to the primitive picker menu (`primGroups.ts`) with an icon.

### C. Harmony palette (core)

3D Studio samples a ramp LUT built from `gradientStops`. Add a *source* switch,
reusing the entire existing ramp/shading GPU path:

- New `SceneMaterial` fields: `paletteMode: 'manual' | 'harmony'` +
  `paletteHue / paletteSat / paletteLight / paletteHarmony` (harmony scheme from
  `frontend/app/lib/color/harmony.ts`).
- `gradientStopsOf()` (`config.ts:490`) forks: harmony mode → `harmonize()` +
  `toStops()`; else the existing manual stops. The GPU ramp code is untouched —
  only the *source* of stops changes.

### D. scatter + ombre coloring (extras)

Both slot into the exact place `prismatic` already lives — the facet material
program (`materials.ts:463–467`). Extend the `gradientShading` union with
`'scatter'` and `'ombre'` and add two `uMode` branches:

- **scatter** (`uMode=3`): per-face seeded random attribute → sample ramp at a
  quantized random `t` (discrete confetti swatches).
- **ombre** (`uMode=4`): sample ramp with an ordered dither → Shape's stippled
  gradient look.

Both reuse the existing ramp texture and per-face attributes — just new shader
branches plus two enum values on the existing segmented control.

### E. Screen-space distortion (extra)

Added as a **new effect in the shared post manifest** (`studio/post/manifest.ts`
+ `studio/post/threePasses.ts`), **not** a scene3d-local pass — a two-noise-field
UV warp (port of `shapefx`'s `POST_FRAG`). Because it lives in the shared stack,
Gradient/Texture/Shape studios gain it too. No-op by default (renders as a copy).

### F. Config round-trip

New gem params, palette fields, and the two new `gradientShading` enum values all
get added to the scene3d sanitizers/mergers (`sanitizeParams`, material sanitize)
so saved scenes round-trip. The `PRIMITIVE_KINDS` drift test stays green because
`'gem'` is appended.

### G. Testing (TDD)

- **Unit:** `gemPoints` determinism (seed → identical hull); `ConvexGeometry`
  non-degenerate + fallback triggers on collinear points; `ensureUV` covers all
  verts; harmony-stops generation is monotonic dark→light for a seed; sanitizers
  round-trip every new field; `PRIMITIVE_KINDS` drift test passes; the
  `gradientShading` union/sanitizer accepts `scatter`/`ombre`.
- **Render proof (not synthetic):** in the dev harness, add a gem, render, and
  assert real signal — geometry vertex count above the fallback floor + non-zero
  bounds; for coloring modes, sample rendered pixels and assert facet-to-facet
  variance (guards against the "flat wash passes the parity test" trap seen in
  past bugs). Capture a screenshot for visual review.

### H. Risks / watch-items

- **Distortion home:** implemented as a shared-post effect, so it touches the
  shared manifest that other studios consume — verify no-op default renders as a
  clean copy in every studio, not just 3D.
- **UV backfill on hulls:** convex hulls ship no UVs; `ensureUV` planar backfill
  is required for surface fills to map. Test UV coverage explicitly.
- **Shader modes can't be unit-tested meaningfully** — pair any coloring change
  with a real render + pixel-variance assertion, per prior "parity tests agree on
  a wrong answer" lessons.
