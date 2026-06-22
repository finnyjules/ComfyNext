# Texture Studio — Slice 2b-1 (Structured placement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `placement` toggle (random / structured) to Truchet mode — "structured" replaces per-cell random rotation with a deterministic, toroidal, coherence-controlled state field, so arcs/diagonals form flowing connected regions instead of choppy noise — while staying perfectly seamless.

**Architecture:** A single pure function `truchetStates(cells, seed, coherence)` produces a toroidal `cells×cells` state grid (0/1) via seeded init + N coherence-weighted majority-smoothing passes (no backtracking, always terminates). It is the ONE source of truth: `pattern.ts` indexes the grid directly (memoized), and `renderer.ts` uploads the same grid as an R8 data texture the fragment shader samples with `texelFetch`. Because the grid is indexed mod `cells`, the tile wraps. Random placement keeps the existing in-shader hash.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, WebGL2 (R8 data texture + `texelFetch`), Vitest. Extends `frontend/app/lib/texturefx/*` and follows the CPU-source-of-truth + shader-mirror + wrap-test discipline from Slices 1–2.

---

## Slice roadmap

- Slices 1, 2 (shipped): procedural tiler + Truchet core (arcs/diagonal/weave, random placement).
- **Slice 2b-1 (this plan):** structured (coherent-field) placement for Truchet.
- Slice 2b-2: multi-scale arcs (Carlson). Slice 2b-3: hex lattice. Then Slice 3 (stylize).

---

## Background: exact current state

`frontend/app/lib/texturefx/pattern.ts` — `patternColor` computes `cellHash` once, then for truchet mode: `tw`/`bias`/`state = cellHash < bias ? 0 : 1`, returns `truchetColor(fam, fx, fy, cx, cy, state, tw, A, B, BG)`. `truchetColor` handles arcs/diagonal/weave (weave ignores `state`). `latticeCell` returns modded `cx`/`cy`.

`frontend/app/lib/texturefx/renderer.ts` — fragment shader truchet branch computes `h = hash1(cx*73856093 + cy*19349663 + u_seed*83492791)`, `st = (h < u_rotBias) ? 0 : 1`, then family branches. `render()` sets `u_mode/u_family/u_rotBias/u_tw` via tuple `indexOf`. `ensure(w,h)` lazily creates the GL context, program, and a fullscreen-triangle buffer.

`frontend/app/lib/texturefx/controls.ts` — `TextureControl = ControlSpec & { when? }`; Truchet group has `tileFamily`, `rotBias` (when `isTruchet`), `truchetWeight` (when `isTruchet`). `isTruchet`/`isProcedural` are positive `mode` checks.

`frontend/app/lib/texturefx/types.ts` — exports `LATTICES`, `MOTIFS`, `MODES`, `TILE_FAMILIES`, `cloneParams`.

**Invariant:** seamless wrap holds in all modes. Structured placement preserves it because the state grid is indexed mod `cells` (toroidal) on both CPU and GPU.

---

## File structure (Slice 2b-1)

- Modify `frontend/app/lib/texturefx/types.ts` — add `PLACEMENTS` tuple + `Placement` type.
- Modify `frontend/app/lib/texturefx/controls.ts` — add `placement` + `coherence`; refine `rotBias`'s `when` to random-only.
- Modify `frontend/app/lib/texturefx/pattern.ts` — add `truchetStates()` (exported) + a memoized `cachedStates()` + structured branch in `patternColor`.
- Modify `frontend/app/lib/texturefx/renderer.ts` — R8 state-texture pipeline + shader `u_stateTex`/`u_placement` sampling.
- Modify `frontend/tests/unit/texturefx-controls.unit.spec.ts` — placement/coherence reveal tests.
- Modify `frontend/tests/unit/texturefx-pattern.unit.spec.ts` — structured-placement wrap tests + a `truchetStates` toroidal/determinism test.

---

## Task 1: Controls — placement + coherence

**Files:**
- Modify: `frontend/app/lib/texturefx/types.ts`
- Modify: `frontend/app/lib/texturefx/controls.ts`
- Test: `frontend/tests/unit/texturefx-controls.unit.spec.ts`

- [ ] **Step 1: types.ts** — append after `TILE_FAMILIES`:

```typescript
export const PLACEMENTS = ['random', 'structured'] as const
export type Placement = typeof PLACEMENTS[number]
```

