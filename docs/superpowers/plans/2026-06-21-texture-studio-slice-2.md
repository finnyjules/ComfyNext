# Texture Studio — Slice 2 (Truchet core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Truchet mode to the Texture Studio — a content-mode picker plus three fully-connected, seamless Truchet tile families (Arcs / Diagonal two-tone / Woven bands) with random per-cell placement, a rotation-state bias, and contextual control reveal — building on the Slice 1 procedural tiler.

**Architecture:** Same CPU-source-of-truth design as Slice 1: the pure-TS `pattern.ts` sampler gains a `mode` branch and a `truchetColor()` path (unit-tested for seamless wrap); the WebGL `renderer.ts` shader mirrors it; the modal surface gains contextual control reveal driven by a `when?(params)` predicate. Truchet tiles use a seamless per-cell state hash (hash of the already-modded cell index), so any placement tiles cleanly.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, WebGL2 GLSL, Vitest (`tests/unit/*.unit.spec.ts`, node env, `~`→`app`). Extends the existing `frontend/app/lib/texturefx/*` and `TextureStudioSurface.vue` from Slice 1 (on main, commits dfca0efb0..b78683634).

---

## Slice roadmap

- **Slice 1 (shipped):** procedural lattice tiler (square/brick/diagonal × checker/stripes/dots/grid).
- **Slice 2 (this plan):** Truchet mode + Arcs/Diagonal/Weave families + random placement + rotation bias + contextual reveal.
- **Slice 2b (next):** Multi-scale arcs (Carlson, cross-scale connectivity), WFC placement, hex lattice.
- **Slice 3+:** stylize (shaderFx), raster content, AI-seamless, SVG/video.

---

## Background: exact current state (Slice 1)

`frontend/app/lib/texturefx/pattern.ts` exports `latticeCell(lattice,cells,u,v) → {cx,cy,fx,fy}` (cx/cy already `posmod(...,cells)`) and `patternColor(p,u,v): RGBA`. Current `patternColor` reads `cells/colorA/colorB/background/scale/lineWeight/jitter/seed/motif`, computes a per-cell `swap` via `hash1(cx*73856093 + cy*19349663 + seed*83492791) < jitter`, then switches on `motif`.

`frontend/app/lib/texturefx/controls.ts` exports `TEXTURE_CONTROLS` (currently typed `ControlSpec[]`) and `textureDefaults()` (= `{ ...defaultsFromControls(TEXTURE_CONTROLS), seed: 1 }`).

`frontend/app/lib/texturefx/sections.ts` exports `TEXTURE_SECTIONS = ['Lattice','Content','Color','Output']`.

`frontend/app/lib/texturefx/types.ts` exports `LATTICES`, `MOTIFS`, `cloneParams`.

`frontend/app/lib/texturefx/renderer.ts` — WebGL2 shader mirroring `pattern.ts`; uniforms set in `render()` from params; `LATTICES`/`MOTIFS` index → `u_lattice`/`u_motif`.

`frontend/app/components/vue-canvas/TextureStudioSurface.vue` — `sections` computed groups `TEXTURE_CONTROLS` by `group` filtered by `TEXTURE_SECTIONS`; template renders slider/select/color per `c.kind`.

**Seamlessness invariant (unchanged):** for integer `cells` (even for brick/diagonal), `patternColor(p,0,v)===patternColor(p,1,v)` ∀v and `patternColor(p,u,0)===patternColor(p,u,1)` ∀u — in BOTH modes. Truchet preserves it because the per-cell state hashes the already-modded `cx`/`cy`.

---

## File structure (Slice 2)

- Modify `frontend/app/lib/texturefx/types.ts` — add `MODES`, `TILE_FAMILIES` const tuples + types.
- Modify `frontend/app/lib/texturefx/sections.ts` — add `'Cell'` and `'Truchet'` groups.
- Modify `frontend/app/lib/texturefx/controls.ts` — extend control type with optional `when?`; add `mode`, `tileFamily`, `rotBias`, `truchetWeight`; tag procedural/Truchet controls with `when`.
- Modify `frontend/app/lib/texturefx/pattern.ts` — add `truchetColor()` + a `mode` branch in `patternColor`.
- Modify `frontend/app/lib/texturefx/renderer.ts` — add Truchet GLSL + `u_mode/u_family/u_rotBias/u_tw` uniforms.
- Modify `frontend/app/components/vue-canvas/TextureStudioSurface.vue` — filter controls by `when(params)` and drop empty sections.
- Modify `frontend/tests/unit/texturefx-pattern.unit.spec.ts` — add Truchet wrap-invariant tests.
- Modify `frontend/tests/unit/texturefx-controls.unit.spec.ts` — assert new sections/defaults and `when` wiring.

