# Texture Studio — Slice 2b-2 (Multi-scale arcs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `multiscale` Truchet family — arcs where clustered regions subdivide 3× into finer arcs (Carlson-style dense/calm rhythm), staying seamless and (at edge midpoints) connected across scales.

**Architecture:** Per base cell, a precomputed toroidal **level field** (0 = whole-cell arc, 1 = 3×3 subdivided) drives subdivision; it reuses the Slice 2b-1 R8 state-texture pipeline (exact CPU/GPU agreement). Arc coverage is factored into a shared `arcCoverage()` used by both the `arcs` family and each multiscale sub-tile. **3× (odd) subdivision** keeps the center sub-tile on each edge aligned with the parent edge midpoint, so subdivided cells connect to coarse neighbors. Arc orientation per (sub)tile is a seamless per-cell hash (connectivity is orientation-independent).

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 (reuses the R8 level texture + texelFetch), Vitest. Extends `frontend/app/lib/texturefx/*`.

---

## Background: exact current state (post Slice 2b-1)

`pattern.ts`: `truchetColor(fam, fx, fy, cx, cy, state, tw, A, B, BG)` — the `arcs` default case computes `c0/c1` centers per `state` and inks `A` where `|hypot-0.5| < tw*0.5`. `truchetStates(cells,seed,coherence)` + `cachedStates` exist. `patternColor` truchet branch: structured→grid state, random→`cellHash<bias`.

`renderer.ts`: shader truchet branch — `arcs`(u_family<0.5)/`diagonal`/`weave`; state from `u_stateTex` (when `u_placement>0.5`) or hash. `render()` uploads `truchetStates` grid to `u_stateTex` (R8) when structured, else 1×1.

`controls.ts`: Truchet group = tileFamily, placement, rotBias(when random), coherence(when structured), truchetWeight. `types.ts`: `TILE_FAMILIES=['arcs','diagonal','weave']`.

**Invariant:** seamless wrap in all modes; level/state grids toroidal.

---

## File structure

- Modify `types.ts` — add `'multiscale'` to `TILE_FAMILIES`.
- Modify `controls.ts` — add `subdivide` slider (multiscale only); hide placement/rotBias/coherence for multiscale.
- Modify `pattern.ts` — factor `arcCoverage()`; add `multiscaleLevels()` + memo; multiscale branch in `patternColor`.
- Modify `renderer.ts` — upload level grid for multiscale; shader multiscale branch (3× descent) + shared `arcCov()` GLSL.
- Modify `tests/unit/texturefx-controls.unit.spec.ts` + `texturefx-pattern.unit.spec.ts`.

---

## Task 1: Add the `multiscale` family + `subdivide` control

**Files:** `types.ts`, `controls.ts`, `tests/unit/texturefx-controls.unit.spec.ts`

- [ ] **Step 1: types.ts** — change `TILE_FAMILIES`:
```typescript
export const TILE_FAMILIES = ['arcs', 'diagonal', 'weave', 'multiscale'] as const
```

- [ ] **Step 2: controls.ts** — replace the Truchet control block. `subdivide` shows for multiscale; placement/rotBias/coherence hide for multiscale (multiscale has its own subdivision, not placement):
```typescript
  // Truchet controls — shown only in truchet mode.
  { key: 'tileFamily', label: 'Tile family', kind: 'select', options: [...TILE_FAMILIES], default: 'arcs', group: 'Truchet', when: isTruchet },
  { key: 'placement', label: 'Placement', kind: 'select', options: [...PLACEMENTS], default: 'random', group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'multiscale' },
  { key: 'rotBias', label: 'Rotation bias', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'multiscale' && String(p.placement) === 'random' },
  { key: 'coherence', label: 'Coherence', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'multiscale' && String(p.placement) === 'structured' },
  { key: 'subdivide', label: 'Subdivide', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) === 'multiscale' },
  { key: 'truchetWeight', label: 'Line weight', kind: 'slider', min: 0.06, max: 0.5, step: 0.01, default: 0.18, group: 'Truchet', when: isTruchet },
```

