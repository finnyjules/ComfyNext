# Texture Studio — Tile Shapes S6 (3D cubes / tumbling blocks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a **3D cubes (tumbling-blocks / rhombille)** tiling shape — the isometric cube illusion — on the Phase-2 tile-shapes rails. It's a 3-role shape (one role per visible cube face: top / left / right), so coloring the three roles light→dark yields the 3D effect, and the existing Fills panel needs no changes.

**Architecture:** Extend `shapes.ts` `shapeRegion` with a `cubes` case that **REUSES the hex grid** (pointy-top, same `nx`/`ny` and nearest-center search as the existing `hex` case); within each hexagon the role is the **120° angular sector** of the pixel around the hex center (the rhombille split → 3 rhombus faces). Extend the renderer's `u_mode==3` shapes-branch dispatch (…7=hex, 8=cairo, **9=cubes**); add `cubes` to `SHAPE_FAMILIES` (types + roles set) and `ROLES_BY_FAMILY` (3 roles). No new controls/uniforms. Fills panel unchanged.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-tile-shapes-design.md` (this extends Phase 2 with a 10th shape requested by the user). Builds on S4 Cairo (`0b62387de`; latest texturefx HEAD). **Geometry prototyped + visually confirmed by the controller** (clean uniform 3D cubes at cells=12, seamless 2×2) — implement verbatim.

## Global Constraints
- **Reuse hex grid:** pointy-top, `nx = max(9, round(cells/3)*3)`, `ny = 2*round(nx*K/2)` with `K = 1.1547005`, `sx=1/nx`, `sy=1/ny`, odd rows offset +0.5·sx, nearest-center via a 3×3 search — IDENTICAL to the `hex` case. (Seamless: the hex grid wraps for nx mult-of-3 + even ny; the per-hex angular role is local so wraps automatically.)
- **3 roles** (`top`,`left`,`right`) — the three cube faces. Reuse fills/`evalFill` unchanged. NO backtick/non-ASCII in GLSL. NEVER `git add -A`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. main moves (concurrent compositor commits) — capture HEAD before dispatch; review by the task's own commit range only.

## Geometry (controller-verified)
- **Cubes / tumbling blocks** (3 roles `top`,`left`,`right`): find the nearest hex center `(bcx,bcy)` exactly as the `hex` case does (same `nx,ny,sx,sy,r0,off,c0` loop). Then:
  - `dx = u - bcx`, `dy = (v - bcy) * (sx/sy)` — **aspect-correct dy by `sx/sy`** so the angular sectors are symmetric despite the slight cell stretch.
  - `ang = ((atan2(dy,dx) in degrees) - 30) mod 360` (normalized to [0,360)).
  - `role = floor(ang/120) mod 3` — three 120° sectors with boundaries at the even-vertex angles 30°/150°/270° and sector centers (rhombus tips) at 90°/210°/330°. role 0 = **top** (sector 30–150, tip up at 90°), role 1 = **left** (150–270), role 2 = **right** (270–390).
  - Cell-local coords (per-cube frame, for face gradients): `fx = (u-bcx)/sx + 0.5`, `fy = (v-bcy)/sy + 0.5` (same convention as the `hex` case).
  - This is the rhombille tiling = each hexagon split into 3 rhombi by radial lines to its even vertices; the 3 rhombi read as the top/left/right faces of a cube. Seamless because the hex grid is seamless and the role is per-hex-local.

> Tile-frame fills unaffected (use `v_uv`). Only cell-frame fills consume the per-cube `fx,fy`.

---

## Task 1: Sampler + GLSL dispatch + roles + tests

**Files:** Modify `shapes.ts`, `renderer.ts`, `types.ts`, `roles.ts`; Test `texturefx-shapes.unit.spec.ts`.

