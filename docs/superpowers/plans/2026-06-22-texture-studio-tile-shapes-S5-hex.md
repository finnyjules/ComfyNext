# Texture Studio — Tile Shapes S5 (hex) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the **hex (penny-mosaic)** tiling shape — a square-seamless, 3-colored hexagonal grid — on the S0–S3 tiling-family rails. This is the FIRST 3-role shape (a/b/c); it exercises the third fill slot.

> NOTE: S4 (Cairo) was deferred (harder geometry, being tackled last). This slice adds `hex` to `SHAPE_FAMILIES`; Cairo will be appended after. Order in the enum is arbitrary — the GLSL dispatch keys off `SHAPE_FAMILIES.indexOf`, so appending hex now (index 7) and cairo later (index 8) is fine.

**Architecture:** Extend `shapes.ts` `shapeRegion` with a `hex` case; extend the renderer's `u_mode==3` shapes branch dispatch (…5=fishscale, 6=pythagorean, **7=hex**); add `hex` to `SHAPE_FAMILIES` (types + roles set) and `ROLES_BY_FAMILY` (3 roles). Add a `hexOrient` (pointy/flat) control + `u_hexFlat` uniform. Fills panel unchanged (it loops `rolesFor`, which now returns 3 roles for hex).

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-tile-shapes-design.md`. Builds on S3 (`380bbf3c2`). **Geometry prototyped + visually confirmed by the controller** (perfect 3-colored honeycomb, valid coloring, 1% anisotropy at cells=12, seamless 2×2) — implement verbatim.

## Global Constraints
- **Square-seamless by construction with ≤~5% anisotropy.** Pointy-top hex grid, `nx` columns × `ny` rows over [0,1]:
  - `nx = max(9, round(cells/3)*3)` — multiple of 3 so the `(q−r) mod 3` coloring wraps horizontally; clamped ≥9 to keep anisotropy low (nx=3/6 are the only badly-distorted cases).
  - `ny = 2*round(nx*K/2)` where `K = 1.1547005` (≈ 2/√3) — even (so the odd-row half-offset wraps vertically; vertical color wrap is then automatic since the shift is always a multiple of 3) and as close as possible to the regular ratio.
  - `sx = 1/nx`, `sy = 1/ny`. CPU and GLSL must compute `nx`, `ny` byte-identically (`Math.round(z)` ↔ `floor(z+0.5)`, same `K`).
- **3 roles** (`a`,`b`,`c`) — uses the third fill slot. Reuse fills/`evalFill` unchanged. NO backtick/non-ASCII in GLSL. NEVER `git add -A`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. main moves — capture HEAD before dispatch; review by the task's own commit range.

## Geometry (controller-verified)
- **Hex** (3 roles `a`,`b`,`c`): pointy-top hex grid, odd rows offset by +0.5·sx.
  - For pixel `(x,y)=(u,v)` (or swapped if flat — see below): `r0 = round(y/sy)`; over candidate rows `row ∈ {r0-1,r0,r0+1}` with `off = (row mod 2)*0.5` (nonneg form), `c0 = round(x/sx - off)`, over cols `col ∈ {c0-1,c0,c0+1}`: center `(cx,cy) = ((col+off)*sx, row*sy)`, track min Euclidean distance and its `(col,row,cx,cy)`.
  - `role = ((bcol - floor(brow/2) - brow) mod 3 + 3) mod 3` — the axial `(q−r) mod 3` 3-coloring (`q = col − floor(row/2)`, `r = row`); verified no two adjacent hexes share a role, and it wraps (nx≡0 mod3 horizontally; even ny makes the vertical color shift `−3·ny/2 ≡ 0 mod 3`).
  - Cell-local coords (per-hex, for radial/gradient fills): `fx = (x-bcx)/sx + 0.5`, `fy = (y-bcy)/sy + 0.5`.
  - **Orientation** (`hexOrient`): `pointy` (default) uses `(x,y)=(u,v)`. `flat` swaps inputs `(x,y)=(v,u)` (run the identical pointy math on swapped coords) and swaps the returned local coords back (`fx,fy` → swap). `nx,ny` are computed the same; flat just transposes.
  - Seamless: nx cols and ny rows fill [0,1] exactly; offset parity wraps (ny even); color wraps (nx mult 3 + even ny). Confirmed: 2×2 span shows no seam, valid 3-coloring, ~1% anisotropy at cells=12.

> Tile-frame fills unaffected (use `v_uv`). Only cell-frame fills consume the per-hex `fx,fy`.

---

## Task 1: Sampler + GLSL dispatch + roles + control + tests

**Files:** Modify `shapes.ts`, `renderer.ts`, `types.ts`, `roles.ts`, `controls.ts`; Test `texturefx-shapes.unit.spec.ts`.

- [ ] **Step 1: types.ts** — `SHAPE_FAMILIES` append `'hex'` (indices 0..6 unchanged ⇒ hex=7).
- [ ] **Step 2: roles.ts** — `ROLES_BY_FAMILY`: add `hex: ['a','b','c']`. Grow the module-local `SHAPE_FAMILIES` set to include `'hex'`.
- [ ] **Step 3: shapes.ts** — add the `hex` case (recompute its own grid):
```ts
case 'hex': {
  const flat = _p && String((_p as any).hexOrient) === 'flat'
  const x0 = flat ? v : u, y0 = flat ? u : v
  const K = 1.1547005
  const nx = Math.max(9, Math.round(cells / 3) * 3)
  const ny = 2 * Math.round((nx * K) / 2)
  const sx = 1 / nx, sy = 1 / ny
  const r0 = Math.round(y0 / sy)
  let best = 1e9, bcol = 0, brow = 0, bcx = 0, bcy = 0
  for (let dr = -1; dr <= 1; dr++) {
    const row = r0 + dr
    const off = (((row % 2) + 2) % 2) * 0.5
    const c0 = Math.round(x0 / sx - off)
    for (let dc = -1; dc <= 1; dc++) {
      const col = c0 + dc
      const cx = (col + off) * sx, cy = row * sy
      const d = (x0 - cx) ** 2 + (y0 - cy) ** 2
      if (d < best) { best = d; bcol = col; brow = row; bcx = cx; bcy = cy }
    }
  }
  const role = (((bcol - Math.floor(brow / 2) - brow) % 3) + 3) % 3
  const lx = (x0 - bcx) / sx + 0.5, ly = (y0 - bcy) / sy + 0.5
  return flat ? { role, fx: ly, fy: lx } : { role, fx: lx, fy: ly }
}
```
- [ ] **Step 4: renderer.ts shader** — extend the `u_mode>2.5` dispatch. Gate pythagorean to `else if (u_shapeFamily < 6.5)`, then append hex (`else`), setting `role` AND `cf` (3-color: role can be 0,1,2):
```glsl
    } else {                              // hex (penny mosaic, 3-color)
      float fl = u_hexFlat;
      float x0 = (fl > 0.5) ? v_uv.y : v_uv.x;
      float y0 = (fl > 0.5) ? v_uv.x : v_uv.y;
      float K = 1.1547005;
      float nx = max(9.0, floor(u_cells / 3.0 + 0.5) * 3.0);
      float ny = 2.0 * floor(nx * K / 2.0 + 0.5);
      float sx = 1.0 / nx; float sy = 1.0 / ny;
      float r0 = floor(y0 / sy + 0.5);
      float best = 1e9; float bcol = 0.0; float brow = 0.0; float bcx = 0.0; float bcy = 0.0;
      for (int dr = -1; dr <= 1; dr++) {
        float rw = r0 + float(dr);
        float off = mod(rw, 2.0) * 0.5;
        float c0 = floor(x0 / sx - off + 0.5);
        for (int dc = -1; dc <= 1; dc++) {
          float cl = c0 + float(dc);
          float cx = (cl + off) * sx; float cy = rw * sy;
          float d = (x0 - cx) * (x0 - cx) + (y0 - cy) * (y0 - cy);
          if (d < best) { best = d; bcol = cl; brow = rw; bcx = cx; bcy = cy; }
        }
      }
      role = int(mod(bcol - floor(brow / 2.0) - brow, 3.0) + 3.0) % 3;
      float lx = (x0 - bcx) / sx + 0.5; float ly = (y0 - bcy) / sy + 0.5;
      cf = (fl > 0.5) ? vec2(ly, lx) : vec2(lx, ly);
    }