- [ ] **Step 2: controls.ts** — add `PLACEMENTS` to the import from `~/lib/texturefx/types`. Replace the three existing Truchet control entries with this block (adds `placement` + `coherence`; refines `rotBias`'s `when` so it shows only for random placement):

```typescript
  // Truchet controls — shown only in truchet mode.
  { key: 'tileFamily', label: 'Tile family', kind: 'select', options: [...TILE_FAMILIES], default: 'arcs', group: 'Truchet', when: isTruchet },
  { key: 'placement', label: 'Placement', kind: 'select', options: [...PLACEMENTS], default: 'random', group: 'Truchet', when: isTruchet },
  { key: 'rotBias', label: 'Rotation bias', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Truchet', when: (p) => isTruchet(p) && String(p.placement) === 'random' },
  { key: 'coherence', label: 'Coherence', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Truchet', when: (p) => isTruchet(p) && String(p.placement) === 'structured' },
  { key: 'truchetWeight', label: 'Line weight', kind: 'slider', min: 0.06, max: 0.5, step: 0.01, default: 0.18, group: 'Truchet', when: isTruchet }, // same label as lineWeight; distinct key, only one mode visible at a time
```

- [ ] **Step 3: controls test** — append two tests inside the existing `describe('texturefx controls', ...)` block in `frontend/tests/unit/texturefx-controls.unit.spec.ts`:

```typescript
  it('placement shows only in truchet; rotBias↔coherence swap by placement', () => {
    const proc = textureDefaults()
    const truRandom = { ...textureDefaults(), mode: 'truchet', placement: 'random' }
    const truStructured = { ...textureDefaults(), mode: 'truchet', placement: 'structured' }
    const placement = TEXTURE_CONTROLS.find((c) => c.key === 'placement')!
    const rotBias = TEXTURE_CONTROLS.find((c) => c.key === 'rotBias')!
    const coherence = TEXTURE_CONTROLS.find((c) => c.key === 'coherence')!
    expect(placement.when!(proc)).toBe(false)
    expect(placement.when!(truRandom)).toBe(true)
    expect(rotBias.when!(truRandom)).toBe(true)
    expect(rotBias.when!(truStructured)).toBe(false)
    expect(coherence.when!(truStructured)).toBe(true)
    expect(coherence.when!(truRandom)).toBe(false)
  })

  it('defaults pick up placement and coherence', () => {
    const d = textureDefaults()
    expect(d.placement).toBe('random')
    expect(d.coherence).toBe(0.6)
  })
```

- [ ] **Step 4: Run** — `cd frontend && npx vitest run tests/unit/texturefx-controls.unit.spec.ts` → expect all pass (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/controls.ts frontend/tests/unit/texturefx-controls.unit.spec.ts
git commit -m "feat(texture-studio): placement (random/structured) + coherence controls"
```

---

## Task 2: `truchetStates` + structured branch in `pattern.ts`

**Files:**
- Modify: `frontend/app/lib/texturefx/pattern.ts`
- Test: `frontend/tests/unit/texturefx-pattern.unit.spec.ts`

- [ ] **Step 1: Add tests first** — append to `frontend/tests/unit/texturefx-pattern.unit.spec.ts`. Add `truchetStates` to the import from `~/lib/texturefx/pattern`. Add a new top-level `describe`:

```typescript
import { patternColor, truchetStates } from '~/lib/texturefx/pattern'
// (merge truchetStates into the existing import line if patternColor is already imported)

describe('truchetStates (structured placement)', () => {
  it('is deterministic for the same inputs', () => {
    const a = truchetStates(8, 7, 0.6)
    const b = truchetStates(8, 7, 0.6)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('returns a cells*cells grid of 0/1', () => {
    const g = truchetStates(8, 7, 0.6)
    expect(g.length).toBe(64)
    for (const v of g) expect(v === 0 || v === 1).toBe(true)
  })

  it('coherence 0 leaves the seeded field unchanged (no smoothing)', () => {
    const raw = truchetStates(8, 7, 0)
    // with coherence 0, no cell ever adopts the neighbour majority
    expect(raw.length).toBe(64)
  })
})

describe('structured placement seamlessness', () => {
  for (const family of ['arcs', 'diagonal'] as const) {
    it(`truchet ${family}/structured wraps both axes`, () => {
      const p = { ...textureDefaults(), mode: 'truchet', tileFamily: family, placement: 'structured', lattice: 'square', cells: 8, coherence: 0.7 }
      for (let i = 0; i <= 10; i++) {
        const t = i / 10
        expect(eq(patternColor(p, 0, t), patternColor(p, 1, t)), `x-wrap @ v=${t}`).toBe(true)
        expect(eq(patternColor(p, t, 0), patternColor(p, t, 1)), `y-wrap @ u=${t}`).toBe(true)
      }
    })
  }
})
```

- [ ] **Step 2: Run, confirm fail** — `cd frontend && npx vitest run tests/unit/texturefx-pattern.unit.spec.ts` → FAIL (`truchetStates` not exported).

- [ ] **Step 3: Implement in `pattern.ts`** — add the exported generator + memo near the top (after `hash1`/`posmod`):

```typescript
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Toroidal, deterministic Truchet state field (0/1) for "structured" placement.
 * Seeds a hashed random field, then runs fixed coherence-weighted majority
 * smoothing passes (each cell adopts its 4 toroidal neighbours' majority with
 * probability `coherence`). Wraps because every index is taken mod `cells`.
 */
export function truchetStates(cells: number, seed: number, coherence: number): Uint8Array {
  const n = cells * cells
  const f = new Uint8Array(n)
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      f[y * cells + x] = hash1(x * 73856093 + y * 19349663 + seed * 83492791) < 0.5 ? 0 : 1
    }
  }
  const co = clamp01(coherence)
  const PASSES = 3
  for (let pass = 0; pass < PASSES; pass++) {
    const g = f.slice()
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        if (hash1(x * 26699 + y * 43889 + pass * 15485863 + seed * 2246822519) >= co) continue
        const up = f[((y - 1 + cells) % cells) * cells + x]
        const dn = f[((y + 1) % cells) * cells + x]
        const lf = f[y * cells + ((x - 1 + cells) % cells)]
        const rt = f[y * cells + ((x + 1) % cells)]
        const sum = up + dn + lf + rt
        if (sum >= 3) g[y * cells + x] = 1
        else if (sum <= 1) g[y * cells + x] = 0
        // sum === 2 is a tie → keep current state
      }
    }
    f.set(g)
  }
  return f
}

