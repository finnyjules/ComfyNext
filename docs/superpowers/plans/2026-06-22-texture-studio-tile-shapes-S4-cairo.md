# Texture Studio — Tile Shapes S4 (Cairo pentagonal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the **Cairo pentagonal** tiling shape — a 3-colored congruent-pentagon tiling — on the S0–S5 tiling-family rails. This is the LAST of the 9 shapes (done after hex per the user's choice).

**Architecture:** Extend `shapes.ts` `shapeRegion` with a `cairo` case; extend the renderer's `u_mode==3` shapes branch dispatch (…6=pythagorean, 7=hex, **8=cairo**); add `cairo` to `SHAPE_FAMILIES` (types + roles set) and `ROLES_BY_FAMILY` (3 roles). No new controls/uniforms. Fills panel unchanged.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-tile-shapes-design.md`. Builds on S5 (`597f35eed`, hex; latest texturefx HEAD). **Geometry fully derived, prototyped, and verified by the controller** (clean uniform Cairo, full coverage no gaps/overlaps, valid 3-coloring with **0 violations / 1280 edge checks**, period-6 seamless) — implement verbatim.

## Global Constraints
- **Exact construction (controller-verified):** congruent pentagon `U = (-2,0),(2,0),(3,3),(0,4),(-3,3)` (CCW; right angles at (±3,3)). Degree-4 centers `C = (3+6i, 3+6j)` form a square lattice spacing 6. Around each C, 4 pentagons **pinwheel** = U rotated k·90° (k=0..3) about U's right-angle vertex (3,3), placed at C: `vertex = C + rot(U_vert - (3,3), k)`. This tiles with **NO gaps or overlaps** (verified full coverage).
- **3-coloring** `role = [0,0,1,2][k]` — depends ONLY on orientation k (k=0,1→a; k=2→b; k=3→c). Verified valid (0 adjacency violations); k=0 and k=1 pentagons (both role a) are never edge-adjacent. Because color is k-only (position-independent), it wraps for ANY period — no extra quantize constraint.
- **Seamless:** translational period **6** (every center has the identical pinwheel). Quantize world: `chC = 6 * max(1, round(cells/6))`. CPU and GLSL compute `chC` byte-identically.
- **3 roles** (a/b/c). Reuse fills/`evalFill` unchanged. NO backtick/non-ASCII in GLSL. NEVER `git add -A`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. main moves (concurrent compositor commits have been landing) — capture HEAD before dispatch; review by the task's own commit range only.

## Geometry — classify a point (controller-verified)
For pixel `(x,y) = uv * chC`:
1. `ic = round((x-3)/6)`, `jc = round((y-3)/6)`.
2. Over `di,dj ∈ {-1,0,1}` and `k ∈ {0,1,2,3}`: center `C=(3+6(ic+di), 3+6(jc+dj))`; transform the point into the pentagon's local frame: `lu = rot(P - C, -k) + (3,3)` where `rot(v,-k)` applies CW-90° k times — k=0:`(x,y)`, k=1:`(y,-x)`, k=2:`(-x,-y)`, k=3:`(-y,x)`.
3. The point is inside this pentagon iff `lu` is inside the fixed U (5 half-planes, CCW):
   - `lu.y >= 0`
   - `lu.y - 3*lu.x + 6 >= 0`
   - `-lu.x - 3*lu.y + 12 >= 0`
   - `lu.x - 3*lu.y + 12 >= 0`
   - `3*lu.x + lu.y + 6 >= 0`
4. First match (loop order di,dj,k) wins: `role = (k<2)?0:(k==2?1:2)`; per-pentagon local coords `fx = (lu.x+3)/6`, `fy = lu.y/4` (U spans x∈[-3,3], y∈[0,4] ⇒ fx,fy ∈ [0,1]).

> Tile-frame fills unaffected (use `v_uv`). Only cell-frame fills consume the per-pentagon `fx,fy`.