---

## Task 1: Types, sections, and controls (mode + Truchet controls + contextual `when`)

**Files:**
- Modify: `frontend/app/lib/texturefx/types.ts`
- Modify: `frontend/app/lib/texturefx/sections.ts`
- Modify: `frontend/app/lib/texturefx/controls.ts`
- Test: `frontend/tests/unit/texturefx-controls.unit.spec.ts`

- [ ] **Step 1: Extend `types.ts`** — append after the existing `MOTIFS` line:

```typescript
export const MODES = ['procedural', 'truchet'] as const
export const TILE_FAMILIES = ['arcs', 'diagonal', 'weave'] as const

export type Mode = typeof MODES[number]
export type TileFamily = typeof TILE_FAMILIES[number]
```

- [ ] **Step 2: Extend `sections.ts`** — replace the `TEXTURE_SECTIONS` array with:

```typescript
// SINGLE SOURCE OF TRUTH — any control whose `group` is not listed here is
// silently dropped from the panel. Guarded by texturefx-controls.unit.spec.ts.
// 'Cell' holds the content-mode picker; 'Content' (procedural) and 'Truchet'
// are shown contextually per mode; 'Output' is reserved for future export controls.
export const TEXTURE_SECTIONS = ['Lattice', 'Cell', 'Content', 'Truchet', 'Color', 'Output'] as const
export type TextureSection = typeof TEXTURE_SECTIONS[number]
```

- [ ] **Step 3: Rewrite `controls.ts`** with the extended control type, the mode picker, contextual `when`, and Truchet controls:

```typescript
import { defaultsFromControls, type ControlSpec, type Params } from '~/lib/spacetype/effect'
import { LATTICES, MODES, MOTIFS, TILE_FAMILIES } from '~/lib/texturefx/types'

// Texture controls extend the shared ControlSpec with an optional `when`
// predicate for contextual reveal (e.g. show procedural controls only in
// procedural mode). The predicate reads the live params object.
export type TextureControl = ControlSpec & { when?: (p: Params) => boolean }

const isProcedural = (p: Params) => String(p.mode) !== 'truchet'
const isTruchet = (p: Params) => String(p.mode) === 'truchet'

export const TEXTURE_CONTROLS: TextureControl[] = [
  { key: 'lattice', label: 'Lattice', kind: 'select', options: [...LATTICES], default: 'square', group: 'Lattice' },
  { key: 'cells', label: 'Cells', kind: 'slider', min: 2, max: 40, step: 2, default: 8, group: 'Lattice' },

  { key: 'mode', label: 'Content', kind: 'select', options: [...MODES], default: 'procedural', group: 'Cell' },

  // Procedural motif controls — shown only in procedural mode.
  { key: 'motif', label: 'Motif', kind: 'select', options: [...MOTIFS], default: 'checker', group: 'Content', when: isProcedural },
  { key: 'scale', label: 'Motif size', kind: 'slider', min: 0.1, max: 1, step: 0.01, default: 0.7, group: 'Content', when: isProcedural },
  { key: 'lineWeight', label: 'Line weight', kind: 'slider', min: 0.02, max: 0.5, step: 0.01, default: 0.12, group: 'Content', when: isProcedural },
  { key: 'jitter', label: 'Color jitter', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Content', when: isProcedural },

  // Truchet controls — shown only in truchet mode.
  { key: 'tileFamily', label: 'Tile family', kind: 'select', options: [...TILE_FAMILIES], default: 'arcs', group: 'Truchet', when: isTruchet },
  { key: 'rotBias', label: 'Rotation bias', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Truchet', when: isTruchet },
  { key: 'truchetWeight', label: 'Line weight', kind: 'slider', min: 0.06, max: 0.5, step: 0.01, default: 0.18, group: 'Truchet', when: isTruchet },

  { key: 'colorA', label: 'Color A', kind: 'color', default: '#e8eef5', group: 'Color' },
  { key: 'colorB', label: 'Color B', kind: 'color', default: '#7aa2f7', group: 'Color' },
  { key: 'background', label: 'Background', kind: 'color', default: '#0e1116', group: 'Color' },
]

// Numeric seed lives outside the control list (driven by the Roll button).
export function textureDefaults(): Params {
  return { ...defaultsFromControls(TEXTURE_CONTROLS), seed: 1 }
}
```