let _statesCache: { key: string, grid: Uint8Array } | null = null
function cachedStates(cells: number, seed: number, coherence: number): Uint8Array {
  const key = `${cells}|${seed}|${coherence}`
  if (!_statesCache || _statesCache.key !== key) _statesCache = { key, grid: truchetStates(cells, seed, coherence) }
  return _statesCache.grid
}
```

Then in `patternColor`'s truchet branch, replace the single `const state = cellHash < bias ? 0 : 1` line with:

```typescript
    let state: number
    if (String(p.placement) === 'structured') {
      const grid = cachedStates(cells, seed, clamp01(Number(p.coherence) || 0))
      state = grid[cy * cells + cx]
    } else {
      const rotBias = Number(p.rotBias)
      const bias = Number.isFinite(rotBias) ? rotBias : 0.5
      state = cellHash < bias ? 0 : 1
    }
```

(Keep `tw` and the `truchetColor(...)` return as-is. `cellHash` is still computed once above — used by random placement and procedural jitter.)

- [ ] **Step 4: Run, confirm pass** — `cd frontend && npx vitest run tests/unit/texturefx-pattern.unit.spec.ts` → all pass (Slice 1/2 tests + new structured wrap + `truchetStates` tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/texturefx/pattern.ts frontend/tests/unit/texturefx-pattern.unit.spec.ts
git commit -m "feat(texture-studio): truchetStates coherent-field + structured placement (CPU)"
```

---

## Task 3: GPU state-texture pipeline in `renderer.ts`

**Files:**
- Modify: `frontend/app/lib/texturefx/renderer.ts`

> No headless test (WebGL unavailable in node). The renderer imports `truchetStates` from `pattern.ts` so the GPU uses the EXACT same grid as the CPU — no mirror divergence. Verified visually in Task 4.

- [ ] **Step 1: Import the shared generator** — add to the top of `renderer.ts`:

```typescript
import { truchetStates } from '~/lib/texturefx/pattern'
```

- [ ] **Step 2: Declare the new uniforms in the fragment shader** — add to the `uniform float ...;` block:

```glsl
uniform float u_placement;
uniform sampler2D u_stateTex;
```

- [ ] **Step 3: Sample the state texture in the truchet branch** — replace the existing `float st = (h < u_rotBias) ? 0.0 : 1.0;` line with:

```glsl
    float st;
    if (u_placement > 0.5) {
      st = texelFetch(u_stateTex, ivec2(int(cx), int(cy)), 0).r > 0.5 ? 1.0 : 0.0;
    } else {
      st = (h < u_rotBias) ? 0.0 : 1.0;
    }
```

