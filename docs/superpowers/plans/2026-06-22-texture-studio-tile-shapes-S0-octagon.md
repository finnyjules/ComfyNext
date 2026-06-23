# Texture Studio — Tile Shapes S0 (scaffolding + octagon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up the `shapes` mode end-to-end — a `shapeRegion(family,u,v,cells)→{role,fx,fy}` tiling-family abstraction (CPU + GLSL) wired into the existing fill system — proven with the first shape, **octagon + square**.

**Architecture:** A new `shapes.ts` pure sampler (unit-tested, source of truth) mirrored by a GLSL `u_mode==3` branch that computes the role + cell-local coords and calls the existing `evalFill(role, fc, tc)`. New `'shapes'` MODE + `SHAPE_FAMILIES` enum (S0 = just `octagon`); `rolesFor`/`activeFamily` gain a shapes branch. The Fills panel needs NO changes (it loops `rolesFor`).

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-tile-shapes-design.md`.

## Global Constraints
- Seamless by construction: `shapeRegion` is periodic over an integer `cells` grid → `region(0,v)==region(1,v)`, `region(u,0)==region(u,1)`. Unit tests assert it.
- Reuse the fill system unchanged (≤3 roles; octagon = 2). No change to `evalFill`/fill uniforms.
- Shader is a JS template literal — NO backtick/non-ASCII in GLSL comments. NEVER `git add -A`. Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- main moves under us (concurrent user commits) — controller captures HEAD before each dispatch; review each task by its own commit range.
- S0 adds ONLY `octagon` to `SHAPE_FAMILIES` (so the picker shows only working shapes; later slices add their families with geometry).

---

## Task 1: Data model + `shapes.ts` octagon sampler + tests

**Files:** Modify `types.ts`, `roles.ts`; Create `shapes.ts`; Test `tests/unit/texturefx-shapes.unit.spec.ts`.

**Interfaces — Produces:** `MODES` includes `'shapes'`; `SHAPE_FAMILIES=['octagon']`; `ROLES_BY_FAMILY.octagon=['tile','joint']`; `shapeRegion(family,u,v,cells,params?)→{role,fx,fy}`; `rolesFor`/`activeFamily` resolve shapes mode.

- [ ] **Step 1: types.ts** — `export const MODES = ['procedural','truchet','raster','shapes'] as const` (append 'shapes' — index 3). Add `export const SHAPE_FAMILIES = ['octagon'] as const` and `export type ShapeFamily = typeof SHAPE_FAMILIES[number]`.

- [ ] **Step 2: roles.ts** — add to `ROLES_BY_FAMILY`: `octagon: ['tile', 'joint']`. Add `const SHAPE_FAMILIES = new Set(['octagon'])` (or import from types). Extend `activeFamily`: when `String(p.mode)==='shapes'` return `String(p.shapeFamily)`. Extend `rolesFor`: add `if (mode === 'shapes' && !SHAPE_FAMILIES.has(family)) return ['a','b']` before the final `ROLES_BY_FAMILY[family] ?? ['a','b']`. (When more shapes are added later, grow this set.)

- [ ] **Step 3: shapes.ts** (new):
```ts
import type { Params } from '~/lib/spacetype/effect'

export type ShapeRegion = { role: number; fx: number; fy: number }

// Pure, seamless tiling-family sampler. u,v in [0,1]; integer `cells`.
// Returns the role index a pixel belongs to + its cell-local coords (fx,fy).
// Mirrored by the GLSL shapeRegion branch in renderer.ts.
export function shapeRegion(family: string, u: number, v: number, cells: number, _p?: Params): ShapeRegion {
  const gx = u * cells, gy = v * cells
  const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy)
  switch (family) {
    case 'octagon': {
      // Octagon tile (role 0); the 4 corner triangles (chamfer c) are the
      // "joint" (role 1) -- they merge across 4 cells into the small square.
      const c = 0.29
      const corner = (fx + fy < c) || ((1 - fx) + fy < c) || (fx + (1 - fy) < c) || ((1 - fx) + (1 - fy) < c)
      return { role: corner ? 1 : 0, fx, fy }
    }
    default:
      return { role: 0, fx, fy }
  }
}
```

- [ ] **Step 4: write the failing test** `tests/unit/texturefx-shapes.unit.spec.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { shapeRegion } from '~/lib/texturefx/shapes'
import { rolesFor } from '~/lib/texturefx/roles'

