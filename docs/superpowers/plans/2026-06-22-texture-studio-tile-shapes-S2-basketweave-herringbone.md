# Texture Studio — Tile Shapes S2 (basket-weave + herringbone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add two brick-family tiling shapes — **basket-weave** and **herringbone** — on the S0/S1 tiling-family rails (sampler + GLSL mirror + roles + fills, all reused).

**Architecture:** Extend `shapes.ts` `shapeRegion` with `basketweave` and `herringbone` cases; extend the renderer's `u_mode==3` shapes branch dispatch on `u_shapeFamily` (0=octagon, 1=pinwheel, 2=chevron, 3=basketweave, 4=herringbone); add the two families to `SHAPE_FAMILIES` (types + roles set) and `ROLES_BY_FAMILY`. No new uniforms, no new controls. Fills panel unchanged.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-tile-shapes-design.md`. Builds on S1 (`6a273df3c`).

## Global Constraints
- **Seamless by construction.** Both shapes are intrinsically **period-4** (block weave / herringbone diagonal staircase cannot be period-2). To stay seamless for ANY `cells` value the shared even-step slider produces, each branch quantizes to a multiple of 4: `ch = max(4, round(cells/4)*4)` (CPU and GLSL identical). Octagon/pinwheel/chevron are NOT touched — they keep using `u_cells` directly. Unit tests assert wrap holds even when `cells` is not a multiple of 4 (e.g. cells=6 → ch=8).
- ≤3 roles (both use 2). Reuse fills/`evalFill` unchanged. NO backtick/non-ASCII in GLSL. NEVER `git add -A`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. main moves — capture HEAD before dispatch; review by the task's own commit range.

## Geometry (verified)
Grid: `gx=u*ch, gy=v*ch`, `cx=floor(gx), cy=floor(gy)`, `fx=fract(gx), fy=fract(gy)`. `ch = max(4, round(cells/4)*4)`.

- **Basket-weave** (2 roles `a`,`b`): block weave on 2×2-cell blocks.
  - Block parity `P = (floor(cx/2) + floor(cy/2)) mod 2`.
  - `P==0` → **horizontal-plank** block (role 0 `a`): two stacked 2-wide×1-tall planks. Plank-frame coords span the 2-cell width: `cf = ((cx mod 2) + fx)/2 , fy`.
  - `P==1` → **vertical-plank** block (role 1 `b`): two side-by-side 1-wide×2-tall planks. `cf = fx , ((cy mod 2) + fy)/2`.
  - The role 2-coloring is the over/under weave; the plank-frame coords make cell-frame (gradient/image/pattern) fills render as 2:1 planks — what distinguishes it from a flat checker.
  - Seamless: `ch` mult of 4 ⇒ `floor(cx/2)` parity and the `cx mod 2` plank offset both wrap at `cx=ch`.

- **Herringbone** (2 roles `brickA`,`brickB`): orthogonal herringbone, verified period-4 valid domino tiling. Each brick is 2:1; the two perpendicular brick directions are the two roles.
  - `role = floor((cx + cy)/2) mod 2` — direction 2-color (role 0 = horizontal bricks, role 1 = vertical bricks). This produces the herringbone diagonal-staircase banding.
  - Brick-frame coords (so brick-frame fills render per-brick): `par = (cx + cy) mod 2` (0 ⇒ left/bottom half of the brick, 1 ⇒ right/top half — runs of 2 same-role cells along the brick axis start where `cx+cy` is even).
    - role 0 (horizontal brick spans 2 cells in x): `cf = ((par) + fx)/2 , fy`.
    - role 1 (vertical brick spans 2 cells in y): `cf = fx , ((par) + fy)/2`.
  - Verified valid period-4 domino tiling (4 H + 4 V per 4×4, diagonal staircase); role runs of length 2 along each brick's axis confirm `par` selects the correct half.
  - Seamless: `ch` mult of 4 ⇒ `floor((cx+cy)/2)` parity and `(cx+cy)` parity both wrap at `cx=ch`/`cy=ch`.