```
  Add `uniform float u_hexFlat;` with the other shape uniforms. PLAIN ASCII only. NOTE the GLSL `mod(...,3.0)+3.0) %3` mirror of the CPU `((..%3)+3)%3` — `mod` for the float part then `int(...)%3` to land in {0,1,2}; confirm it matches the CPU for the sampled `bcol,brow` values.
- [ ] **Step 5: renderer.ts render()** — upload `gl.uniform1f(u('u_hexFlat'), String(p.hexOrient) === 'flat' ? 1 : 0)` alongside the other shape-uniform uploads.
- [ ] **Step 6: controls.ts** — add `{ key: 'hexOrient', label: 'Orientation', kind: 'select', options: ['pointy','flat'], default: 'pointy', group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'hex' }` (mirrors the existing `pinwheel` control's gating).
- [ ] **Step 7: tests** — add to `texturefx-shapes.unit.spec.ts` a `hex` describe block. RED→GREEN:
  - **3-coloring valid:** over a sampled grid at cells=12, assert role set is exactly {0,1,2} (all three appear) and ⊆ {0,1,2}.
  - **adjacency:** OPTIONAL spot — two points in horizontally-adjacent hexes have different roles (pick two centers one column apart).
  - **rolesFor:** `rolesFor({mode:'shapes',shapeFamily:'hex'})` → `['a','b','c']`.
  - **seamless wrap** at cells=12: `region(0,v).role===region(1,v).role` and `region(u,0).role===region(u,1).role` over a sampled grid (this validates nx mult-3 + even ny). Also at cells=9.
  - **flat orientation:** `shapeRegion('hex',u,v,12,{hexOrient:'flat'})` equals `shapeRegion('hex',v,u,12,{hexOrient:'pointy'})` with fx/fy swapped (spot-check a couple points).
- [ ] **Step 8: verify** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'texturefx/(renderer|shapes|controls|types|roles)' || echo clean` → clean; `npx vitest run tests/unit/texturefx-shapes.unit.spec.ts tests/unit/texturefx-controls.unit.spec.ts` → pass.
- [ ] **Step 9: commit** — `git add frontend/app/lib/texturefx/shapes.ts frontend/app/lib/texturefx/renderer.ts frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/roles.ts frontend/app/lib/texturefx/controls.ts frontend/tests/unit/texturefx-shapes.unit.spec.ts` → `feat(texture-studio): hex (penny-mosaic) tiling shape`.

