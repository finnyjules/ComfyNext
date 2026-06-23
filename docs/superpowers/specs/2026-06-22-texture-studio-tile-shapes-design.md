# Texture Studio — Phase 2: Geometric Tile Shapes + Hex (Design)

**Date:** 2026-06-22
**Status:** Approved (design); implementation plan pending

## Summary
Add a family of **geometric tiling shapes** to Texture Studio — octagon+square, pinwheel/half-square-triangle, chevron, basket-weave, herringbone, fish-scale, Pythagorean, Cairo pentagonal, and hex — each a seamless square-period tiling whose **regions are independently fillable** with the Phase-1 fill system (solid/gradient/image/pattern/opacity/link). These produce the Victorian-floor / mosaic visuals the user referenced.

## Goals
- Nine new tiling families, each seamless by construction on the existing square-tile pipeline.
- Every region of every shape is a **role**, so the existing Fills panel makes each region fillable with no per-shape UI work.
- Maximal reuse: the shapes plug into the existing mode/family + roles + `evalFill` machinery; the only new code per shape is its geometry function (CPU + GLSL) and its role list.

## Non-goals
- 4-coloring Cairo (and any shape needing >3 roles) — the fill system has **3 role slots**; all shapes use ≤3 roles (Cairo and hex use a 3-coloring). Bumping to 4 role slots is a documented future option, out of scope here.
- True-ratio (rectangular, exactly-regular) hex output — hex is **square-seamless with a tiny anisotropic stretch** (≤~5% off regular, visually indistinguishable); an "exact ratio" mode is a future option.
- New stylize/raster/AI features — orthogonal; the stylize stage already composes over any tile.

## Architecture — the "tiling family" abstraction
A shape is defined by one function:
```
shapeRegion(family, u, v, cells, params) -> { role: int, fx: float, fy: float }
```
- `u,v` ∈ [0,1] tile coords; `cells` = repeat count; returns the **role index** the pixel belongs to, plus the **cell-local coords** `(fx,fy)` ∈ [0,1] for that region (used by cell-frame fills).
- A pure **CPU** implementation in `shapes.ts` is the unit-tested source of truth; the **GLSL** mirror in `renderer.ts` reproduces it (same pattern as `truchetColor`/`pattern.ts` → shader).
- Seamlessness is **by construction**: every shape is periodic with period 1 over an integer `cells` grid, so `shapeRegion(0,v)==shapeRegion(1,v)` and `shapeRegion(u,0)==shapeRegion(u,1)`. Unit tests assert this per family.

**Integration with the existing engine (no fill-system changes):**
- `types.ts`: `MODES` gains `'shapes'`; new `SHAPE_FAMILIES = ['octagon','pinwheel','chevron','basketweave','herringbone','fishscale','pythagorean','cairo','hex']`; `ROLES_BY_FAMILY` (roles.ts) gains an entry per shape.
- `roles.ts`: `activeFamily(p)` returns `p.shapeFamily` when `mode==='shapes'`; `rolesFor` returns `ROLES_BY_FAMILY[shapeFamily]`; a `SHAPE_FAMILIES` set is added to the mode-scoped validation (so a shape family only resolves in shapes mode).
- `renderer.ts`: a new shader branch (`u_mode==3`) calls a GLSL `shapeRegion` dispatch by `u_shapeFamily`, gets `(role, fx, fy)`, then `col = evalFill(role, vec2(fx,fy), v_uv)` — the existing per-role fill evaluation, unchanged. Up to 3 roles → existing `u_fill*[3]` uniforms.
- `controls.ts`: shapes-mode controls — a `shapeFamily` select, the shared `cells` slider, and a few per-shape extras gated by `when` (pinwheel: HST↔pinwheel toggle; hex: pointy/flat orientation; fishscale: scale overlap). Section reuse: shapes controls live in the existing `Cell`/`Content` sections; the Fills panel is already driven by `rolesFor`.
- `TextureStudioSurface.vue` / node: the mode picker gains "Shapes"; shape controls render via the existing control loop; **the Fills panel needs no changes** (it loops `rolesFor(params)`).

**Roles (all ≤3):**
| family | roles |
|---|---|
| octagon | tile, joint |
| pinwheel | a, b |
| chevron | a, b |
| basketweave | a, b |
| herringbone | brickA, brickB |
| fishscale | scale, ground |
| pythagorean | big, small |
| cairo | a, b, c |
| hex | a, b, c |

