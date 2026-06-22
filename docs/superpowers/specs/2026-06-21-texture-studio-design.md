# Texture Studio — Design

**Date:** 2026-06-21
**Status:** Approved (design); implementation plan pending

## Summary

A new **Texture Studio** that generates interesting, geometric *or* illustrative, **perfectly tileable** textures. It sits alongside the existing Gradient / Shader / Type studios and reuses their chrome, control primitives, and bake rails. The studio's defining idea is a **3-stage tiling pipeline** — Lattice → Cell content → Stylize — that always emits one seamless tile plus a live "repeat" preview, then feeds the output into the compositor, layer/Space-Type fills, the Assets panel, generation inputs, and downloadable PNG / SVG / video.

The output serves four jobs (all confirmed in scope): backgrounds & surfaces, pattern fills for other studios, standalone exportable assets, and AI generation input.

## Goals

- One reusable, perfectly-seamless tile asset that flows into existing rails.
- Cover six texture families: geometric/hard-edge, organic noise, halftone/dot-line, lattice/motif repeat, terrazzo/scatter, illustrative/hand-drawn.
- **Truchet as a first-class, deep mode** (the user's primary interest).
- Three content origins: procedural, imported raster asset, in-studio prompt generation.
- Tileability is the architecture, not a bolt-on — visibly verifiable in-preview before export.

## Non-goals (v1)

- **Aperiodic tilings** (Penrose / "hat" einstein tile) — deferred to a future flavor; they break the single-tile export model and need a different math core.
- Rebuilding generation infrastructure — in-studio generation and imported assets both reuse existing ComfyNext generation/asset rails.
- No new studio infrastructure: modal shell, control primitives, node card, bake/upload, persistence are all reused.

## Architecture

A new `textureFx` WebGL2 renderer handles Stages 1–2, then pipes the result through the **existing shaderFx multi-pass compositor** for Stage 3. Raster content is sampled as a texture inside the shader. The tiling core is built on a **wallpaper symmetry-group foundation** (translation + mirror/rotation/glide), exposed through friendly presets rather than a raw 17-way menu. A **time uniform is wired in from the start** so animated seamless loops are cheap to add.

```
CONTENT (procedural · Truchet · raster import/generate)
        │
   Stage 1  LATTICE   — symmetry-group core, friendly presets, scale/rotation/offset/jitter, seed
        │
   Stage 2  CELL FILL — Truchet tile-set OR procedural motif OR edge-wrapped raster
        │
   Stage 3  STYLIZE   — reuses shaderFx passes: dither (12 patterns) · halftone · posterize · duotone/palette · grain
        ▼
   SEAMLESS TILE  +  live 1×/2×/3× repeat preview (with "highlight seams")
        ▼
   → Compositor/Frame bg · Space-Type & layer fills · Assets · Generation input · ⬇ PNG / SVG / Video
```

### Stage 1 — Lattice

- **Symmetry presets:** Hex · Square · Brick (half-drop) · Diamond · Mirror (kaleidoscopic), implemented on a symmetry-group core so richer groups (p4m, p6m…) are reachable later without rework.
- Scale, rotation, row/column offset, jitter, per-cell randomness driven by a **seed** (with 🎲 Roll, mirroring Gradient Studio's seeded randomize).
- Seamless by construction: the shader domain wraps via `mod()`.

### Stage 2 — Cell content

Mode picker; controls reveal contextually per mode.

**Truchet mode (first-class):**
- **Tile family:** Arcs (Smith) · Diagonal two-tone · Multi-scale arcs (Carlson) · Woven bands. Switching family swaps tile geometry only.
- **Rotation states:** which of 0/90/180/270 are allowed, with per-state probability weights.
- **Placement:** Random *or* **WFC** (Wave Function Collapse) — WFC places tiles under adjacency constraints for coherent, structured-but-organic fields.
- **Seed** + Roll.
- **Line weight / motif scale** within the cell.
- **Multi-scale depth & subdivide-probability** — shown only for the Carlson family.
- **Color rule:** strokes/fills draw from a 1–4 color palette, per-state or per-tile; feeds Stage-3 duotone/palette.
- **Connectivity bias** *(optional; arcs/maze)* — nudges toward longer connected runs vs. tight loops.
- Tileability is free: the tile-set is designed so any tile abuts any neighbor, so the field wraps for any seed.

**Procedural motifs:** shapes, dots/lines, noise fields — parametric, seamless by construction.

**Raster:** imported asset (incl. anything generated elsewhere in ComfyNext) *or* in-studio prompt generation; placed/scattered in cells, edge-wrapped (see seamless tiers).

### Stage 3 — Stylize

Reuses the existing shaderFx passes: dither (the 12 patterns — Bayer/clustered/line/white/blue/R2…), halftone, posterize, duotone / palette map, grain, contrast.

### Seamless guarantee (three tiers by content type)

1. **Procedural / Truchet / lattice** → seamless *by construction* (domain wraps with `mod()`); nothing to fix.
2. **Imported / generated raster** → cheap, deterministic: **offset-wrap** (half-tile shift to expose the seam) + **edge feather/mirror** blend, with a "seam nudge" control.
3. **Raster, painterly fidelity** → **AI-seamless** toggle: round-trips the tile through a tiling-aware generation pass so organic art (e.g., dithered-flowers motif) wraps with no blend smear. Offered as a clean first-class toggle (cost is not a constraint for this studio).

Every preview includes a **1×/2×/3× repeat view** with a **"Highlight seams"** toggle, so tileability is visible before export.

## UI / studio chrome

Reuses `StudioModalShell`, `StudioSection`, and control primitives (`StudioSlider`, `StudioColor`, `StudioSelect`, `StudioSegmented`, `StudioSwitch`, `StudioButton`).

- **Left:** live preview repeating the tile (1×/2×/3×), Highlight-seams toggle, Animate play button.
- **Top bar:** 🎲 Roll + seed; **Export ▾** (PNG / SVG / Video) + **Send to canvas**.
- **Right:** collapsible stacked sections — **Lattice**, **Cell content** (Mode → Tile family → Placement → palette), **Stylize**, **Output**. Contextual reveal per mode.
- Aesthetic follows the Linear-grade dark restyle: white accent, neutral white-opacity + type-color + emerald-for-run; **no purple accents**.
- A control `group` allow-list (parallel to `SPACE_TYPE_SECTIONS`) gates which sections appear, guarded by a unit test.

## Components & files (new)

- `frontend/app/components/vue-canvas/TextureStudioNode.vue` — node card + live preview; dispatches `comfynext:openTextureStudio`.
- `frontend/app/components/vue-canvas/TextureStudioSurface.vue` — modal editor.
- `frontend/app/lib/texturefx/renderer.ts` — WebGL2 renderer for Stages 1–2 (lattice + cell content), exposes a `render(config, w, h, t)` → canvas and `renderToBlob`.
- `frontend/app/lib/texturefx/lattice.ts` — symmetry-group tiling core + presets.
- `frontend/app/lib/texturefx/truchet.ts` — tile families + placement (random / WFC).
- `frontend/app/lib/texturefx/seamless.ts` — offset-wrap / mirror / feather for raster; AI-seamless orchestration.
- `frontend/app/lib/texturefx/svg.ts` — vector export for procedural/Truchet/lattice families.
- `frontend/app/lib/texturefx/controls.ts` + `sections.ts` — `ControlSpec[]` + section allow-list.

Stage 3 composes through the existing `frontend/app/lib/shaderfx` passes. Bake/encode reuse `frontend/app/lib/motion/bake.ts` / the `spacetype` bake + `/comfynext/spacetype_encode` rail.

## Data flow & integration

- Config persists to `node.data.properties.comfynext_textureStudio`; loaded on open, saved on close (mirrors Gradient Studio).
- Launch: node dispatches `comfynext:openTextureStudio` → `VueNodeCanvas` opens the surface via Teleport.
- Output: **Send to canvas** dispatches `comfynext:textureStudioOutput` with `{ sourceNodeId, nodeType: 'Image'|'Video', widgetOverrides }`, creating the artifact node; result recorded to the Assets panel.
- PNG via `uploadFrameBatch`; video via the frame-bake + `spacetype_encode` backend encode; **SVG** written for the vector/SVG editor (geometric families only).

## Export

- **PNG tile** (single seamless tile) and **big filled canvas** (tile drawn repeated to a chosen size).
- **SVG** for procedural / Truchet / lattice families — crisp, resolution-independent, editable in the existing vector editor.
- **Video** — animated seamless loop via the time uniform + existing encode rail.

## Testing & verification

Per the standing rule (never ship a visual/WebGL effect on unit tests alone):

- **Visual sign-off loop:** standalone HTML harness + Playwright screenshot iteration for the look — especially Truchet families and seam-wrapping correctness — with user sign-off before merge.
- **Unit tests:** seamless-wrap math (procedural domains wrap; raster offset-wrap is exact), the section allow-list (parallel to the `SPACE_TYPE_SECTIONS` guard), and `defaultsFromControls` over the `ControlSpec[]`.
- **WFC** tested headless for adjacency-constraint satisfaction and termination.

## Open questions / future

- Richer wallpaper groups (p4m, p6m, glide reflections) beyond the v1 presets — reachable on the chosen core.
- Aperiodic tilings (Penrose / einstein "hat") as a future flavor.
- Keyframed animation lanes for the time uniform (beyond a single looping speed).
