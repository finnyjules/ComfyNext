# Echo — Type Studio Effect (Design)

**Date:** 2026-06-18
**Status:** Approved design, pre-implementation
**Area:** `frontend/app/lib/spacetype/` (Type Studio)

## Summary

A new Type Studio effect (`id: 'echo'`) that takes a single text string and duplicates it into a configurable stack of copies ("echoes"). The base copy can stay static while the duplicates animate. The defining mechanic is **occlusion stacking** — each echo is a layer with its own bounding-box "card" that piles up in a z-order and covers the layers behind it, like a pile of papers. The sliced/banded look in the reference (e.g. "THE 1795") emerges naturally from small offsets between opaque cards: you only see the sliver of each lower sheet that the sheet on top doesn't cover.

It is a standard `SpaceTypeEffect` module (Three.js, like Cascade/Melt), so it inherits the existing live preview and image/video export pipelines. **No backend changes.**

## Goals

- Duplicate one string into N copies with full control over count, spread, and depth.
- Reproduce the reference poster look (solid base → progressively occluded/faded copies) out of the box.
- Let the base stay static while copies drift/animate.
- Per-copy look driven by a base→end interpolation ramp (not manual per-copy editing in v1).

## Non-Goals (deferred)

- Per-echo manual styling (a layers-style list with independent rows).
- Motion modes beyond drift (wave/sway, pulse/ripple).
- Stripe/blind procedural masks; image or gradient mask sources.
- Free per-echo overrides on top of the ramp.

## The Model — Four Systems

### A. Duplication & Spread

- `count` — number of echoes (slider).
- `offsetX`, `offsetY`, `offsetZ` — per-step offset vector applied cumulatively per copy. Separate axes cover any direction including diagonals; Z drives depth.
- `perspective` — camera/projection depth so Z-offset copies converge and recede.
- `layout` (select) — composable spread behaviors:
  - **Directional** — copies fan out one way from the base.
  - **Bidirectional** — copies spread both ways from a centered base (mirror the offset vector ±).
  - **Mirror** — the opposite-side copies are flipped (reflected) across the spread axis, not just shifted.
- `spacingCurve` — single slider, ease-in ↔ linear ↔ ease-out, controlling how the gap between successive copies grows or shrinks down the stack.

### B. Occlusion — "Pile of Papers" (the real masking)

- Each echo is a layer with a **resizable bounding-box card**: `cardPadX`, `cardPadY` pad the card around the text so sliver height is not locked to the glyph.
- Card is **opaque by default** — it occludes the layers behind it within its box. `cardOpacity` lets lower layers glow through when reduced.
- `cardColor` — the card fill, defaulting to the canvas background color. A bg-colored opaque card is what produces the reference's peeking-sliver bands.
- `zOrder` (select) — which end sits in front: **base in front** or **last echo in front**.
- Implemented with real Three.js depth / render-order so stacking is true 3D, consistent with the perspective/Z controls — not a 2D painter hack bolted on.

### C. Look — Base → End Ramp

- The user styles two endpoints: the **base** and the **furthest echo**. Every property interpolates across the stack by copy index:
  - text/fill color, fill type (reuses the existing `fillList` control), opacity, stroke width, stroke color, scale, rotation, card opacity.
- `lookCurve` — controls how fast the ramp progresses across copies (e.g. keep several copies near-solid, then fall off), independent from `spacingCurve`.

### D. Motion — Drift Only

- `driftSpeed` — copies travel along the offset axis over the loop and wrap seamlessly for clean video. Speed `0` = static still.
- `driftAmount` — magnitude of the per-loop travel.
- Base remains static; only the duplicated copies move.

## Architecture

- **New module:** `frontend/app/lib/spacetype/effects/echo.ts`, exporting `echoEffect: SpaceTypeEffect` with `id`, `label`, `controls`, `buildScene()`, `update()`.
- **`buildScene(three, params, textTexture, env)`** — builds N textured plane "cards" inside a `THREE.Group`:
  - position each card by the cumulative, `spacingCurve`-eased offset vector (with layout mode applied: directional / bidirectional / mirror);
  - style each card by the `lookCurve`-driven ramp between base and end endpoints (color/fill/opacity/stroke/scale/rotation/card opacity);
  - give each card an opaque background quad (or background-filled material) and a `renderOrder`/depth derived from `zOrder` so occlusion is correct;
  - return the root `Group`.
- **`update(t01, params)`** — advances the drift offset and wraps it; applies only transform/uniform updates per frame. No scene rebuild during animation.
- **Registration:** add `echoEffect` to `SPACE_TYPE_EFFECTS` in `frontend/app/lib/spacetype/effects/index.ts`.
- **Controls UI:** auto-rendered by `SpaceTypeSurface.vue` from the `controls` spec using existing control kinds (`slider`, `select`, `color`, `fillList`, `switch`, `text`), grouped into panels: **Type / Stack / Occlusion / Look / Motion**.

### Rebuild vs. Update

Structural params (count, layout, padding, fills, look endpoints) trigger `rebuild()` via the Surface's existing watch. Continuous params consumed in `update()` (drift) animate without rebuild. Follow the existing effects' split for which keys rebuild vs. update.

## Reuse & Seams

- **Text rasterization:** existing `textTexture.ts`.
- **Fills:** existing `fills.ts` / `fillList` control for textured fills on the ramp endpoints.
- **Export:** existing image path (`engine.renderFrame` → `frameToBlob` → `uploadFrameBatch`) and video path (`bake.ts` → `/comfynext/spacetype_encode`).
- New code is confined to `echo.ts` plus a single registry line.

## Error / Edge Handling

- Clamp `count` to a sane max to bound mesh creation; degrade gracefully at `count = 1` (just the base).
- Guard divide-by-zero in ramp/spacing interpolation when `count = 1`.
- Ensure drift wrapping is seamless at loop boundary (no visible jump in baked video).
- Opaque cards must match the canvas background by default so the effect reads correctly on first open.

## Verification

- Per project rule [[feedback_verify_visuals_with_screenshots]]: do **not** ship on unit tests alone. Iterate in the live Type Studio preview and compare against the user's reference; get look sign-off via screenshots before calling it done.
- A small unit check on the pure math is appropriate: cumulative offset, `spacingCurve` easing, and the base→end ramp interpolation.

## Open Questions

None blocking. Per-echo overrides, additional motion modes, and alternative mask sources are explicitly deferred to a later iteration.