> Note: `defaultsFromControls` ignores the extra `when` field (it only reads `key`/`default`), so it still works unchanged.

- [ ] **Step 4: Update the controls test** — replace `frontend/tests/unit/texturefx-controls.unit.spec.ts` with:

```typescript
import { describe, expect, it } from 'vitest'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { TEXTURE_SECTIONS } from '~/lib/texturefx/sections'

describe('texturefx controls', () => {
  it('defaults include every control key plus seed', () => {
    const d = textureDefaults()
    for (const c of TEXTURE_CONTROLS) expect(d[c.key]).toBe(c.default)
    expect(d.seed).toBe(1)
  })

  it('every control group is in the section allow-list', () => {
    const allowed = new Set<string>(TEXTURE_SECTIONS)
    for (const c of TEXTURE_CONTROLS) {
      expect(c.group, `control "${c.key}" has group "${c.group}"`).toBeDefined()
      expect(allowed.has(String(c.group)), `group "${c.group}" not in TEXTURE_SECTIONS`).toBe(true)
    }
  })

  it('select defaults are valid options', () => {
    for (const c of TEXTURE_CONTROLS) {
      if (c.kind === 'select') expect(c.options).toContain(c.default)
    }
  })

  it('procedural and truchet controls are mutually exclusive via `when`', () => {
    const proc = textureDefaults()                       // mode: 'procedural'
    const tru = { ...textureDefaults(), mode: 'truchet' }
    const motif = TEXTURE_CONTROLS.find((c) => c.key === 'motif')!
    const family = TEXTURE_CONTROLS.find((c) => c.key === 'tileFamily')!
    expect(motif.when!(proc)).toBe(true)
    expect(motif.when!(tru)).toBe(false)
    expect(family.when!(proc)).toBe(false)
    expect(family.when!(tru)).toBe(true)
  })

  it('lattice and color controls have no `when` (always visible)', () => {
    for (const key of ['lattice', 'cells', 'colorA', 'colorB', 'background', 'mode']) {
      expect(TEXTURE_CONTROLS.find((c) => c.key === key)!.when).toBeUndefined()
    }
  })
})
```

- [ ] **Step 5: Run the test**

Run: `cd frontend && npx vitest run tests/unit/texturefx-controls.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/sections.ts frontend/app/lib/texturefx/controls.ts frontend/tests/unit/texturefx-controls.unit.spec.ts
git commit -m "feat(texture-studio): mode picker + Truchet controls with contextual reveal"
```

---

## Task 2: Truchet sampler in `pattern.ts` (CPU source of truth)

**Files:**
- Modify: `frontend/app/lib/texturefx/pattern.ts`
- Test: `frontend/tests/unit/texturefx-pattern.unit.spec.ts`

- [ ] **Step 1: Add the Truchet wrap-invariant tests first** — append inside the existing `describe('patternColor seamlessness', ...)` block in `frontend/tests/unit/texturefx-pattern.unit.spec.ts` (add `TILE_FAMILIES` to the import from `~/lib/texturefx/types`):

```typescript
  // --- Truchet mode ---
  for (const lattice of LATTICES) {
    for (const family of TILE_FAMILIES) {
      it(`truchet ${lattice}/${family} wraps both axes`, () => {
        const p = { ...textureDefaults(), mode: 'truchet', lattice, tileFamily: family, cells: 8, rotBias: 0.6 }
        for (let i = 0; i <= 10; i++) {
          const t = i / 10
          expect(eq(patternColor(p, 0, t), patternColor(p, 1, t)), `x-wrap @ v=${t}`).toBe(true)
          expect(eq(patternColor(p, t, 0), patternColor(p, t, 1)), `y-wrap @ u=${t}`).toBe(true)
        }
      })
    }
  }

  it('truchet diagonal family splits a cell into two colors', () => {
    const p = { ...textureDefaults(), mode: 'truchet', tileFamily: 'diagonal', lattice: 'square', cells: 8, rotBias: 1 }
    // rotBias:1 forces state 0 (split by main diagonal fy<fx). Sample two points either side of the diagonal in cell (0,0).
    const lower = patternColor(p, 0.9 / 8, 0.1 / 8) // fx>fy → one side
    const upper = patternColor(p, 0.1 / 8, 0.9 / 8) // fx<fy → other side
    expect(eq(lower, upper)).toBe(false)
  })
```