- [ ] **Step 3: controls test** — append inside the existing `describe`:
```typescript
  it('subdivide shows only for multiscale; placement hidden for multiscale', () => {
    const tru = { ...textureDefaults(), mode: 'truchet' }
    const multi = { ...textureDefaults(), mode: 'truchet', tileFamily: 'multiscale' }
    const subdivide = TEXTURE_CONTROLS.find((c) => c.key === 'subdivide')!
    const placement = TEXTURE_CONTROLS.find((c) => c.key === 'placement')!
    expect(subdivide.when!(tru)).toBe(false)
    expect(subdivide.when!(multi)).toBe(true)
    expect(placement.when!(multi)).toBe(false)
    expect(placement.when!(tru)).toBe(true)
  })

  it('multiscale is a valid tileFamily option with a default', () => {
    const fam = TEXTURE_CONTROLS.find((c) => c.key === 'tileFamily')!
    expect(fam.kind === 'select' && fam.options.includes('multiscale')).toBe(true)
    expect(textureDefaults().subdivide).toBe(0.5)
  })
```

- [ ] **Step 4: Run** — `cd frontend && npx vitest run tests/unit/texturefx-controls.unit.spec.ts` → all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat(texture-studio): multiscale family + subdivide control"`

---

## Task 2: `arcCoverage` + `multiscaleLevels` + multiscale sampler

**Files:** `pattern.ts`, `tests/unit/texturefx-pattern.unit.spec.ts`

- [ ] **Step 1: Add tests first** — append to `texturefx-pattern.unit.spec.ts` (add `multiscaleLevels` to the pattern import):
```typescript
describe('multiscaleLevels', () => {
  it('is deterministic + cells*cells + 0/1', () => {
    const a = multiscaleLevels(8, 7, 0.5)
    const b = multiscaleLevels(8, 7, 0.5)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(a.length).toBe(64)
    for (const v of a) expect(v === 0 || v === 1).toBe(true)
  })
  it('subdivide 0 → all level 0; subdivide 1 → all level 1', () => {
    expect(Array.from(multiscaleLevels(8, 7, 0)).every((v) => v === 0)).toBe(true)
    expect(Array.from(multiscaleLevels(8, 7, 1)).every((v) => v === 1)).toBe(true)
  })
})

describe('multiscale seamlessness', () => {
  it('multiscale/square wraps both axes', () => {
    const p = { ...textureDefaults(), mode: 'truchet', tileFamily: 'multiscale', lattice: 'square', cells: 8, subdivide: 0.6, truchetWeight: 0.18 }
    for (let i = 0; i <= 10; i++) {
      const t = i / 10
      expect(eq(patternColor(p, 0, t), patternColor(p, 1, t)), `x-wrap @ v=${t}`).toBe(true)
      expect(eq(patternColor(p, t, 0), patternColor(p, t, 1)), `y-wrap @ u=${t}`).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run, confirm fail** — `npx vitest run tests/unit/texturefx-pattern.unit.spec.ts` → fails (`multiscaleLevels` not exported).

- [ ] **Step 3: Implement in `pattern.ts`.**

(a) Factor the arc coverage out (above `truchetColor`):
```typescript
// True where pixel (fx,fy) lies on one of the two quarter-circle arcs for `state`.
// state 0 joins corners (0,0)&(1,1); state 1 joins (1,0)&(0,1). Either way the
// arcs hit all four edge midpoints, so neighbours connect.
function arcCoverage(fx: number, fy: number, state: number, tw: number): boolean {
  const c0x = state === 0 ? 0 : 1, c0y = 0
  const c1x = state === 0 ? 1 : 0, c1y = 1
  const d0 = Math.abs(Math.hypot(fx - c0x, fy - c0y) - 0.5)
  const d1 = Math.abs(Math.hypot(fx - c1x, fy - c1y) - 0.5)
  return d0 < tw * 0.5 || d1 < tw * 0.5
}
```
Then in `truchetColor`, replace the `arcs` (default) case body with: `return arcCoverage(fx, fy, state, tw) ? out(A) : out(BG)`.

(b) Add the level field + memo:
```typescript
// Per-base-cell subdivision level (0 = whole-cell arc, 1 = 3×3 subdivided).
// A toroidal coherent value field thresholded at `subdivide`, so subdivided
// regions cluster and the tile wraps.
export function multiscaleLevels(cells: number, seed: number, subdivide: number): Uint8Array {
  const sd = clamp01(subdivide)
  const val = new Float64Array(cells * cells)
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) val[y * cells + x] = hash1(x * 60493 + y * 19990303 + seed * 6151)
  }
  for (let pass = 0; pass < 2; pass++) {
    const g = val.slice()
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const up = val[((y - 1 + cells) % cells) * cells + x], dn = val[((y + 1) % cells) * cells + x]
        const lf = val[y * cells + ((x - 1 + cells) % cells)], rt = val[y * cells + ((x + 1) % cells)]
        g[y * cells + x] = (val[y * cells + x] + up + dn + lf + rt) / 5
      }
    }
    val.set(g)
  }
  const out = new Uint8Array(cells * cells)
  for (let i = 0; i < out.length; i++) out[i] = val[i] < sd ? 1 : 0
  return out
}