---

## Task 1: Sampler + GLSL dispatch + roles + tests

**Files:** Modify `shapes.ts`, `renderer.ts`, `types.ts`, `roles.ts`; Test `texturefx-shapes.unit.spec.ts`.

- [ ] **Step 1: types.ts** — `SHAPE_FAMILIES` append `'cairo'` (indices 0..7 unchanged ⇒ cairo=8).
- [ ] **Step 2: roles.ts** — `ROLES_BY_FAMILY`: add `cairo: ['a','b','c']`. Grow the module-local `SHAPE_FAMILIES` set to include `'cairo'`.
- [ ] **Step 3: shapes.ts** — add the `cairo` case (recomputes its own grid):
```ts
case 'cairo': {
  const chC = 6 * Math.max(1, Math.round(cells / 6))
  const Px = u * chC, Py = v * chC
  const ic = Math.round((Px - 3) / 6), jc = Math.round((Py - 3) / 6)
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const cx = 3 + 6 * (ic + di), cy = 3 + 6 * (jc + dj)
    const dx = Px - cx, dy = Py - cy
    for (let k = 0; k < 4; k++) {
      let rx: number, ry: number
      if (k === 0) { rx = dx; ry = dy }
      else if (k === 1) { rx = dy; ry = -dx }
      else if (k === 2) { rx = -dx; ry = -dy }
      else { rx = -dy; ry = dx }
      const lx = rx + 3, ly = ry + 3
      if (ly >= 0 && (ly - 3 * lx + 6) >= 0 && (-lx - 3 * ly + 12) >= 0 && (lx - 3 * ly + 12) >= 0 && (3 * lx + ly + 6) >= 0) {
        const role = k < 2 ? 0 : (k === 2 ? 1 : 2)
        return { role, fx: (lx + 3) / 6, fy: ly / 4 }
      }
    }
  }
  return { role: 0, fx: 0, fy: 0 } // unreachable (full coverage); safe fallback
}
```
- [ ] **Step 4: renderer.ts shader** — extend the `u_mode>2.5` dispatch. Gate hex to `else if (u_shapeFamily < 7.5)`, then append cairo (`else`):
```glsl
    } else {                              // Cairo pentagonal (3-color)
      float chC = 6.0 * max(1.0, floor(u_cells / 6.0 + 0.5));
      vec2 P = v_uv * chC;
      float ic = floor((P.x - 3.0) / 6.0 + 0.5);
      float jc = floor((P.y - 3.0) / 6.0 + 0.5);
      bool found = false;
      for (int di = -1; di <= 1; di++) {
        for (int dj = -1; dj <= 1; dj++) {
          float cx = 3.0 + 6.0 * (ic + float(di));
          float cy = 3.0 + 6.0 * (jc + float(dj));
          vec2 d = P - vec2(cx, cy);
          for (int k = 0; k < 4; k++) {
            if (found) continue;
            vec2 rd;
            if (k == 0) rd = d;
            else if (k == 1) rd = vec2(d.y, -d.x);
            else if (k == 2) rd = vec2(-d.x, -d.y);
            else rd = vec2(-d.y, d.x);
            vec2 lu = rd + vec2(3.0, 3.0);
            if (lu.y >= 0.0 && (lu.y - 3.0 * lu.x + 6.0) >= 0.0 && (-lu.x - 3.0 * lu.y + 12.0) >= 0.0 && (lu.x - 3.0 * lu.y + 12.0) >= 0.0 && (3.0 * lu.x + lu.y + 6.0) >= 0.0) {
              role = (k < 2) ? 0 : ((k == 2) ? 1 : 2);
              cf = vec2((lu.x + 3.0) / 6.0, lu.y / 4.0);
              found = true;
            }
          }
        }
      }
    }
```
  NOTE: GLSL uses a `found` flag with `continue` (first-match-wins, mirroring the CPU early-return — once `found`, later candidates are skipped). PLAIN ASCII only. No new uniforms.