- [ ] **Step 2: Run it, confirm failure**

Run: `cd frontend && npx vitest run tests/unit/texturefx-pattern.unit.spec.ts`
Expected: FAIL — Truchet currently isn't implemented, so `mode:'truchet'` falls through to the motif switch (default checker) and the diagonal-split test fails (and/or the family tests are meaningless). This confirms the new behavior isn't there yet.

- [ ] **Step 3: Implement Truchet in `pattern.ts`** — add this helper above `patternColor`:

```typescript
// --- Truchet families ------------------------------------------------------
// Per-cell state ∈ {0,1} chosen by a seamless hash of the already-modded cell
// index (so it wraps), biased by rotBias. Each family is fully edge-connected
// and tiles seamlessly for any state combination.
function truchetColor(
  fam: string, fx: number, fy: number, cx: number, cy: number, state: number, tw: number,
  A: [number, number, number], B: [number, number, number], BG: [number, number, number],
): RGBA {
  const out = (c: [number, number, number]): RGBA => [c[0], c[1], c[2], 1]
  if (fam === 'diagonal') {
    // state 0: split by main diagonal (ink below fy<fx); state 1: anti-diagonal.
    const side = state === 0 ? fy < fx : fy < 1 - fx
    return out(side ? A : B)
  }
  if (fam === 'weave') {
    // Warp (vertical, A) and weft (horizontal, B) bands; at crossings the
    // cell parity decides which is on top. Gaps show background. Bands span the
    // full cell so they connect across edges → seamless. Fixed band width.
    const bw = 0.62
    const inV = Math.abs(fx - 0.5) < bw * 0.5
    const inH = Math.abs(fy - 0.5) < bw * 0.5
    const warpOnTop = posmod(cx + cy, 2) === 0
    if (inV && inH) return out(warpOnTop ? A : B)
    if (inV) return out(A)
    if (inH) return out(B)
    return out(BG)
  }
  // arcs (Smith): two quarter-circle arcs joining edge midpoints. state 0 joins
  // corners (0,0)&(1,1); state 1 joins (1,0)&(0,1). Either way all four edge
  // midpoints are arc endpoints, so neighbours always connect → seamless.
  const c0x = state === 0 ? 0 : 1, c0y = 0
  const c1x = state === 0 ? 1 : 0, c1y = 1
  const d0 = Math.abs(Math.hypot(fx - c0x, fy - c0y) - 0.5)
  const d1 = Math.abs(Math.hypot(fx - c1x, fy - c1y) - 0.5)
  return (d0 < tw * 0.5 || d1 < tw * 0.5) ? out(A) : out(BG)
}
```

Then, inside `patternColor`, replace the section from `const { cx, cy, fx, fy } = latticeCell(...)` through the `switch (motif)` with:

```typescript
  const { cx, cy, fx, fy } = latticeCell(String(p.lattice), cells, u, v)

  if (String(p.mode) === 'truchet') {
    const tw = Number(p.truchetWeight) || 0.18
    const rotBias = Number(p.rotBias)
    const bias = Number.isFinite(rotBias) ? rotBias : 0.5
    const h = hash1(cx * 73856093 + cy * 19349663 + seed * 83492791)
    const state = h < bias ? 0 : 1
    return truchetColor(String(p.tileFamily), fx, fy, cx, cy, state, tw, A, B, BG)
  }

  const swap = jitter > 0 && hash1(cx * 73856093 + cy * 19349663 + seed * 83492791) < jitter
  const ink: [number, number, number] = swap ? B : A
  const ink2: [number, number, number] = swap ? A : B

  const out = (c: [number, number, number]): RGBA => [c[0], c[1], c[2], 1]

  switch (motif) {
    // ...unchanged motif switch...
```

(Keep the existing `switch (motif)` body exactly as-is below this.)

- [ ] **Step 4: Run the test, confirm pass**

