# Texture Studio — Per-Region Fills (Phase 1) Design

**Date:** 2026-06-22
**Status:** Approved (design); implementation plan pending

## Summary

Evolve the Texture Studio from "a few flat colors per pattern" to **per-region fills**: every region/role the engine draws (checker A/B, dot vs ground, Truchet stroke vs ground, weave warp/weft/gap, …) becomes an independently fillable slot taking a **solid color, gradient, image, or nested pattern**, each in a **cell-local or tile-global** coordinate frame. This is the foundation that the planned archetype library (Victorian stars, hex mosaics, encaustic florals) will build on — those just supply new geometry (new roles); the fill system below is shared.

This is **Phase 1** of a larger vision (decomposed with the user):
- **Phase 1 (this spec):** per-region fills on the existing procedural geometry.
- **Phase 2:** hex lattice + hex mosaic tiling.
- **Phase 3:** designed archetype library (named regions filled via Phase 1).
- **Phase 4 (later):** freeform region editor.

## Goals
- Each role of every motif/family is fillable with **solid / gradient / image / nested-pattern**.
- Each fill chooses its **coordinate frame**: cell-local (repeats per cell) or tile-global (spans the tile, regions act as a stencil).
- Output stays **perfectly seamless** for every fill type × frame.
- Maximal reuse: gradients inline, **images via the Slice-4a raster pipeline**, **nested patterns via `textureFx` recursively**.
- Backward compatible: existing nodes render unchanged (roles default to solid fills from the old `colorA/colorB/background`).