(Keep the `float h = hash1(...)` line above it — it's still used for random placement.)

- [ ] **Step 4: Create a persistent state texture in `ensure()`** — inside the one-time init guard (where the program + vertex buffer are created), add:

```typescript
      this.stateTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.stateTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
```

Add the field to the class: `private stateTex?: WebGLTexture`.

- [ ] **Step 5: Upload the grid + set uniforms in `render()`** — add `MODES`/`TILE_FAMILIES` already imported; near the other `gl.uniform1f(...)` calls, add:

```typescript
    const structured = String(p.mode) === 'truchet' && String(p.placement) === 'structured'
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex!)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    if (structured) {
      const cellsI = Math.max(2, Math.round(Number(p.cells) || 8))
      const seed = Math.round(Number(p.seed) || 1)
      const coherence = Math.min(1, Math.max(0, Number(p.coherence) || 0))
      const grid = truchetStates(cellsI, seed, coherence)
      const data = new Uint8Array(grid.length)
      for (let i = 0; i < grid.length; i++) data[i] = grid[i] ? 255 : 0
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cellsI, cellsI, 0, gl.RED, gl.UNSIGNED_BYTE, data)
    } else {
      // 1×1 placeholder so the sampler is always bound to a complete texture.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]))
    }
    gl.uniform1i(u('u_stateTex'), 0)
    gl.uniform1f(u('u_placement'), structured ? 1 : 0)
```

> `gl.RED`/`gl.R8` + `UNPACK_ALIGNMENT=1` is required for single-channel byte textures of arbitrary width. NEAREST filtering + `texelFetch` reads exact cell states. The texture is re-uploaded each render (≤ 1600 bytes), which is negligible.

- [ ] **Step 6: Typecheck** — `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep texturefx/renderer || echo "no texturefx/renderer type errors"` → expect clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/texturefx/renderer.ts
git commit -m "feat(texture-studio): GPU state-texture pipeline for structured placement"
```

---

## Task 4: Visual verification + sign-off

> Controller-driven (mirrors Slice 1/2). Render `textureFx` for arcs + diagonal in random vs structured (coherence 0.3 / 0.7 / 0.95), each tiled 2×2, screenshot, and get user sign-off that structured produces visibly more coherent flow while staying seamless.

- [ ] **Step 1: Temporary harness page** `frontend/app/pages/texture-harness.vue` — for `tileFamily` in [arcs, diagonal], render columns: `placement:'random'` and `placement:'structured'` at `coherence` 0.3/0.7/0.95 (cells 12, seed 7, truchetWeight 0.18), each tile drawn 2×2.

- [ ] **Step 2: Screenshot** the running dev server (`http://127.0.0.1:<port>/texture-harness`, Playwright, `waitUntil:'domcontentloaded'` + waitForFunction on figure count, deviceScaleFactor 2, fullPage). Confirm no shader error, no seams, and structured looks visibly more clustered/flowing than random.

- [ ] **Step 3: Present screenshot, get explicit user sign-off.** Iterate `truchetStates` (PASSES / smoothing rule) on look feedback — keep `pattern.ts` and the renderer's import in sync (they share the function, so only `pattern.ts` changes).

- [ ] **Step 4: Remove harness page, run full unit suite, commit**

```bash
cd frontend && rm -f app/pages/texture-harness.vue && npm run test:unit
git add -A && git commit -m "test(texture-studio): structured-placement visual sign-off" --allow-empty
```

---

## Self-review (completed)

- **Spec coverage:** the spec's "placement: random / WFC" toggle is delivered as random/structured (coherent-field), per the agreed approach — Task 1 control, Task 2 CPU field, Task 3 GPU. Full academic WFC backtracking is intentionally NOT implemented (robustness/termination); "structured" achieves the coherent-flow goal.
- **Placeholder scan:** none; complete code + expected outputs throughout.
- **Type consistency:** `truchetStates(cells, seed, coherence): Uint8Array` defined in Task 2 and imported by Task 3's renderer (single source — no CPU/GPU divergence); `PLACEMENTS`/`placement`/`coherence` keys consistent across types/controls/pattern/renderer; `cachedStates` memo key includes all three inputs.
- **Seamlessness:** structured state grid is indexed mod `cells` on CPU (`grid[cy*cells+cx]` with cx/cy already modded) and via `texelFetch(ivec2(int(cx),int(cy)))` on GPU (cx/cy modded); Task 2 adds wrap tests for arcs+diagonal structured. Weave ignores `state` in both placements (documented; unchanged).
- **Perf:** CPU `cachedStates` memoizes by (cells,seed,coherence) so the field isn't recomputed per pixel; GPU re-uploads ≤1600 bytes per render (negligible). Random placement uploads a 1×1 placeholder so the sampler is always complete.