> Tile-frame fills are unaffected (they use `v_uv` directly, still seamless because the pattern is seamless). Only cell-frame fills consume `cf`.

---

## Task 1: Samplers + GLSL dispatch + roles + tests

**Files:** Modify `shapes.ts`, `renderer.ts`, `types.ts`, `roles.ts`; Test `texturefx-shapes.unit.spec.ts`.

- [ ] **Step 1: types.ts** — `SHAPE_FAMILIES = ['octagon','pinwheel','chevron','basketweave','herringbone'] as const` (append the two; indices 0..2 unchanged ⇒ basketweave=3, herringbone=4).
- [ ] **Step 2: roles.ts** — `ROLES_BY_FAMILY`: add `basketweave: ['a','b']`, `herringbone: ['brickA','brickB']`. Grow the module-local `SHAPE_FAMILIES` set (line ~17) to include both.
- [ ] **Step 3: shapes.ts** — add cases to `shapeRegion` (mirror the geometry above). NOTE: both recompute their OWN grid from `ch` (not the top-level `gx/gy/fx/fy`, which use the raw `cells`):
```ts
case 'basketweave': {
  const ch = Math.max(4, Math.round(cells / 4) * 4)
  const bx = u * ch, by = v * ch
  const cx = Math.floor(bx), cy = Math.floor(by)
  const lfx = bx - cx, lfy = by - cy
  const P = (Math.floor(cx / 2) + Math.floor(cy / 2)) % 2
  if (P === 0) return { role: 0, fx: ((cx % 2) + lfx) / 2, fy: lfy }       // horizontal planks
  return { role: 1, fx: lfx, fy: ((cy % 2) + lfy) / 2 }                    // vertical planks
}
case 'herringbone': {
  const ch = Math.max(4, Math.round(cells / 4) * 4)
  const bx = u * ch, by = v * ch
  const cx = Math.floor(bx), cy = Math.floor(by)
  const lfx = bx - cx, lfy = by - cy
  const role = Math.floor((cx + cy) / 2) % 2
  const par = (cx + cy) % 2
  if (role === 0) return { role: 0, fx: (par + lfx) / 2, fy: lfy }         // horizontal brick
  return { role: 1, fx: lfx, fy: (par + lfy) / 2 }                         // vertical brick
}
```
(All `cx,cy >= 0` here since `u,v in [0,1]`, so `%` and `floor` are safe — no negative-mod concern.)
- [ ] **Step 4: renderer.ts shader** — extend the `if (u_mode > 2.5)` dispatch. Restructure so each family sets `role` AND a cell-frame coord `cf` (default `cf=f`), then a single `evalFill(role, cf, v_uv)` at the end. Octagon/pinwheel/chevron keep `cf=f` (the shared `f=fract(v_uv*u_cells)`); basketweave/herringbone recompute from `ch` and set `cf` to the plank/brick-frame coords. Append after the chevron branch:
```glsl
    } else if (u_shapeFamily < 3.5) {     // basket-weave
      float ch = max(4.0, floor(u_cells / 4.0 + 0.5) * 4.0);
      vec2 bg = v_uv * ch; vec2 bf = fract(bg);
      float cx = floor(bg.x); float cy = floor(bg.y);
      float P = mod(floor(cx * 0.5) + floor(cy * 0.5), 2.0);
      if (P < 0.5) { role = 0; cf = vec2((mod(cx, 2.0) + bf.x) * 0.5, bf.y); }
      else { role = 1; cf = vec2(bf.x, (mod(cy, 2.0) + bf.y) * 0.5); }
    } else {                              // herringbone
      float ch = max(4.0, floor(u_cells / 4.0 + 0.5) * 4.0);
      vec2 bg = v_uv * ch; vec2 bf = fract(bg);
      float cx = floor(bg.x); float cy = floor(bg.y);
      float rr = mod(floor((cx + cy) * 0.5), 2.0);
      float par = mod(cx + cy, 2.0);
      if (rr < 0.5) { role = 0; cf = vec2((par + bf.x) * 0.5, bf.y); }
      else { role = 1; cf = vec2(bf.x, (par + bf.y) * 0.5); }
    }
```
  Declare `vec2 cf = f;` near the top of the shapes branch (after `vec2 f = fract(g);`), set it in the octagon/pinwheel/chevron branches implicitly (they leave `cf=f`), and change the final call to `frag = vec4(evalFill(role, cf, v_uv), 1.0);`. Gate chevron to `else if (u_shapeFamily < 2.5)`. PLAIN-ASCII only; keep `floor(...*0.5)` form for `floor(cx/2)`.
