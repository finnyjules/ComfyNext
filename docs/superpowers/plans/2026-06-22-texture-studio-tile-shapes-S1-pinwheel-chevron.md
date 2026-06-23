# Texture Studio — Tile Shapes S1 (pinwheel + chevron) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add two grid-split tiling families — **pinwheel / half-square-triangle** and **chevron** — on the S0 tiling-family rails (sampler + GLSL mirror + roles + fills, all reused).

**Architecture:** Extend `shapes.ts` `shapeRegion` with `pinwheel` and `chevron` cases; refactor the renderer's `u_mode==3` shapes branch into a **dispatch on `u_shapeFamily`** (0=octagon, 1=pinwheel, 2=chevron); add the two families to `SHAPE_FAMILIES` (types + roles set) and `ROLES_BY_FAMILY`; add a `pinwheel` toggle control. Fills panel unchanged.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-tile-shapes-design.md`. Builds on S0 (`6c955dcbb`).

## Global Constraints
- Seamless by construction over the integer `cells` grid (cells is even — the control uses step 2). Unit tests assert wrap. **Chevron needs even cells** (band parity wraps) — already guaranteed by the step-2 control.
- ≤3 roles (both use 2). Reuse fills/`evalFill` unchanged. NO backtick/non-ASCII in GLSL. NEVER `git add -A`. Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. main moves — capture HEAD before dispatch; review by the task's own commit range.

