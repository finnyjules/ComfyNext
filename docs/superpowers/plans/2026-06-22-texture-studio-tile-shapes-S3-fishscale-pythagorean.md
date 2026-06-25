# Texture Studio — Tile Shapes S3 (fish-scale + Pythagorean) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add two tiling shapes — **fish-scale / clamshell** and **Pythagorean (two-square)** — on the S0–S2 tiling-family rails (sampler + GLSL mirror + roles + fills, all reused).

**Architecture:** Extend `shapes.ts` `shapeRegion` with `fishscale` and `pythagorean` cases; extend the renderer's `u_mode==3` shapes branch dispatch on `u_shapeFamily` (…3=basketweave, 4=herringbone, **5=fishscale, 6=pythagorean**); add the two families to `SHAPE_FAMILIES` (types + roles set) and `ROLES_BY_FAMILY`. No new uniforms, no new controls. Fills panel unchanged.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-tile-shapes-design.md`. Builds on S2 (`76462944b`). **Both geometry formulas below were prototyped + visually confirmed by the controller** (fish-scale = clean scallop armor; Pythagorean = textbook two-square tiling, full coverage, per-tile gradients) — implement them verbatim.

## Global Constraints
- **Seamless by construction.**
  - **Fish-scale** is seamless on any **even** cells (the half-offset row lattice wraps when cells is even — already guaranteed by the step-2 slider). No quantize.
  - **Pythagorean** (squares a=2, b=1) is axis-periodic with period **5** (`a²+b²`). Quantize to a multiple of 5: `chP = max(5, round(cells/5)*5)` (CPU and GLSL identical). Octagon/pinwheel/chevron/basketweave/herringbone are NOT touched.
  - Unit tests assert wrap for both, including a cells value that exercises the Pythagorean quantize (e.g. cells=8 → chP=10).
- ≤3 roles (both use 2). Reuse fills/`evalFill` unchanged. NO backtick/non-ASCII in GLSL. NEVER `git add -A`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. main moves — capture HEAD before dispatch; review by the task's own commit range.

## Geometry (controller-verified)
Helper convention: `gx=u*cells, gy=v*cells` unless a case recomputes its own grid.

- **Fish-scale / clamshell** (2 roles `scale`,`ground`): nearest-center disk on a half-offset lattice.
  - Lattice: centers at `(i + 0.5*(j mod 2), j)` in grid units (rows offset by half).
  - For pixel `(gx,gy)`: search the 3×3 neighborhood of the rounded cell — `jc=round(gy)`, and per row `j` use `off = (j mod 2)*0.5` (use the always-nonnegative form: CPU `(((j%2)+2)%2)*0.5`, GLSL `mod(float(j),2.0)*0.5`), `ic=round(gx-off)`; over `dj,di ∈ {-1,0,1}` compute center `(ic+di+off, j)` and track the min distance `best` and its center `(bcx,bcy)`.
  - `R = 0.55` (fixed). `role = best < R ? 0(scale) : 1(ground)`.
  - **Cell-local coords = scale-center-relative** (so per-scale radial/gradient fills center on each scale): `fx = (gx-bcx)/(2*R) + 0.5`, `fy = (gy-bcy)/(2*R) + 0.5`.
  - Seamless: even cells ⇒ row parity (offset) and integer x-shift both wrap at gx=cells / gy=cells.

- **Pythagorean / two-square** (2 roles `big`,`small`): a=2, b=1, `chP = max(4, ...)` → `max(5, round(cells/5)*5)`.
  - `x=u*chP, y=v*chP`. Lattice `L = m·(a,b) + n·(-b,a)` (orthogonal, |·|²=`s2`=5). Exact lattice coords: `al = (a*x + b*y)/s2`, `be = (-b*x + a*y)/s2`. Candidate base `m0=floor(al), n0=floor(be)`.
  - Over `dm,dn ∈ {-1,0,1}`: `m=m0+dm, n=n0+dn`, `Lx=a*m - b*n`, `Ly=b*m + a*n`.
    - **Large** test: `x∈[Lx,Lx+a) && y∈[Ly,Ly+a)` → `role 0 (big)`, `fx=(x-Lx)/a, fy=(y-Ly)/a`.
    - **Small** test (square at `L+(a,0)`): `x∈[Lx+a,Lx+a+b) && y∈[Ly,Ly+b)` → `role 1 (small)`, `fx=(x-(Lx+a))/b, fy=(y-Ly)/b`.
  - Every pixel matches exactly one square (verified: full coverage, no fallback hit). For safety the CPU function ends with `return {role:1, fx:0, fy:0}` after the loop (unreachable in practice); GLSL ends with `role=1; cf=vec2(0.0);`.
  - Seamless: `chP` mult of 5 ⇒ `(chP,0)` and `(0,chP)` are lattice vectors ⇒ pattern wraps at the tile edges.