- [ ] **Step 5: renderer.ts render()** — no new uniform uploads needed (no per-family params). `u_shapeFamily` already uploaded via `SHAPE_FAMILIES.indexOf`; the two new families resolve automatically (indices 3,4).
- [ ] **Step 6: tests** — add to `texturefx-shapes.unit.spec.ts`, two new `describe` blocks. RED→GREEN:
  - **basketweave:** block-parity role check — pick interior points in adjacent 2×2 blocks and assert roles differ; assert role set ⊆ {0,1}; assert `fx,fy ∈ [0,1)`. Seamless wrap at `cells=8` (mult 4) AND `cells=6` (proves quantize): `region(0,v).role==region(1,v).role` and `region(u,0).role==region(u,1).role` over a sampled grid.
  - **herringbone:** spot-check known cells from the period-4 table at `cells=4`: with `ch=4`, sample cell centers `(cx+0.5)/4,(cy+0.5)/4` and assert `role==floor((cx+cy)/2)%2` for a few `(cx,cy)` (e.g. (0,0)→0, (2,0)→1, (1,1)→1, (3,1)→0); assert role set ⊆ {0,1}; seamless wrap at `cells=8` and `cells=6`.
  - **rolesFor:** `rolesFor({mode:'shapes',shapeFamily:'basketweave'})` → `['a','b']`; `…'herringbone'` → `['brickA','brickB']`.
- [ ] **Step 7: verify** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'texturefx/(renderer|shapes|types|roles)' || echo clean` → clean; `npx vitest run tests/unit/texturefx-shapes.unit.spec.ts tests/unit/texturefx-controls.unit.spec.ts` → pass.
- [ ] **Step 8: commit** — `git add frontend/app/lib/texturefx/shapes.ts frontend/app/lib/texturefx/renderer.ts frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/roles.ts frontend/tests/unit/texturefx-shapes.unit.spec.ts` → `feat(texture-studio): basket-weave + herringbone tiling shapes`.

---

## Task 2: Visual sign-off (controller-driven)
- [ ] Harness: render basket-weave and herringbone with per-role fills (role a/brickA = gradient, role b/brickB = solid; and a 2-color solid). cells=8 and 12. 2×2 each. Confirm: basket-weave = interlocking 2:1 planks alternating H/V blocks (woven look, not flat checker); herringbone = diagonal brick staircase; both fillable per-role + seamless 2×2 (no seam line). Self-sign-off if clean; remove harness; full `npx vitest run` green.

## Self-review
- **Coverage:** basketweave (2×2 block weave, plank-frame coords) + herringbone (period-4 staircase, brick-frame coords), both 2 roles, dispatch-by-family GLSL, seamless tests incl. non-mult-4 cells. **Type consistency:** SHAPE_FAMILIES order octagon0/pinwheel1/chevron2/basketweave3/herringbone4 matches GLSL `u_shapeFamily` thresholds (<0.5,<1.5,<2.5,<3.5,else) + the `indexOf` upload. **Seamless:** period-4 quantize `ch` identical in CPU + GLSL; parity + offset both wrap at `ch`. **Reuse:** no new uniforms/controls; evalFill + fills untouched; octagon/pinwheel/chevron branches unchanged (still use `u_cells`).
```