let _levelCache: { key: string, grid: Uint8Array } | null = null
function cachedLevels(cells: number, seed: number, subdivide: number): Uint8Array {
  const key = `${cells}|${seed}|${subdivide}`
  if (!_levelCache || _levelCache.key !== key) _levelCache = { key, grid: multiscaleLevels(cells, seed, subdivide) }
  return _levelCache.grid
}
```
> `subdivide=0` → `val < 0` never true → all 0; `subdivide=1` → `val < 1` always (hash1∈[0,1)) → all 1. Matches the test.

(c) In `patternColor`'s truchet branch, BEFORE the existing placement `if`, special-case multiscale:
```typescript
    if (String(p.tileFamily) === 'multiscale') {
      const tw = Number(p.truchetWeight) || 0.18
      const level = cachedLevels(cells, seed, clamp01(Number(p.subdivide) || 0))[cy * cells + cx]
      let lfx = fx, lfy = fy, sub = 0
      if (level >= 1) {
        const sx = Math.min(2, Math.floor(fx * 3)), sy = Math.min(2, Math.floor(fy * 3))
        lfx = fx * 3 - sx; lfy = fy * 3 - sy; sub = sx * 3 + sy + 1
      }
      const st = hash1(cx * 73856093 + cy * 19349663 + sub * 50331653 + seed * 83492791) < 0.5 ? 0 : 1
      return arcCoverage(lfx, lfy, st, tw) ? out(A) : out(BG)
    }
```
(`cells`, `seed`, `cx`, `cy`, `fx`, `fy`, `A`, `BG`, `out` are in scope. Keep the existing placement/family logic below for the other families.)

- [ ] **Step 4: Run, confirm pass** — `npx vitest run tests/unit/texturefx-pattern.unit.spec.ts` → all pass (incl. multiscale wrap + levels). Existing arcs/diagonal/weave tests still pass (arcCoverage refactor is behavior-preserving).

- [ ] **Step 5: Commit** — `git commit -m "feat(texture-studio): multiscale arcs sampler (3x subdivision, level field)"`

---

## Task 3: Mirror multiscale in the shader

**Files:** `renderer.ts`

- [ ] **Step 1: Read** the current shader truchet branch + the `render()` texture-upload block. Confirm `arcs` GLSL math + the `u_stateTex` upload.

- [ ] **Step 2: Add a shared GLSL arc-coverage helper** above `main()` in the fragment shader:
```glsl
bool arcCov(vec2 f, float st, float tw) {
  vec2 a = (st < 0.5) ? vec2(0.0,0.0) : vec2(1.0,0.0);
  vec2 b = (st < 0.5) ? vec2(1.0,1.0) : vec2(0.0,1.0);
  return abs(distance(f,a)-0.5) < tw*0.5 || abs(distance(f,b)-0.5) < tw*0.5;
}
```
Refactor the existing `arcs` branch (`u_family < 0.5`) to use it: `col = arcCov(vec2(fx,fy), st, u_tw) ? u_a : u_bg;`.

- [ ] **Step 3: Add a multiscale branch** — inside the truchet block, BEFORE the family ladder (so multiscale, family index 3, is handled here and the ladder keeps arcs/diagonal/weave), add:
```glsl
    if (u_family > 2.5) { // multiscale
      float lvl = texelFetch(u_stateTex, ivec2(int(cx), int(cy)), 0).r > 0.5 ? 1.0 : 0.0;
      vec2 lf = vec2(fx, fy); float sub = 0.0;
      if (lvl >= 1.0) {
        float sx = min(2.0, floor(fx*3.0)), sy = min(2.0, floor(fy*3.0));
        lf = vec2(fx*3.0 - sx, fy*3.0 - sy); sub = sx*3.0 + sy + 1.0;
      }
      float st2 = hash1(cx*73856093.0 + cy*19349663.0 + sub*50331653.0 + u_seed*83492791.0) < 0.5 ? 0.0 : 1.0;
      frag = vec4(arcCov(lf, st2, u_tw) ? u_a : u_bg, 1.0);
      return;
    }