## Per-shape geometry (intent; exact formulas in the plan, guarded by seamless unit tests)
Grid convention: `g = uv*cells`, cell index `floor(g)`, local `f = fract(g)`.
- **Octagon + square:** in each cell, the 4 corner triangles (`f.x+f.y<c`, etc., c≈0.29) are role `joint` (they merge across 4 cells into the small square at grid vertices); the rest is role `tile` (octagon). `fx,fy=f`.
- **Pinwheel / HST:** cell split by a diagonal → roles a/b. A `pinwheel` toggle rotates the diagonal 90° per cell by `(cx+cy)` parity so 4 cells form a pinwheel; off = straight half-square-triangles.
- **Chevron:** stripe index `floor(uv.y*cells*2 + triWave(uv.x*cells))`, role = parity. triWave period 1 → seamless.
- **Basket-weave:** 2-color by block-pair checker (`(floor(uv.x*cells)+floor(uv.y*cells))%2`) → horizontal-pair blocks (a) vs vertical-pair blocks (b); brick subdivisions drawn as thin role-internal lines (cosmetic, optional).
- **Herringbone:** 2:1 bricks at ±45°; the standard herringbone 2-coloring assigns each brick to one of the two perpendicular directions (brickA/brickB). Exact region test derived in the plan; seamless via integer cells.
- **Fish-scale / clamshell:** brick-offset lattice of scale centers (rows offset by half); pixel inside the nearest scale-circle (radius tuned for overlap) → `scale`, else `ground`. Overlap yields scallops. Seamless via periodic lattice.
- **Pythagorean:** two square sizes (a,b) in the offset Pythagorean lattice (each row shifted by b); role = inside-big vs inside-small. Seamless via the lattice period.
- **Cairo pentagonal:** p4g unit cell partitioned into 4 pentagons by the Cairo construction; 3-colored by pentagon position + cell parity (a/b/c). Exact half-plane cuts in the plan; seamless via cell periodicity.
- **Hex (square-seamless):** flat-top (or pointy, per `orientation`) hex grid whose horizontal/vertical periods are stretched so an integer number of hex columns and rows fill the [0,1] square (≤~5% anisotropy); region = hex index, 3-colored by `(q - r) mod 3` (axial) → a/b/c (penny-mosaic). `fx,fy` = local coords within the hex. Seamless by construction.

## Components / files
- `frontend/app/lib/texturefx/shapes.ts` (new) — `shapeRegion(family,u,v,cells,params)` + per-shape helpers; pure, unit-tested.
- `frontend/app/lib/texturefx/types.ts` — `'shapes'` mode, `SHAPE_FAMILIES`.
- `frontend/app/lib/texturefx/roles.ts` — shape roles + mode-scoped `rolesFor`/`activeFamily`.
- `frontend/app/lib/texturefx/renderer.ts` — `u_mode==3` branch + GLSL `shapeRegion` dispatch → `evalFill`.
- `frontend/app/lib/texturefx/controls.ts` (+ `sections.ts` if needed) — shapeFamily/cells/per-shape controls.
- `frontend/app/components/vue-canvas/TextureStudioSurface.vue` + `TextureStudioNode.vue` — Shapes mode in the picker; per-shape controls (Fills panel unchanged).
- Tests: `frontend/tests/unit/texturefx-shapes.unit.spec.ts` — per-family seamless-wrap + role-count + spot region checks.

## Sub-slices (each = CPU sampler + GLSL mirror + roles + seamless unit tests + visual sign-off)
- **S0 — scaffolding + octagon:** `shapes` mode end-to-end: types/roles/mode-scoped `rolesFor`, `shapes.ts` skeleton + `shapeRegion('octagon',…)`, renderer `u_mode==3` dispatch → `evalFill`, UI mode/family/cells picker. Proves the pipeline + Fills work on a real shape.
- **S1 — pinwheel + chevron** (simple grid splits).
- **S2 — basket-weave + herringbone** (brick families).
- **S3 — fish-scale + Pythagorean.**
- **S4 — Cairo pentagonal** (hardest geometry; 3-color).
- **S5 — hex** (square-seamless stretch; 3-color).

## Testing
- **Unit (per family):** seamless wrap (`region(0,v)==region(1,v)`, `region(u,0)==region(u,1)` over sampled grids); correct role set; a few spot-checks of known interior points (e.g. octagon center → tile, cell corner → joint).
- **Visual (per slice):** each shape renders, every region is fillable (solid + a gradient/image fill), tiles seamlessly 2×2; hex anisotropy is visually acceptable.
- **Regression:** existing modes (procedural/truchet/raster) and the fill system unchanged; full suite green.

## Open / future
- 4-color Cairo / >3-role shapes (needs a role-slot bump to 4).
- Exact-ratio (rectangular) hex output.
- Per-shape grout/mortar as an extra role.
- SVG/vector export of the geometric shapes (ties into the deferred Slice 6).