Run: `cd frontend && npx vitest run tests/unit/texturefx-pattern.unit.spec.ts`
Expected: PASS — all Slice 1 tests plus the new Truchet wrap tests (3 lattices × 3 families) and the diagonal-split test.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/texturefx/pattern.ts frontend/tests/unit/texturefx-pattern.unit.spec.ts
git commit -m "feat(texture-studio): Truchet sampler (arcs/diagonal/weave) + wrap tests"
```

---

## Task 3: Mirror Truchet in the WebGL shader (`renderer.ts`)

**Files:**
- Modify: `frontend/app/lib/texturefx/renderer.ts`

> No headless test (WebGL unavailable in node env). The GLSL must mirror `pattern.ts`'s Truchet math exactly; verified visually in Task 5.

- [ ] **Step 1: Read the current `truchetColor` in `pattern.ts`** and confirm the exact constants before writing GLSL (bw 0.62; arc centers; diagonal split; weave parity). Mirror whatever is actually there.

- [ ] **Step 2: Add the Truchet uniforms to the fragment shader uniform block** — in `renderer.ts`, change the `uniform float ...;` line that declares `u_cells, u_lattice, ...` to also declare:

```glsl
uniform float u_mode, u_family, u_rotBias, u_tw;
```

- [ ] **Step 3: Add Truchet GLSL + a mode branch** — in the fragment shader `main()`, immediately AFTER `cx`/`cy`/`fx`/`fy` are computed and BEFORE the existing `swap`/motif block, insert:

```glsl
  if (u_mode > 0.5) { // truchet
    float h = hash1(cx*73856093.0 + cy*19349663.0 + u_seed*83492791.0);
    float st = (h < u_rotBias) ? 0.0 : 1.0;
    vec3 col;
    if (u_family < 0.5) {            // arcs
      vec2 a = (st < 0.5) ? vec2(0.0,0.0) : vec2(1.0,0.0);
      vec2 b = (st < 0.5) ? vec2(1.0,1.0) : vec2(0.0,1.0);
      float d0 = abs(distance(vec2(fx,fy), a) - 0.5);
      float d1 = abs(distance(vec2(fx,fy), b) - 0.5);
      col = (d0 < u_tw*0.5 || d1 < u_tw*0.5) ? u_a : u_bg;
    } else if (u_family < 1.5) {     // diagonal two-tone
      bool side = (st < 0.5) ? (fy < fx) : (fy < 1.0 - fx);
      col = side ? u_a : u_b;
    } else {                          // weave
      float bw = 0.62;
      bool inV = abs(fx - 0.5) < bw*0.5;
      bool inH = abs(fy - 0.5) < bw*0.5;
      bool warpTop = posmod(cx+cy, 2.0) == 0.0;
      if (inV && inH) col = warpTop ? u_a : u_b;
      else if (inV) col = u_a;
      else if (inH) col = u_b;
      else col = u_bg;
    }
    frag = vec4(col, 1.0);
    return;
  }
```

- [ ] **Step 4: Set the new uniforms in `render()`** — add `MODES` and `TILE_FAMILIES` to the import from `~/lib/texturefx/types`, then in `render()` alongside the other `gl.uniform1f(...)` calls add:

```typescript
    gl.uniform1f(u('u_mode'), Math.max(0, MODES.indexOf(String(p.mode) as any)))
    gl.uniform1f(u('u_family'), Math.max(0, TILE_FAMILIES.indexOf(String(p.tileFamily) as any)))
    gl.uniform1f(u('u_rotBias'), Number.isFinite(Number(p.rotBias)) ? Number(p.rotBias) : 0.5)
    gl.uniform1f(u('u_tw'), Number(p.truchetWeight) || 0.18)
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep texturefx/renderer || echo "no texturefx/renderer type errors"`
Expected: `no texturefx/renderer type errors`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/texturefx/renderer.ts
git commit -m "feat(texture-studio): mirror Truchet families in the WebGL shader"
```

---

## Task 4: Contextual control reveal in the surface

**Files:**
- Modify: `frontend/app/components/vue-canvas/TextureStudioSurface.vue`

- [ ] **Step 1: Switch the control type import** — change the import on line 8 from `import type { ControlSpec, Params } from '~/lib/spacetype/effect'` to:

```typescript
import type { Params } from '~/lib/spacetype/effect'
import type { TextureControl } from '~/lib/texturefx/controls'
```

- [ ] **Step 2: Filter controls by `when(params)` and drop empty sections** — replace the `sections` computed (currently lines ~48-57) with:

```typescript
// Group visible controls by section, in TEXTURE_SECTIONS order. A control with
// a `when` predicate is shown only when it returns true for the current params
// (contextual reveal); sections with no visible controls are omitted.
const sections = computed(() => {
  const byGroup = new Map<string, TextureControl[]>()
  for (const c of TEXTURE_CONTROLS as TextureControl[]) {
    if (c.when && !c.when(params)) continue
    const g = String(c.group)
    if (!(TEXTURE_SECTIONS as readonly string[]).includes(g)) continue
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(c)
  }
  return TEXTURE_SECTIONS
    .filter((g) => byGroup.has(g) && byGroup.get(g)!.length > 0)
    .map((g) => ({ title: g, controls: byGroup.get(g)! }))
})
```

> The computed reads `params` inside `c.when(params)`, so it reactively re-groups when `mode` (or any param) changes — switching mode hides/shows the Content/Truchet sections live.

- [ ] **Step 3: Verify the dev server compiles**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep TextureStudioSurface || echo "no TextureStudioSurface type errors"`
Expected: `no TextureStudioSurface type errors`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/TextureStudioSurface.vue
git commit -m "feat(texture-studio): contextual control reveal by mode"
```

---

## Task 5: Visual verification + sign-off

**Files:** (temporary, removed after sign-off) `frontend/app/pages/texture-harness.vue`

> Mirrors Slice 1's verification. Render the REAL `textureFx` for each lattice × Truchet family (and a couple of rotBias values), each tiled 2×2, screenshot, and get user sign-off on the look before completing the slice. The controller drives this step.

- [ ] **Step 1: Write a temporary harness page** rendering `textureFx` in truchet mode for the 3 families × 3 lattices, each drawn 2×2 (use the same structure as Slice 1's harness but set `mode:'truchet'`, iterate `TILE_FAMILIES`, `cells:8`, `rotBias:0.5`, `truchetWeight:0.18`). Import `TILE_FAMILIES` and `LATTICES` from `~/lib/texturefx/types`.

- [ ] **Step 2: Screenshot via the running dev server** (Playwright against `http://127.0.0.1:<port>/texture-harness`, deviceScaleFactor 2, fullPage) and inspect every 2×2 tile for: (a) no shader compile error, (b) no visible seam at tile mid-lines, (c) arcs visibly connect across cells, (d) diagonal/weave read correctly.

- [ ] **Step 3: Present the screenshot and get explicit user sign-off** on the Truchet look. Iterate `pattern.ts` + the shader together (keep them mirrored) on any look feedback before proceeding.

- [ ] **Step 4: Remove the temporary harness page, run the full unit suite, commit**

```bash
cd frontend && rm -f app/pages/texture-harness.vue && npm run test:unit
git add -A && git commit -m "test(texture-studio): Truchet visual sign-off (harness removed)" --allow-empty
```

---

## Self-review (completed)

- **Spec coverage (Slice 2 scope):** Truchet first-class mode ✓ (Task 1 mode picker, Tasks 2-3 families); Arcs/Diagonal/Weave families ✓; random placement via seamless per-cell state ✓; rotation bias ✓ (`rotBias`); palette via existing colorA/B/background ✓; contextual reveal ✓ (Task 4). **Explicitly deferred to Slice 2b (noted in roadmap):** multi-scale (Carlson) family, per-state weight vector (replaced by single `rotBias` for Slice 2), WFC placement, hex lattice.
- **Placeholder scan:** none; every code step is complete; commands have expected output.
- **Type consistency:** `MODES`/`TILE_FAMILIES` defined in Task 1 and consumed in Tasks 2-3-5; `TextureControl` (with `when`) defined in Task 1 `controls.ts` and consumed in Task 4 surface; `truchetColor` signature defined in Task 2 and mirrored as GLSL in Task 3; param keys (`mode`,`tileFamily`,`rotBias`,`truchetWeight`) identical across controls/pattern/renderer; the per-cell state hash (`cx*73856093 + cy*19349663 + seed*83492791`) is byte-identical between `pattern.ts` and the shader, guaranteeing matching placement.
- **Seamlessness:** every Truchet family hashes the already-modded `cx`/`cy` and uses only intra-cell coords + cell parity, so the Slice 1 wrap invariant holds in truchet mode; Task 2 tests assert it for all 9 lattice×family combos.