> Tile-frame fills unaffected (use `v_uv` directly). Only cell-frame fills consume the per-tile `cf` coords.

---

## Task 1: Samplers + GLSL dispatch + roles + tests

**Files:** Modify `shapes.ts`, `renderer.ts`, `types.ts`, `roles.ts`; Test `texturefx-shapes.unit.spec.ts`.

- [ ] **Step 1: types.ts** — `SHAPE_FAMILIES` append `'fishscale','pythagorean'` (indices 0..4 unchanged ⇒ fishscale=5, pythagorean=6).
- [ ] **Step 2: roles.ts** — `ROLES_BY_FAMILY`: add `fishscale: ['scale','ground']`, `pythagorean: ['big','small']`. Grow the module-local `SHAPE_FAMILIES` set to include both.
- [ ] **Step 3: shapes.ts** — add cases to `shapeRegion` (recompute their own grid; do NOT use the top-level `fx/fy`):
```ts
case 'fishscale': {
  const gxx = u * cells, gyy = v * cells
  const R = 0.55
  const jc = Math.round(gyy)
  let best = 1e9, bcx = 0, bcy = 0
  for (let dj = -1; dj <= 1; dj++) {
    const j = jc + dj
    const off = (((j % 2) + 2) % 2) * 0.5
    const ic = Math.round(gxx - off)
    for (let di = -1; di <= 1; di++) {
      const cxp = ic + di + off, cyp = j
      const d = Math.hypot(gxx - cxp, gyy - cyp)
      if (d < best) { best = d; bcx = cxp; bcy = cyp }
    }
  }
  return { role: best < R ? 0 : 1, fx: (gxx - bcx) / (2 * R) + 0.5, fy: (gyy - bcy) / (2 * R) + 0.5 }
}
case 'pythagorean': {
  const a = 2, b = 1, s2 = 5
  const chP = Math.max(5, Math.round(cells / 5) * 5)
  const x = u * chP, y = v * chP
  const al = (a * x + b * y) / s2, be = (-b * x + a * y) / s2
  const m0 = Math.floor(al), n0 = Math.floor(be)
  for (let dm = -1; dm <= 1; dm++) for (let dn = -1; dn <= 1; dn++) {
    const m = m0 + dm, n = n0 + dn
    const Lx = a * m - b * n, Ly = b * m + a * n
    if (x >= Lx && x < Lx + a && y >= Ly && y < Ly + a) return { role: 0, fx: (x - Lx) / a, fy: (y - Ly) / a }
    const sx = Lx + a, sy = Ly
    if (x >= sx && x < sx + b && y >= sy && y < sy + b) return { role: 1, fx: (x - sx) / b, fy: (y - sy) / b }
  }
  return { role: 1, fx: 0, fy: 0 }
}
```
- [ ] **Step 4: renderer.ts shader** — extend the `u_mode>2.5` dispatch. Gate herringbone to `else if (u_shapeFamily < 4.5)`, then append fishscale (`< 5.5`) and pythagorean (`else`), each setting `role` (an `int`) AND `cf`:
```glsl
    } else if (u_shapeFamily < 5.5) {     // fish-scale / clamshell
      float gx = v_uv.x * u_cells; float gy = v_uv.y * u_cells;
      float R = 0.55;
      float jc = floor(gy + 0.5);
      float best = 1e9; float bcx = 0.0; float bcy = 0.0;
      for (int dj = -1; dj <= 1; dj++) {
        float j = jc + float(dj);
        float off = mod(j, 2.0) * 0.5;
        float ic = floor(gx - off + 0.5);
        for (int di = -1; di <= 1; di++) {
          float cxp = ic + float(di) + off; float cyp = j;
          float d = distance(vec2(gx, gy), vec2(cxp, cyp));
          if (d < best) { best = d; bcx = cxp; bcy = cyp; }
        }
      }
      role = (best < R) ? 0 : 1;
      cf = vec2((gx - bcx) / (2.0 * R) + 0.5, (gy - bcy) / (2.0 * R) + 0.5);
    } else {                              // Pythagorean / two-square
      float a = 2.0; float b = 1.0; float s2 = 5.0;
      float chP = max(5.0, floor(u_cells / 5.0 + 0.5) * 5.0);
      float x = v_uv.x * chP; float y = v_uv.y * chP;
      float al = (a * x + b * y) / s2; float be = (-b * x + a * y) / s2;
      float m0 = floor(al); float n0 = floor(be);
      role = 1; cf = vec2(0.0);
      for (int dm = -1; dm <= 1; dm++) for (int dn = -1; dn <= 1; dn++) {
        float m = m0 + float(dm); float n = n0 + float(dn);
        float Lx = a * m - b * n; float Ly = b * m + a * n;
        if (x >= Lx && x < Lx + a && y >= Ly && y < Ly + a) { role = 0; cf = vec2((x - Lx) / a, (y - Ly) / a); }
        else if (x >= Lx + a && x < Lx + a + b && y >= Ly && y < Ly + b) { role = 1; cf = vec2((x - (Lx + a)) / b, (y - Ly) / b); }
      }
    }
```
  NOTE on the Pythagorean GLSL loop: assigning `role/cf` on match (rather than early-`return` like the CPU) is fine because exactly one of the 9 candidates matches — last-writer-wins equals the single match. Keep CPU's early-return as written. PLAIN ASCII only. `mod`/`floor`/`distance`/`max` are all ES3.0.