- [ ] **Step 1: types.ts** — `SHAPE_FAMILIES` append `'cubes'` (indices 0..8 unchanged ⇒ cubes=9).
- [ ] **Step 2: roles.ts** — `ROLES_BY_FAMILY`: add `cubes: ['top','left','right']`. Grow the module-local `SHAPE_FAMILIES` set to include `'cubes'`.
- [ ] **Step 3: shapes.ts** — add the `cubes` case (reuse the hex nearest-center, then angular role):
```ts
case 'cubes': {
  const K = 1.1547005
  const nx = Math.max(9, Math.round(cells / 3) * 3)
  const ny = 2 * Math.round((nx * K) / 2)
  const sx = 1 / nx, sy = 1 / ny
  const r0 = Math.round(v / sy)
  let best = 1e9, bcx = 0, bcy = 0
  for (let dr = -1; dr <= 1; dr++) {
    const row = r0 + dr
    const off = (((row % 2) + 2) % 2) * 0.5
    const c0 = Math.round(u / sx - off)
    for (let dc = -1; dc <= 1; dc++) {
      const cx = (c0 + dc + off) * sx, cy = row * sy
      const d = (u - cx) ** 2 + (v - cy) ** 2
      if (d < best) { best = d; bcx = cx; bcy = cy }
    }
  }
  const dx = u - bcx, dy = (v - bcy) * (sx / sy)
  const ang = (((Math.atan2(dy, dx) * 180) / Math.PI - 30) % 360 + 360) % 360
  const role = Math.floor(ang / 120) % 3
  return { role, fx: (u - bcx) / sx + 0.5, fy: (v - bcy) / sy + 0.5 }
}
```
- [ ] **Step 4: renderer.ts shader** — extend the `u_mode>2.5` dispatch. Gate cairo to `else if (u_shapeFamily < 8.5)`, then append cubes (`else`), setting `role` (0/1/2) AND `cf`:
```glsl
    } else {                              // 3D cubes / tumbling blocks (rhombille, 3-color)
      float K = 1.1547005;
      float nx = max(9.0, floor(u_cells / 3.0 + 0.5) * 3.0);
      float ny = 2.0 * floor(nx * K / 2.0 + 0.5);
      float sx = 1.0 / nx; float sy = 1.0 / ny;
      float r0 = floor(v_uv.y / sy + 0.5);
      float best = 1e9; float bcx = 0.0; float bcy = 0.0;
      for (int dr = -1; dr <= 1; dr++) {
        float rw = r0 + float(dr);
        float off = mod(rw, 2.0) * 0.5;
        float c0 = floor(v_uv.x / sx - off + 0.5);
        for (int dc = -1; dc <= 1; dc++) {
          float cx = (c0 + float(dc) + off) * sx; float cy = rw * sy;
          float d = (v_uv.x - cx) * (v_uv.x - cx) + (v_uv.y - cy) * (v_uv.y - cy);
          if (d < best) { best = d; bcx = cx; bcy = cy; }
        }
      }
      float dx = v_uv.x - bcx; float dy = (v_uv.y - bcy) * (sx / sy);
      float ang = mod(degrees(atan(dy, dx)) - 30.0, 360.0);
      role = int(mod(floor(ang / 120.0), 3.0));
      cf = vec2((v_uv.x - bcx) / sx + 0.5, (v_uv.y - bcy) / sy + 0.5);
    }
```
  NOTE: GLSL `mod(x,360.0)` returns [0,360) for negative x (matches the CPU `((%360)+360)%360`); `degrees(atan(dy,dx))` mirrors CPU `atan2(dy,dx)*180/PI`. PLAIN ASCII only. No new uniforms.
- [ ] **Step 5: renderer.ts render()** — no new uniform uploads (cubes=9 resolves via the existing `u_shapeFamily` `indexOf` upload).
- [ ] **Step 6: tests** — add to `texturefx-shapes.unit.spec.ts` a `cubes` describe block. RED→GREEN:
  - **3 faces present:** over a sampled grid at cells=12, assert role set is exactly {0,1,2} and ⊆ {0,1,2}; fx,fy finite.
  - **face-by-angle spot check:** at a hex center, a point just ABOVE it (toward +v, the top face direction) → role 0 (top); a point toward lower-left → role 1; lower-right → role 2. Compute a hex center for cells=12 (e.g. row=2 col=2 → center `((2+0)*sx, 2*sy)` with even-row offset 0), sample center+small offsets in the three directions, assert the three expected roles. [Use directions matching the sector centers 90°/210°/330° after aspect correction — i.e. straight up for top, down-left for left, down-right for right.]
  - **rolesFor:** `rolesFor({mode:'shapes',shapeFamily:'cubes'})` → `['top','left','right']`.
  - **seamless wrap** at cells=12 AND cells=9: `region(0,v).role===region(1,v).role` and `region(u,0).role===region(u,1).role` over a sampled grid. (Note: like the hex case, the sampler wraps cleanly; if a measure-zero boundary tie surfaces, mirror the hex case's input-wrap fix — but prototyping showed the grid wraps; keep the test honest by sampling interior-ish v values, not relying on a tautology.)
- [ ] **Step 7: verify** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'texturefx/(renderer|shapes|types|roles)' || echo clean` → clean; `npx vitest run tests/unit/texturefx-shapes.unit.spec.ts tests/unit/texturefx-controls.unit.spec.ts` → pass.
- [ ] **Step 8: commit** — `git add frontend/app/lib/texturefx/shapes.ts frontend/app/lib/texturefx/renderer.ts frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/roles.ts frontend/tests/unit/texturefx-shapes.unit.spec.ts` → `feat(texture-studio): 3D cubes (tumbling-blocks) tiling shape`.

---

## Task 2: Visual sign-off (controller-driven)
- [ ] Harness: render cubes via the REAL committed `shapeRegion` → PNG over a [0,2]² span (seam at midline). Color the 3 roles light/medium/dark (top/left/right) for the classic cube look; also a version with a gradient on `top` to confirm per-cube coords. cells=12 and 9. Confirm: uniform 3D cubes (tumbling-blocks illusion reads clearly), all 3 faces fillable, seamless (no seam at midline). Self-sign-off if clean; remove harness; full `npx vitest run` green.

## Self-review
- **Coverage:** cubes (rhombille / tumbling blocks), 3 roles top/left/right, reuses the hex pointy-top grid + nearest-center, role = aspect-corrected 120° angular sector, dispatch-by-family GLSL, seamless + 3-face tests. **Type consistency:** SHAPE_FAMILIES order …cairo=8/cubes=9 matches GLSL thresholds (<8.5 cairo, else cubes) + the `indexOf` upload. **CPU↔GLSL parity:** identical hex nx/ny/nearest-center (already proven for hex), `round`↔`floor(x+0.5)`, `off=mod(row,2)*0.5`==`(((row%2)+2)%2)*0.5`, aspect `dy*(sx/sy)`, `atan2*180/PI`↔`degrees(atan)`, `((%360)+360)%360`↔`mod(x,360)`, `floor(ang/120)%3`↔`int(mod(floor(ang/120),3))`, identical `fx/fy`. **Reuse:** no new uniforms/controls; evalFill + fills untouched; earlier families unchanged. **10th shape; completes the user's requested set.**
```