- [ ] **Step 5: renderer.ts render()** — no new uniform uploads (cairo=8 resolves via the existing `u_shapeFamily` `indexOf` upload).
- [ ] **Step 6: tests** — add to `texturefx-shapes.unit.spec.ts` a `cairo` describe block. RED→GREEN:
  - **role set:** over a sampled grid at cells=12 (chC=12), assert role set is exactly {0,1,2} (all three appear) and ⊆ {0,1,2}; assert fx,fy ∈ [0,1] for sampled points.
  - **known point:** the right-angle vertex region — a point just inside U near its centroid. U centroid ≈ (0,2); at cells=12, chC=12, world (0,2) ⇒ but world origin maps to a pinwheel; pick a point clearly inside the U-pentagon of center (3,3): e.g. world (0,2) → u=0/12, v=2/12. Assert it returns a role in {0,1,2} (don't over-pin the exact k — the construction is verified; assert membership + coverage instead). [Keep this test about coverage/role-set rather than a brittle exact-k pin.]
  - **3-coloring validity (adjacency):** OPTIONAL but recommended — sample pairs of points straddling a shared edge and assert different roles for a few interior edges (controller verified 0 violations globally; a spot-check guards regressions).
  - **rolesFor:** `rolesFor({mode:'shapes',shapeFamily:'cairo'})` → `['a','b','c']`.
  - **seamless wrap** at cells=12 AND cells=8 (cells=8→chC=12 proves quantize): `region(0,v).role===region(1,v).role` and `region(u,0).role===region(u,1).role` over a sampled grid.
- [ ] **Step 7: verify** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'texturefx/(renderer|shapes|types|roles)' || echo clean` → clean; `npx vitest run tests/unit/texturefx-shapes.unit.spec.ts tests/unit/texturefx-controls.unit.spec.ts` → pass.
- [ ] **Step 8: commit** — `git add frontend/app/lib/texturefx/shapes.ts frontend/app/lib/texturefx/renderer.ts frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/roles.ts frontend/tests/unit/texturefx-shapes.unit.spec.ts` → `feat(texture-studio): Cairo pentagonal tiling shape`.

---

## Task 2: Visual sign-off (controller-driven)
- [ ] Harness: render cairo with per-role fills (a=gradient, b=solid, c=solid; and a 3-color solid) via the REAL committed `shapeRegion` → PNG over a [0,2·chC] span (seam at midline). cells=12 and 18. Confirm: uniform congruent pentagons in 4 orientations pinwheeling (classic Cairo / Victorian-floor look), valid 3-coloring (no two adjacent pentagons share a role), all 3 roles fillable, seamless (no seam at midline), full coverage (no stray fallback regions). Self-sign-off if clean; remove harness; full `npx vitest run` green.

## Self-review
- **Coverage:** cairo, 3 roles a/b/c, pinwheel-of-4 about degree-4 centers, point-in-pentagon via local-frame transform + 5 fixed half-planes, k-only 3-coloring (period-independent ⇒ robustly seamless), dispatch-by-family GLSL, seamless + role-set + adjacency tests. **Type consistency:** SHAPE_FAMILIES order …hex=7/cairo=8 matches GLSL thresholds (<7.5 hex, else cairo) + the `indexOf` upload. **CPU↔GLSL parity:** `chC=6*max(1,round(cells/6))` ↔ `6*max(1,floor(cells/6+0.5))`; `round` ↔ `floor(x+0.5)`; identical rot(-k) by-cases, identical 5 half-plane constants, identical role `[0,0,1,2][k]` and `fx/fy`; GLSL `found`-flag first-match == CPU early-return (full single-coverage verified). **Reuse:** no new uniforms/controls; evalFill + fills untouched; earlier families unchanged. **This completes all 9 shapes.**
```