- [ ] **Step 5: renderer.ts render()** — no new uniform uploads (indices 5,6 resolve via the existing `SHAPE_FAMILIES.indexOf` upload of `u_shapeFamily`).
- [ ] **Step 6: tests** — add to `texturefx-shapes.unit.spec.ts`, two new `describe` blocks. RED→GREEN:
  - **fishscale:** a scale center maps to role 0 with `fx≈0.5, fy≈0.5` — e.g. with cells=4, center `(0,0)` is at `u=0,v=0`: assert `shapeRegion('fishscale',0,0,4).role===0` and `fx`,`fy` within `0.5±1e-6`. Assert role set ⊆ {0,1} over a sampled grid. Seamless wrap at cells=8: `region(0,v).role===region(1,v).role` and `region(u,0)===region(u,1)` over a sampled grid.
  - **pythagorean:** known points at cells=10 (chP=10): world origin → `role 0` (`shapeRegion('pythagorean',0,0,10).role===0`, fx=0,fy=0); a small-square interior point world `(2.5,0.5)` → `u=0.25,v=0.05` → `role 1`. Assert role set ⊆ {0,1}. Seamless wrap at cells=10 AND cells=8 (cells=8→chP=10 proves the quantize): both axes over a sampled grid.
  - **rolesFor:** `rolesFor({mode:'shapes',shapeFamily:'fishscale'})` → `['scale','ground']`; `…'pythagorean'` → `['big','small']`.
- [ ] **Step 7: verify** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'texturefx/(renderer|shapes|types|roles)' || echo clean` → clean; `npx vitest run tests/unit/texturefx-shapes.unit.spec.ts tests/unit/texturefx-controls.unit.spec.ts` → pass.
- [ ] **Step 8: commit** — `git add frontend/app/lib/texturefx/shapes.ts frontend/app/lib/texturefx/renderer.ts frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/roles.ts frontend/tests/unit/texturefx-shapes.unit.spec.ts` → `feat(texture-studio): fish-scale + Pythagorean tiling shapes`.

---

## Task 2: Visual sign-off (controller-driven)
- [ ] Harness: render fish-scale and Pythagorean (real `shapeRegion` → PNG over a [0,2]² span, seam at midline) with per-role fills (role 0 = gradient, role 1 = solid; and a 2-color solid). fish-scale at cells=6 and 8; Pythagorean at cells=10 and 15. Confirm: fish-scale = offset rows of rounded scallop scales (per-scale shading via center-relative coords); Pythagorean = two-square tiling (large + small squares interlocking, per-square coords); both fillable per-role + seamless 2×2 (no seam at midline). Self-sign-off if clean; remove harness; full `npx vitest run` green.

## Self-review
- **Coverage:** fishscale (half-offset disk lattice, scale-relative coords, fixed R=0.55, no quantize) + pythagorean (two-square membership, period-5 quantize, per-square coords), both 2 roles, dispatch-by-family GLSL, seamless tests incl. the quantize case. **Type consistency:** SHAPE_FAMILIES order …fishscale=5/pythagorean=6 matches GLSL thresholds (<4.5 herring, <5.5 fishscale, else pythag) + the `indexOf` upload. **CPU↔GLSL parity:** `off=mod(j,2)*0.5` matches `(((j%2)+2)%2)*0.5` incl. negative j; `round` ↔ `floor(x+0.5)`; identical R, chP quantize, lattice/membership math; GLSL last-writer-wins == CPU early-return (single match). **Reuse:** no new uniforms/controls; evalFill + fills untouched; earlier families unchanged.
```