describe('shapeRegion octagon', () => {
  it('center of a cell is the octagon tile (role 0)', () => {
    expect(shapeRegion('octagon', 0.5 / 4, 0.5 / 4, 4).role).toBe(0) // first cell center, cells=4
  })
  it('cell corner is the joint (role 1)', () => {
    expect(shapeRegion('octagon', 0.001, 0.001, 4).role).toBe(1)
  })
  it('seamless: u=0 edge matches u=1 edge', () => {
    for (let i = 0; i <= 8; i++) { const v = i / 8
      expect(shapeRegion('octagon', 0, v, 4).role).toBe(shapeRegion('octagon', 1, v, 4).role)
      expect(shapeRegion('octagon', v, 0, 4).role).toBe(shapeRegion('octagon', v, 1, 4).role)
    }
  })
})
describe('rolesFor shapes mode', () => {
  it('octagon resolves its roles', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'octagon' } as any)).toEqual(['tile', 'joint'])
  })
  it('unknown shape family falls back', () => {
    expect(rolesFor({ mode: 'shapes', shapeFamily: 'nope' } as any)).toEqual(['a', 'b'])
  })
})
```
Run RED (missing module), implement steps 1-3, run GREEN: `npx vitest run tests/unit/texturefx-shapes.unit.spec.ts`.

- [ ] **Step 5: commit** — `git add frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/roles.ts frontend/app/lib/texturefx/shapes.ts frontend/tests/unit/texturefx-shapes.unit.spec.ts` → `feat(texture-studio): shapes mode scaffolding + octagon region sampler`.

---

## Task 2: Renderer `shapes` branch + GLSL octagon + `shapeFamily` control

**Files:** Modify `renderer.ts`, `controls.ts`.

**Interfaces — Consumes:** `shapeRegion` semantics (mirrored in GLSL), `evalFill`, `SHAPE_FAMILIES`.

- [ ] **Step 1: renderer.ts shader** — add `uniform float u_shapeFamily;`. Add the shapes branch **before** the raster branch (raster is `u_mode > 1.5`; shapes index 3 must be caught first). Right where the raster `if (u_mode > 1.5)` begins, prepend:
```glsl
// shapes mode (MODES index 3) -- geometric tiling families. Mirrors shapes.ts.
if (u_mode > 2.5) {
  vec2 g = v_uv * u_cells;
  vec2 f = fract(g);
  int role = 0;
  // u_shapeFamily: 0 = octagon (SHAPE_FAMILIES order)
  // octagon: 4 corner triangles (chamfer c) are joint(role1), rest tile(role0)
  float c = 0.29;
  bool corner = (f.x + f.y < c) || ((1.0 - f.x) + f.y < c) || (f.x + (1.0 - f.y) < c) || ((1.0 - f.x) + (1.0 - f.y) < c);
  role = corner ? 1 : 0;
  frag = vec4(evalFill(role, f, v_uv), 1.0);
  return;
}
```
(Keep the existing raster `if (u_mode > 1.5)` after it — since shapes returns, raster only runs for index 2. Confirm `v_uv` and `u_cells` are the correct varying/uniform names already in the shader.) PLAIN-ASCII comments only.

- [ ] **Step 2: renderer.ts render()** — import `SHAPE_FAMILIES` from `~/lib/texturefx/types`; upload `gl.uniform1f(u('u_shapeFamily'), Math.max(0, SHAPE_FAMILIES.indexOf(String(p.shapeFamily) as any)))`. (Place near the `u_family` upload.)

- [ ] **Step 3: controls.ts** — add `const isShapes = (p: Params) => String(p.mode) === 'shapes'`. Add a control: `{ key: 'shapeFamily', label: 'Shape', kind: 'select', options: [...SHAPE_FAMILIES], default: 'octagon', group: 'Cell', when: isShapes }` (import `SHAPE_FAMILIES`). The `mode` select already spreads `[...MODES]`, so `'shapes'` appears automatically. `cells` already shows for non-raster, so it reveals in shapes mode. No other controls needed for octagon.

- [ ] **Step 4: verify** — `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'texturefx/(renderer|controls)' || echo clean` → `clean` (flood = broken template literal). `npx vitest run tests/unit/texturefx-shapes.unit.spec.ts tests/unit/texturefx-controls.unit.spec.ts` → pass. (No render test — visual in Task 3.)

- [ ] **Step 5: commit** — `git add frontend/app/lib/texturefx/renderer.ts frontend/app/lib/texturefx/controls.ts` → `feat(texture-studio): renderer shapes branch + octagon GLSL + shapeFamily control`.

---

## Task 3: Visual sign-off (controller-driven)
- [ ] Harness (bundle `~/lib/texturefx/renderer` + `controls`): render `{mode:'shapes', shapeFamily:'octagon', cells:4}` with: (a) default (back-compat colors via legacyFill), (b) per-role fills — `tile` = a gradient, `joint` = a solid accent — 2×2 each. Confirm the octagon+square pattern renders, both regions are independently fillable, and it tiles seamlessly (the joints form continuous small squares at the 2×2 seam). Self-sign-off if clean; remove harness. Full `npx vitest run` green.

---

## Self-review
- **Spec coverage (S0):** `shapes` mode + `shapeRegion` abstraction (CPU+GLSL) ✓; octagon family with [tile,joint] roles ✓; mode-scoped `rolesFor` ✓; fill system reused unchanged (octagon regions fillable) ✓; shapeFamily/cells UI ✓; seamless unit tests ✓. Other 8 shapes are later slices (S1–S5).
- **Placeholders:** all code complete (sampler, GLSL, control, tests).
- **Type consistency:** `shapeRegion(family,u,v,cells,params?)→{role,fx,fy}` used by tests + mirrored by GLSL; `SHAPE_FAMILIES` (S0=['octagon']) drives the enum, the `u_shapeFamily` upload, and the picker; role index 0=tile,1=joint consistent CPU↔GLSL↔roles.
- **Seamless:** integer-cells periodicity; corner-triangle joints merge across cells (unit-tested edge match).