---

## Task 2: Visual sign-off (controller-driven)
- [ ] Harness: render hex (pointy + flat) with per-role fills (a=gradient, b=solid, c=solid; and a 3-color solid). cells=12 and 9. 2×2 span (seam at midline). Confirm: regular-looking hexagons (anisotropy invisible), valid 3-coloring (no two adjacent hexes share a color), all 3 roles fillable, seamless (no seam at midline), flat = transposed pointy. Self-sign-off if clean; remove harness; full `npx vitest run` green.

## Self-review
- **Coverage:** hex, 3 roles a/b/c (FIRST 3-role shape — exercises the third fill slot), pointy+flat orientation, dispatch-by-family GLSL, seamless tests + 3-coloring validity. **Type consistency:** SHAPE_FAMILIES order …pythagorean=6/hex=7 matches GLSL thresholds (<6.5 pythag, else hex) + the `indexOf` upload; `hexOrient` string control read consistently (`==='flat'`) in shapes.ts, render() upload, and GLSL `u_hexFlat>0.5`. **CPU↔GLSL parity:** `nx=max(9,round(cells/3)*3)` ↔ `max(9, floor(cells/3+0.5)*3)`; `ny=2*round(nx*K/2)` ↔ `2*floor(nx*K/2+0.5)` (same K=1.1547005); `off=mod(row,2)*0.5` == `(((row%2)+2)%2)*0.5`; color `((..%3)+3)%3` ↔ `int(mod(..,3)+3)%3`; flat swap identical. **Reuse:** one new uniform (u_hexFlat) + one control (hexOrient); evalFill + fills untouched; earlier families unchanged.
```