## Geometry
- **Pinwheel / HST:** cell-local `f = fract(uv*cells)`, cell index `(cx,cy)=floor(uv*cells)`.
  - `pinwheel` OFF → HST: role = `(f.x > f.y) ? 0 : 1` (a `\` diagonal split, two triangles a/b).
  - `pinwheel` ON → rotate `f` about the cell centre by `k*90deg` where `k` cycles around 2x2 blocks so the role-0 vanes spin: `k = (cx&1)==0 ? ((cy&1)==0?0:3) : ((cy&1)==0?1:2)`; rotate then apply the same `rf.x > rf.y ? 0 : 1`.
  - `rotateUnit(f,k)`: k0=`(x,y)`, k1=`(y,1-x)`, k2=`(1-x,1-y)`, k3=`(1-y,x)`.
- **Chevron:** `zig = tri(uv.x*cells)` with `tri(x)=abs(fract(x)*2-1)`; `band = floor(uv.y*cells + zig)`; role = `band & 1` (0/1 stripes). Seamless in x (`tri(0)==tri(cells)==1`) and in y for even cells (band parity wraps). `fc = fract(uv*cells)`.

---

## Task 1: Samplers + GLSL dispatch + roles + control + tests

**Files:** Modify `shapes.ts`, `renderer.ts`, `types.ts`, `roles.ts`, `controls.ts`; Test `texturefx-shapes.unit.spec.ts`.

- [ ] **Step 1: types.ts** — `SHAPE_FAMILIES = ['octagon','pinwheel','chevron'] as const` (append the two; octagon stays index 0).
- [ ] **Step 2: roles.ts** — `ROLES_BY_FAMILY`: add `pinwheel: ['a','b']`, `chevron: ['a','b']`. Grow the `SHAPE_FAMILIES` set to include them.
- [ ] **Step 3: shapes.ts** — add cases to `shapeRegion` (mirror the geometry above):
```ts
case 'pinwheel': {
  const cx = Math.floor(gx), cy = Math.floor(gy)
  const pin = _p && (_p as any).pinwheel
  let rx = fx, ry = fy
  if (pin) {
    const k = (cx & 1) === 0 ? ((cy & 1) === 0 ? 0 : 3) : ((cy & 1) === 0 ? 1 : 2)
    if (k === 1) { rx = fy; ry = 1 - fx } else if (k === 2) { rx = 1 - fx; ry = 1 - fy } else if (k === 3) { rx = 1 - fy; ry = fx }
  }
  return { role: rx > ry ? 0 : 1, fx, fy }
}
case 'chevron': {
  const tri = (x: number) => Math.abs((x - Math.floor(x)) * 2 - 1)
  const band = Math.floor(v * cells + tri(u * cells))
  return { role: ((band % 2) + 2) % 2, fx, fy }
}
```
(`gx=u*cells, gy=v*cells, fx=fract(gx), fy=fract(gy)` already computed at the top of `shapeRegion`.)
- [ ] **Step 4: renderer.ts shader** — refactor the shapes branch (`if (u_mode > 2.5)`) so the role is computed by a dispatch on `u_shapeFamily`:
```glsl
if (u_mode > 2.5) {
  vec2 g = v_uv * u_cells;
  vec2 f = fract(g);
  int role = 0;
  if (u_shapeFamily < 0.5) {            // octagon
    float c = 0.29;
    bool corner = (f.x+f.y<c)||((1.0-f.x)+f.y<c)||(f.x+(1.0-f.y)<c)||((1.0-f.x)+(1.0-f.y)<c);
    role = corner ? 1 : 0;
  } else if (u_shapeFamily < 1.5) {     // pinwheel / HST
    float cx = floor(g.x); float cy = floor(g.y);
    vec2 r = f;
    if (u_pinwheel > 0.5) {
      float kx = mod(cx, 2.0); float ky = mod(cy, 2.0);
      float k = (kx < 0.5) ? ((ky < 0.5) ? 0.0 : 3.0) : ((ky < 0.5) ? 1.0 : 2.0);
      if (k > 2.5) r = vec2(1.0 - f.y, f.x);
      else if (k > 1.5) r = vec2(1.0 - f.x, 1.0 - f.y);
      else if (k > 0.5) r = vec2(f.y, 1.0 - f.x);
    }
    role = (r.x > r.y) ? 0 : 1;
  } else {                              // chevron
    float zig = abs(fract(v_uv.x * u_cells) * 2.0 - 1.0);
    float band = floor(v_uv.y * u_cells + zig);
    role = int(mod(band, 2.0));
  }
  frag = vec4(evalFill(role, f, v_uv), 1.0);
  return;
}
```
Add `uniform float u_pinwheel;`. PLAIN-ASCII only.
- [ ] **Step 5: renderer.ts render()** — upload `gl.uniform1f(u('u_pinwheel'), (p as any).pinwheel ? 1 : 0)`.
- [ ] **Step 6: controls.ts** — add `{ key: 'pinwheel', label: 'Pinwheel', kind: 'select', options: ['off','on'], default: 'on', group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'pinwheel' }`. NOTE: the shader/sampler read a truthy `pinwheel`; the control stores `'on'`/`'off'` strings → in render() upload `(String(p.pinwheel) !== 'off') ? 1 : 0`, and in shapes.ts treat `_p.pinwheel !== 'off'` as on (default on). Adjust Steps 3 & 5 to compare against `'off'` so the string control works. (Keep default 'on'.)
- [ ] **Step 7: tests** — add to `texturefx-shapes.unit.spec.ts`: pinwheel HST split (a point with fx>fy → role 0; fx<fy → role 1, pinwheel off); chevron band parity (two points one band apart differ); seamless wrap for both (`region(0,v)==region(1,v)`, `region(u,0)==region(u,1)` over a sampled grid, cells=4) ; rolesFor pinwheel/chevron → ['a','b']. Run RED→GREEN.
- [ ] **Step 8: verify** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'texturefx/(renderer|shapes|controls|types|roles)' || echo clean` → clean; `npx vitest run tests/unit/texturefx-shapes.unit.spec.ts tests/unit/texturefx-controls.unit.spec.ts` → pass.
- [ ] **Step 9: commit** — `git add frontend/app/lib/texturefx/shapes.ts frontend/app/lib/texturefx/renderer.ts frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/roles.ts frontend/app/lib/texturefx/controls.ts frontend/tests/unit/texturefx-shapes.unit.spec.ts` → `feat(texture-studio): pinwheel/HST + chevron tiling shapes`.

---

## Task 2: Visual sign-off (controller-driven)
- [ ] Harness: render pinwheel (on + off/HST) and chevron with per-role fills (a=gradient, b=solid; and a 2-color solid). cells=4 and 6. 2×2 each. Confirm: HST = clean diagonal two-tone; pinwheel = spinning vanes; chevron = zig-zag stripes; all fillable + seamless 2×2. Self-sign-off if clean; remove harness; full `npx vitest run` green.

## Self-review
- **Coverage:** pinwheel(HST+spin toggle) + chevron, both ≤2 roles, dispatch-by-family GLSL, seamless tests. **Type consistency:** SHAPE_FAMILIES order octagon0/pinwheel1/chevron2 matches the GLSL `u_shapeFamily` thresholds + the render upload; `pinwheel` control is a string `'on'/'off'` read consistently in shapes.ts (`!== 'off'`) and render() upload. **Seamless:** integer/even cells; chevron tri wraps; pinwheel periodic.