## Non-goals (Phase 1)
- New geometry (hex, stars, borders) — Phases 2–3.
- Freeform/vector region editing — Phase 4.
- Per-individual-cell fills (fills are per-**role**; the pattern's repetition comes from the geometry, matching encaustic tiles and the existing `fillList` model).

## Architecture (Approach B — layered fill compositing)

The "Lattice → Cell → **Fill** → Stylize" pipeline. One main fragment shader determines a pixel's **role** (existing logic) and **evaluates that role's fill**; the two heavy fill types are pre-rendered to textures by their specialist renderer and sampled.

**Per-pixel fill evaluation (in the composite shader):**
- **solid** → per-role color uniform (inline).
- **gradient** → inline stop interpolation (2–4 stops; linear or radial; angle), evaluated in cell-local `(fx,fy)` or tile `(u,v)` coords.
- **image** → sample a per-role image texture (loaded via `loadRaster`), in cell/tile frame, using the Slice-4a seam modes (mirror/feather/direct) for tile-global seamlessness.
- **nested-pattern** → sample a per-role texture **pre-rendered by `textureFx` recursively** with a sub-config, in cell/tile frame.

**Pre-render step (JS, per render):** for each role whose fill is `image` or `pattern`, ensure a tile texture (raster cache for image; a recursive `textureFx.render(subConfig)` for pattern) and bind it to a texture unit. Solid/gradient need no texture. Roles are ≤3 per current family, so ≤3 fill textures (well within WebGL2's ≥16 units; state texture stays on unit 0, raster on unit 1, fill textures on units 2+).

**Roles per motif/family** (ordered):
| family | roles |
|---|---|
| checker | `a`, `b` |
| stripes | `ink`, `ink2` |
| dots | `dot`, `ground` |
| grid | `line`, `ground` |
| arcs | `stroke`, `ground` |
| diagonal | `sideA`, `sideB` |
| weave | `warp`, `weft`, `gap` |
| multiscale | `arc`, `ground` |

The shader already computes which role a pixel is in (it picks colorA/B/bg today); that mapping is reused to index the role's fill.

## Data model

A `fills` object on the texture params, keyed by role:
```ts
type Frame = 'cell' | 'tile'
type Fill =
  | { type: 'solid';    color: string }
  | { type: 'gradient'; frame: Frame; kind: 'linear' | 'radial'; angle: number; stops: { c: string; p: number }[] /* 2–4 */ }
  | { type: 'image';    frame: Frame; src: string; seam: 'mirror' | 'feather' | 'direct'; scale: number }
  | { type: 'pattern';  frame: Frame; sub: TextureSubConfig /* motif/family + colors + cells (one level, no further nesting) */ }
type FillsByRole = Record<string, Fill>
```
- Stored as `params.fills` (nested object; persists via the existing `cloneParams` JSON clone). The texture params type widens to carry `fills?: FillsByRole`.
- **Defaults / back-compat:** if a role has no entry in `fills`, it falls back to a solid fill using the legacy `colorA/colorB/background` mapping (role 0 → colorA, role 1 → colorB/background, etc.), so existing nodes are visually unchanged.
- **Nested pattern depth:** one level only (`sub` is a flat sub-pattern config; its own roles are solid). Prevents unbounded recursion.

## UI — the Fills panel

Replaces the flat "Color" section. Lists the current family's roles; each role is a collapsible fill:
- a **type tab-row** (Solid / Gradient / Image / Pattern),
- **contextual params**: solid → color; gradient → linear/radial + angle + stops (2–4, add/remove); image → Source (Import… via the Slice-4a uploader) + seam + scale; pattern → a compact sub-picker (motif/family + colors + cells),
- a **frame toggle** (Cell / Tile) for gradient/image/pattern.

Reuses the studio control primitives (`StudioColor`, `StudioSlider`, `StudioSegmented`, `StudioSelect`) + the Slice-4a import handler. The roles list is driven by the active family's role declaration; switching family re-keys the fills (unknown roles default to solid). `'Fills'` is added to the section allow-list (`TEXTURE_SECTIONS`).

## Seamlessness

Each fill stays seamless in its frame:
- **solid** — always.
- **cell-local** (any type) — evaluated in `(fx,fy)` per cell → repeats → seamless by construction.
- **tile-global gradient** — uses a **mirrored/periodic ramp** (value goes A→B→A across the tile) so the tile's opposite edges match.
- **tile-global image** — reuses the Slice-4a seam modes (mirror/feather/direct).
- **tile-global / cell nested-pattern** — `textureFx` output already tiles seamlessly.

The role geometry already wraps (the lattice/motif is seamless), so the composited tile is seamless whenever each fill is seamless in its frame. Verified per fill×frame in the screenshot harness.

## Components / files (Phase 1)
- `frontend/app/lib/texturefx/roles.ts` (new) — role declarations per family; legacy-color→default-fill mapping.
- `frontend/app/lib/texturefx/fills.ts` (new) — `Fill` types, defaults, and pure helpers (gradient stop→uniform packing, tile-global periodic-ramp coord, fill→uniform/sampler resolution). Unit-tested.
- `frontend/app/lib/texturefx/renderer.ts` — composite shader: per-role fill evaluation (inline solid/gradient; sample image/pattern textures); bind pre-rendered fill textures.
- `frontend/app/lib/texturefx/patternfill.ts` (new, slice 1c) — recursive `textureFx` sub-render for pattern fills (cached by sub-config key).
- `frontend/app/components/vue-canvas/TextureStudioSurface.vue` — the Fills panel (role list + per-role fill picker), replacing the Color section; manages `params.fills`.
- `frontend/app/lib/texturefx/{types,sections,controls}.ts` — `'Fills'` section; role/fill plumbing.
- Tests: `tests/unit/texturefx-fills.unit.spec.ts` (roles map, fill defaults/back-compat, gradient-periodicity + seamless coord math).

## Implementation sub-slices
- **1a:** `roles.ts` + `fills.ts` (data model, defaults, back-compat) + solid & gradient fills (inline in shader) + the Fills panel (Solid/Gradient tabs + frame; Image/Pattern tabs visible-but-disabled). Ships per-region solid + gradient end-to-end.
- **1b:** Image fills (per-role image texture via raster pipeline; Import + seam + scale + frame).
- **1c:** Nested-pattern fills (recursive `textureFx` pre-render per role; the compact sub-picker).

Each sub-slice is its own plan → build → visual sign-off.

## Testing
- **Unit:** role declarations per family; `Fill` defaults + legacy-color back-compat mapping; gradient stop packing; tile-global periodic-ramp coordinate (proves edge-match). Pure functions only.
- **Visual (screenshot harness + sign-off):** each fill type × frame renders correctly and **tiles seamlessly** (2×2 with seam check) — never ship on unit tests alone.
- Regression: with no `fills` set, output is byte-identical to today (roles default to the legacy colors).

## Open questions / future
- Per-fill opacity / blend between a region's fill and a global background (deferred).
- Sharing a fill across roles (a "link" affordance) — deferred.
- Phase 2 (hex) introduces new families/roles that plug into this same fill system unchanged.