```
(The existing `float h = hash1(...)` / `st` / family ladder remain for the other families. `u_placement` is irrelevant to multiscale.)

- [ ] **Step 4: Upload the level grid in `render()`** — import `multiscaleLevels` from `~/lib/texturefx/pattern`. Extend the texture-upload logic: when `family === 'multiscale'`, upload the level grid (same R8 path as structured), so `u_stateTex` holds levels:
```typescript
    const family = String(p.tileFamily)
    const multiscale = String(p.mode) === 'truchet' && family === 'multiscale'
    const structured = String(p.mode) === 'truchet' && family !== 'multiscale' && String(p.placement) === 'structured'
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stateTex!)
    if (multiscale || structured) {
      const cellsI = Math.max(2, Math.round(Number(p.cells) || 8))
      const seedI = Math.round(Number(p.seed) || 1)
      const grid = multiscale
        ? multiscaleLevels(cellsI, seedI, Math.min(1, Math.max(0, Number(p.subdivide) || 0)))
        : truchetStates(cellsI, seedI, Math.min(1, Math.max(0, Number(p.coherence) || 0)))
      const data = new Uint8Array(grid.length)
      // R8 is normalized (samples b/255, shader tests >0.5): store 1 as 255, not 1.
      for (let i = 0; i < grid.length; i++) data[i] = grid[i] ? 255 : 0
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cellsI, cellsI, 0, gl.RED, gl.UNSIGNED_BYTE, data)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]))
    }
    gl.uniform1i(u('u_stateTex'), 0)
    gl.uniform1f(u('u_placement'), structured ? 1 : 0)
```
(This replaces the existing structured-only upload block. `u_placement` stays 0 for multiscale — the multiscale shader branch reads `u_stateTex` directly as levels, gated by `u_family>2.5`.)

- [ ] **Step 5: Typecheck** — `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep texturefx/renderer || echo clean`.

- [ ] **Step 6: Commit** — `git commit -m "feat(texture-studio): mirror multiscale arcs in shader (level texture + 3x descent)"`

---

## Task 4: Visual verification + sign-off (iterate)

> Controller-driven. The user accepted that this may need several rounds. Render multiscale across `subdivide` 0.2/0.5/0.8 (cells 10, seed 7) + a couple seeds, each tiled 2×2. Inspect: (a) subdivided regions cluster and look like finer arcs, (b) tile is seamless across the 2×2, (c) cross-scale connectivity at edge midpoints (center sub-arcs meet coarse neighbors), and judge whether the off-center scale-transition detail reads as intentional or broken.

- [ ] **Step 1:** Temp harness page rendering multiscale at varied subdivide/seed, 2×2 each.
- [ ] **Step 2:** Screenshot the dev server (Playwright, `domcontentloaded` + waitForFunction on figures, dpr 2, fullPage). Confirm no shader error, no seams.
- [ ] **Step 3:** Present, get sign-off. Iterate on `pattern.ts`+shader together (shared math — keep mirrored): candidate tweaks if it looks off — vary line weight at sub-scale, cap/clamp `subdivide` range, smooth-pass count for level clustering, or allow level 2 (9×9). Re-screenshot each round.
- [ ] **Step 4:** Remove harness, run full unit suite, commit (`--allow-empty`).

---

## Self-review (completed)

- **Spec coverage:** multiscale = the loved 4th Truchet family; delivered via 3× subdivision (connectivity-preserving at edge midpoints) + clustered level field. `subdivide` control added; placement controls hidden for multiscale.
- **Placeholders:** none; complete code + expected outputs.
- **Type consistency:** `'multiscale'` added to `TILE_FAMILIES` (index 3 → shader `u_family>2.5`); `multiscaleLevels(cells,seed,subdivide)` defined in Task 2, imported by Task 3 renderer (shared source → exact CPU/GPU level agreement); `arcCoverage` (TS) ↔ `arcCov` (GLSL) same math; subtile state hash `cx*73856093 + cy*19349663 + sub*50331653 + seed*83492791` identical CPU/GPU; `subdivide`/`tileFamily` keys consistent across controls/pattern/renderer.
- **Seamlessness:** level grid toroidal (mod-cells smoothing) + indexed by modded cx/cy; sub-index deterministic from local coords; subtile state hashes modded cx/cy. Task 2 adds a multiscale wrap test. The R8 0/255 remap + comment carried into the new upload branch.
- **Known accepted limitation:** off-center sub-arcs at a level-0/level-1 boundary can leave small dangling ends (the visible scale transition) — accepted per the "faithful Carlson, iterate" choice; revisit in Task 4 if it reads as broken.
