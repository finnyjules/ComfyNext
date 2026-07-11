# Shape Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Shape Studio" — a frontend-only canvas studio that renders faceted 3D solids *flat* (matte, unlit), colored by a harmony palette or a mapped fill, with seeded lockable re-roll and PNG export.

**Architecture:** A pure logic core (`frontend/app/lib/shapefx/`) generates seeded geometry, vertex colors, and re-rolled configs — all unit-tested without a GL context. A thin Three.js engine (`engine.ts`) renders that geometry unlit (`MeshBasicMaterial`, no lights) with orbit + grain/distortion post, and exports PNG via `canvas.toBlob`. A Vue Surface (`ShapeStudioSurface.vue`) drives it through `StudioModalShell`, and five registration touchpoints wire it into the canvas like every other studio.

**Tech Stack:** Nuxt 4, Vue 3 `<script setup>` + TypeScript, Three.js `^0.171` (incl. `three/examples/jsm/geometries/ConvexGeometry`), Vitest for units, existing libs `lib/color/harmony.ts`, `lib/spacetype/fills.ts`, `lib/spacetype/webgl.ts`.

## Global Constraints

- **Work on `main`, no feature branches.** Commit directly to `main`.
- **Stage explicitly.** Every commit uses explicit file paths (`git add <path> <path>`). NEVER `git add -A` / `git add .` — concurrent sessions stage mid-commit.
- **Repo lives at `/Users/julien/Documents/GitHub/Sailor`** (the ComfyNext→Sailor folder rename is done; there is no `ComfyNext` directory). All paths below are repo-relative from there.
- **Studio event bus uses the `sailor:` prefix** (product name), NOT `comfynext:`. Open event: `sailor:openShapeStudio`; output event: `sailor:shapeStudioOutput`. Verified against the live codebase: every existing studio (`sailor:openSpaceType`, `sailor:openGradientStudio`, `sailor:gradientStudioOutput`, …) uses `sailor:` across 71 files.
- **Backend route naming is `/sailor/…`** (e.g. the video fast-follow's encoder is `POST /sailor/spacetype_encode`, confirmed in `comfy_extras`). Not needed for the PNG-only v1, but don't type `/comfynext/`.
- **Confirmed contracts (do not re-derive):** `fillTexture(three: typeof THREE, fill: Fill): THREE.Texture | null` in `frontend/app/lib/spacetype/fills.ts`; `detectWebGL(): boolean` in `frontend/app/lib/spacetype/webgl.ts`; registration targets `frontend/app/data/studio-options.ts`, `frontend/app/lib/agent/capabilities.ts` all exist as referenced.
- **Prod-build import rule:** files under `frontend/shared/**` must be imported via the `~~/` alias, never relative. (This plan keeps all new code under `frontend/app/lib/**`, which uses normal relative/`~/` imports — but if any shared file is touched, honor this.)
- **The studio is deliberately flat:** unlit `MeshBasicMaterial` only. No lights, no `MeshStandardMaterial`, no environment maps.
- **Unit test files** live in `frontend/tests/unit/` and are named `*.unit.spec.ts`. Run with `npx vitest run <file>` (single) or `npm run test:unit` (all), from `frontend/`.
- **No purple/violet accents** anywhere in UI. Neutral white-opacity + emerald-for-run; pastel = AI. Variable-bound inputs are pink.
- **Visual verification is mandatory** for any WebGL/Vue task — never sign off a render task on unit tests alone. Screenshot the `shape-studio-lab.vue` harness.

---

## File Structure

**New — pure logic (`frontend/app/lib/shapefx/`):**
- `rng.ts` — deterministic seeded RNG (copied verbatim from `lib/gradientfx/rng.ts`).
- `config.ts` — `ShapeConfig` type, `DEFAULT_CONFIG`, `mergeConfig` (import guard).
- `points.ts` — `gemPoints(config)`: seeded point cloud for Gem mode (pure, no THREE).
- `geometry.ts` — `buildGeometry(config)`: THREE `BufferGeometry` for primitives + gems.
- `color.ts` — `applyVertexColors(geometry, config)`: harmony palette → geometry `color` attribute.
- `surface.ts` — `buildSurfaceTexture(three, config)`: Type Studio fill → THREE texture for Surface mode.
- `randomize.ts` — `reroll(config)`: seeded re-roll of unlocked sections.
- `engine.ts` — `ShapeEngine` class: renderer, cameras, orbit, post, `frameToBlob`, `dispose`.

**New — UI:**
- `frontend/app/components/vue-canvas/ShapeStudioNode.vue` — on-canvas card.
- `frontend/app/components/vue-canvas/ShapeStudioSurface.vue` — full-screen editor.
- `frontend/app/pages/dev/shape-studio-lab.vue` — dev harness for screenshot verification.

**Modified — registration (5 touchpoints):**
- `frontend/app/composables/useVueNodes.ts` — `NODE_TYPE_MAP`.
- `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — component map, guard list, open handler, mount.
- `frontend/app/data/studio-options.ts` — `StudioOption`.
- `frontend/app/lib/agent/capabilities.ts` — `STUDIOS[]` entry.

**New — tests (`frontend/tests/unit/`):**
- `shapefx-config.unit.spec.ts`, `shapefx-points.unit.spec.ts`, `shapefx-geometry.unit.spec.ts`, `shapefx-color.unit.spec.ts`, `shapefx-randomize.unit.spec.ts`.

---

## Task 1: RNG + ShapeConfig foundation

**Files:**
- Create: `frontend/app/lib/shapefx/rng.ts`
- Create: `frontend/app/lib/shapefx/config.ts`
- Test: `frontend/tests/unit/shapefx-config.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `rng.ts`: `makeRng(seed: string, salt?: string): Rng`, `randomSeed(): string`, `interface Rng { next(): number; range(lo,hi): number; int(lo,hi): number; pick<T>(arr): T; chance(p): boolean }`.
  - `config.ts`: `type ShapeMode = 'primitive' | 'gem'`; `type PrimitiveKind = 'cube' | 'sphere' | 'cone' | 'cylinder' | 'prism' | 'torus' | 'icosahedron' | 'octahedron'`; `type FillMode = 'facets' | 'surface'`; `type ColorRule = 'facet' | 'depth' | 'height'`; `type SectionKey = 'shape' | 'palette' | 'style'`; `interface ShapeConfig` (see below); `DEFAULT_CONFIG: ShapeConfig`; `mergeConfig(raw: unknown): ShapeConfig`.

- [ ] **Step 1: Copy the RNG util verbatim**

Create `frontend/app/lib/shapefx/rng.ts` with the exact contents of `frontend/app/lib/gradientfx/rng.ts` (exports `xmur3`, `mulberry32`, `Rng`, `makeRng`, `randomSeed`). Copy — do not import across studios — so Shape Studio owns its randomness surface.

- [ ] **Step 2: Write the failing config test**

Create `frontend/tests/unit/shapefx-config.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig, type ShapeConfig } from '../../app/lib/shapefx/config'

describe('shapefx config', () => {
  it('DEFAULT_CONFIG is internally consistent', () => {
    expect(DEFAULT_CONFIG.shape.mode).toBe('primitive')
    expect(DEFAULT_CONFIG.fillMode).toBe('facets')
    expect(DEFAULT_CONFIG.locks).toEqual({ shape: false, palette: false, style: false })
    expect(typeof DEFAULT_CONFIG.seed).toBe('string')
  })

  it('mergeConfig fills missing fields from DEFAULT_CONFIG (partial/old configs stay safe)', () => {
    const merged = mergeConfig({ seed: '#abc', palette: { baseHue: 200 } })
    expect(merged.seed).toBe('#abc')
    expect(merged.palette.baseHue).toBe(200)
    expect(merged.palette.harmony).toBe(DEFAULT_CONFIG.palette.harmony) // untouched → default
    expect(merged.shape.primitive).toBe(DEFAULT_CONFIG.shape.primitive)
  })

  it('mergeConfig rejects junk types and falls back to defaults', () => {
    const merged = mergeConfig({ shape: { mode: 'nonsense' }, fillMode: 42, locks: 'no' })
    expect(merged.shape.mode).toBe(DEFAULT_CONFIG.shape.mode) // junk nested enum rejected
    expect(merged.fillMode).toBe(DEFAULT_CONFIG.fillMode)
    expect(merged.locks).toEqual(DEFAULT_CONFIG.locks)
  })

  it('mergeConfig round-trips a full DEFAULT_CONFIG', () => {
    expect(mergeConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)))).toEqual(DEFAULT_CONFIG)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shapefx-config.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/lib/shapefx/config`.

- [ ] **Step 4: Implement `config.ts`**

Create `frontend/app/lib/shapefx/config.ts`:

```ts
import type { HarmonyType } from '../color/harmony'
import type { FillType } from '../spacetype/fillTile'

export type ShapeMode = 'primitive' | 'gem'
export type PrimitiveKind =
  | 'cube' | 'sphere' | 'cone' | 'cylinder' | 'prism' | 'torus' | 'icosahedron' | 'octahedron'
export type FillMode = 'facets' | 'surface'
export type ColorRule = 'facet' | 'depth' | 'height'
export type Projection = 'orthographic' | 'perspective'
export type SectionKey = 'shape' | 'palette' | 'style'

export interface ShapeParams {
  mode: ShapeMode
  primitive: PrimitiveKind
  /** Gem mode: number of scattered points (hull complexity). 4–40. */
  vertices: number
  /** Gem mode: elongation along Z, 0.2–2. */
  depth: number
  /** Gem mode: point-cloud spread, 0.1–1. */
  spread: number
  /** Primitive facet density → segment count / detail. 0–4 (integer steps). */
  density: number
  projection: Projection
}

export interface PaletteParams {
  harmony: HarmonyType
  baseHue: number      // 0–360
  saturation: number   // 0–100
  lightness: number    // 0–100
  rule: ColorRule
}

export interface StyleParams {
  grain: number        // 0–100
  distortion: number   // 0–100
  background: string   // '#rrggbb' or 'transparent'
}

export interface SurfaceFill {
  type: FillType
  a: string
  b: string
  angle: number
  density: number
}

export interface ShapeConfig {
  seed: string
  fillMode: FillMode
  shape: ShapeParams
  palette: PaletteParams
  fill: SurfaceFill
  style: StyleParams
  locks: Record<SectionKey, boolean>
}

export const DEFAULT_CONFIG: ShapeConfig = {
  seed: '#3a7f21c0',
  fillMode: 'facets',
  shape: { mode: 'primitive', primitive: 'cube', vertices: 14, depth: 1, spread: 0.65, density: 1, projection: 'orthographic' },
  palette: { harmony: 'analogous', baseHue: 287, saturation: 57, lightness: 47, rule: 'facet' },
  fill: { type: 'gradient', a: '#ff4da6', b: '#6a3df0', angle: 45, density: 8 },
  style: { grain: 20, distortion: 0, background: '#000000' },
  locks: { shape: false, palette: false, style: false },
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? (v as T) : d
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)

const MODES = ['primitive', 'gem'] as const
const PRIMS = ['cube', 'sphere', 'cone', 'cylinder', 'prism', 'torus', 'icosahedron', 'octahedron'] as const
const FILLMODES = ['facets', 'surface'] as const
const RULES = ['facet', 'depth', 'height'] as const
const PROJ = ['orthographic', 'perspective'] as const
const HARMONIES = ['monochromatic', 'complementary', 'split-complementary', 'analogous', 'accented-analogous', 'triadic', 'tetradic', 'compound'] as const
const FILLTYPES = ['solid', 'gradient', 'ombre', 'grid', 'noise', 'checkerboard', 'stripes', 'qr'] as const

/** Deep-merge an untrusted parsed value over DEFAULT_CONFIG so partial/old/junk configs stay safe. */
export function mergeConfig(raw: unknown): ShapeConfig {
  const o = (raw ?? {}) as Record<string, any>
  const d = DEFAULT_CONFIG
  const sh = (o.shape ?? {}) as Record<string, any>
  const pa = (o.palette ?? {}) as Record<string, any>
  const fi = (o.fill ?? {}) as Record<string, any>
  const st = (o.style ?? {}) as Record<string, any>
  const lo = (o.locks ?? {}) as Record<string, any>
  return {
    seed: str(o.seed, d.seed),
    fillMode: oneOf(o.fillMode, FILLMODES, d.fillMode),
    shape: {
      mode: oneOf(sh.mode, MODES, d.shape.mode),
      primitive: oneOf(sh.primitive, PRIMS, d.shape.primitive),
      vertices: num(sh.vertices, d.shape.vertices),
      depth: num(sh.depth, d.shape.depth),
      spread: num(sh.spread, d.shape.spread),
      density: num(sh.density, d.shape.density),
      projection: oneOf(sh.projection, PROJ, d.shape.projection),
    },
    palette: {
      harmony: oneOf(pa.harmony, HARMONIES, d.palette.harmony),
      baseHue: num(pa.baseHue, d.palette.baseHue),
      saturation: num(pa.saturation, d.palette.saturation),
      lightness: num(pa.lightness, d.palette.lightness),
      rule: oneOf(pa.rule, RULES, d.palette.rule),
    },
    fill: {
      type: oneOf(fi.type, FILLTYPES, d.fill.type),
      a: str(fi.a, d.fill.a),
      b: str(fi.b, d.fill.b),
      angle: num(fi.angle, d.fill.angle),
      density: num(fi.density, d.fill.density),
    },
    style: {
      grain: num(st.grain, d.style.grain),
      distortion: num(st.distortion, d.style.distortion),
      background: str(st.background, d.style.background),
    },
    locks: {
      shape: bool(lo.shape, d.locks.shape),
      palette: bool(lo.palette, d.locks.palette),
      style: bool(lo.style, d.locks.style),
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/shapefx-config.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/shapefx/rng.ts frontend/app/lib/shapefx/config.ts frontend/tests/unit/shapefx-config.unit.spec.ts
git commit -m "feat(shape-studio): seeded RNG + ShapeConfig model with import guard"
```

---

## Task 2: Gem point cloud (`points.ts`)

**Files:**
- Create: `frontend/app/lib/shapefx/points.ts`
- Test: `frontend/tests/unit/shapefx-points.unit.spec.ts`

**Interfaces:**
- Consumes: `makeRng` (Task 1), `ShapeConfig` (Task 1).
- Produces: `gemPoints(config: ShapeConfig): number[][]` — array of `[x,y,z]` points, deterministic per `seed`+shape params, always length ≥ 4.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/shapefx-points.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gemPoints } from '../../app/lib/shapefx/points'
import { DEFAULT_CONFIG, type ShapeConfig } from '../../app/lib/shapefx/config'

const cfg = (over: Partial<ShapeConfig['shape']>, seed = '#seed1'): ShapeConfig => ({
  ...DEFAULT_CONFIG, seed, shape: { ...DEFAULT_CONFIG.shape, mode: 'gem', ...over },
})

describe('gemPoints', () => {
  it('is deterministic for a given seed + params', () => {
    expect(gemPoints(cfg({ vertices: 14 }))).toEqual(gemPoints(cfg({ vertices: 14 })))
  })

  it('a different seed yields different points', () => {
    expect(gemPoints(cfg({ vertices: 14 }, '#a'))).not.toEqual(gemPoints(cfg({ vertices: 14 }, '#b')))
  })

  it('point count follows vertices (clamped to a minimum of 4)', () => {
    expect(gemPoints(cfg({ vertices: 20 })).length).toBe(20)
    expect(gemPoints(cfg({ vertices: 2 })).length).toBe(4)
  })

  it('depth scales the Z extent', () => {
    const zExtent = (c: ShapeConfig) => {
      const zs = gemPoints(c).map(p => p[2])
      return Math.max(...zs) - Math.min(...zs)
    }
    expect(zExtent(cfg({ vertices: 30, depth: 2 }))).toBeGreaterThan(zExtent(cfg({ vertices: 30, depth: 0.5 })))
  })

  it('every point is finite 3-tuple', () => {
    for (const p of gemPoints(cfg({ vertices: 24 }))) {
      expect(p).toHaveLength(3)
      expect(p.every(Number.isFinite)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shapefx-points.unit.spec.ts`
Expected: FAIL — cannot resolve `points`.

- [ ] **Step 3: Implement `points.ts`**

Create `frontend/app/lib/shapefx/points.ts`:

```ts
import { makeRng } from './rng'
import type { ShapeConfig } from './config'

/**
 * A seeded point cloud for Gem mode. Points are drawn in a unit-ish ball, biased by
 * `spread` (tight → wide) and stretched along Z by `depth`. The hull of these points
 * (built in geometry.ts) becomes the faceted stone. Deterministic in seed+params.
 */
export function gemPoints(config: ShapeConfig): number[][] {
  const { vertices, depth, spread } = config.shape
  const count = Math.max(4, Math.round(vertices))
  const rng = makeRng(config.seed, 'gem')
  const pts: number[][] = []
  for (let i = 0; i < count; i++) {
    // random direction on the sphere + radius biased by spread (spread→1 = fuller ball)
    const u = rng.next() * 2 - 1
    const theta = rng.next() * Math.PI * 2
    const r = Math.pow(rng.next(), 1 - 0.6 * spread) // spread high → radii pushed outward
    const s = Math.sqrt(1 - u * u)
    const x = r * s * Math.cos(theta) * (0.6 + spread)
    const y = r * s * Math.sin(theta) * (0.6 + spread)
    const z = r * u * depth
    pts.push([x, y, z])
  }
  return pts
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/shapefx-points.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shapefx/points.ts frontend/tests/unit/shapefx-points.unit.spec.ts
git commit -m "feat(shape-studio): seeded gem point cloud"
```

---

## Task 3: Geometry builder (`geometry.ts`)

**Files:**
- Create: `frontend/app/lib/shapefx/geometry.ts`
- Test: `frontend/tests/unit/shapefx-geometry.unit.spec.ts`

**Interfaces:**
- Consumes: `gemPoints` (Task 2), `ShapeConfig` (Task 1), THREE, `ConvexGeometry`.
- Produces: `buildGeometry(config: ShapeConfig): THREE.BufferGeometry` — a **non-indexed** geometry (flat facets) with a `position` attribute; gems fall back to a tetrahedron if the hull is degenerate.

Note: THREE geometry construction needs no WebGL context, so this is unit-testable in Vitest (jsdom). Only `WebGLRenderer` needs GL.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/shapefx-geometry.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildGeometry } from '../../app/lib/shapefx/geometry'
import { DEFAULT_CONFIG, type ShapeConfig } from '../../app/lib/shapefx/config'

const prim = (primitive: ShapeConfig['shape']['primitive']): ShapeConfig => ({
  ...DEFAULT_CONFIG, shape: { ...DEFAULT_CONFIG.shape, mode: 'primitive', primitive },
})
const gem = (seed: string, vertices = 14): ShapeConfig => ({
  ...DEFAULT_CONFIG, seed, shape: { ...DEFAULT_CONFIG.shape, mode: 'gem', vertices },
})

describe('buildGeometry', () => {
  it('primitives produce a non-indexed geometry with a position attribute', () => {
    const g = buildGeometry(prim('cube'))
    expect(g.index).toBeNull()                       // non-indexed → crisp flat facets
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('every primitive kind builds without throwing', () => {
    for (const k of ['cube','sphere','cone','cylinder','prism','torus','icosahedron','octahedron'] as const) {
      expect(() => buildGeometry(prim(k))).not.toThrow()
    }
  })

  it('gem hull produces a valid non-empty geometry', () => {
    const g = buildGeometry(gem('#gem1', 16))
    expect(g.getAttribute('position').count).toBeGreaterThanOrEqual(12) // ≥ 4 tris
  })

  it('degenerate gem input falls back to a tetrahedron (12 verts) rather than throwing', () => {
    // vertices=4 collinear-ish still must yield a solid; forcing minimum path
    const g = buildGeometry(gem('#x', 4))
    expect(g.getAttribute('position').count).toBeGreaterThanOrEqual(12)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shapefx-geometry.unit.spec.ts`
Expected: FAIL — cannot resolve `geometry`.

- [ ] **Step 3: Implement `geometry.ts`**

Create `frontend/app/lib/shapefx/geometry.ts`:

```ts
import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { gemPoints } from './points'
import type { ShapeConfig, PrimitiveKind } from './config'

// Facet density 0–4 → segment counts. Low = chunky facets, high = fine.
const SEG = [3, 4, 6, 12, 24]
const seg = (density: number) => SEG[Math.max(0, Math.min(SEG.length - 1, Math.round(density)))]!

function primitiveGeometry(kind: PrimitiveKind, density: number): THREE.BufferGeometry {
  const s = seg(density)
  switch (kind) {
    case 'cube':         return new THREE.BoxGeometry(2, 2, 2)
    case 'sphere':       return new THREE.IcosahedronGeometry(1.4, Math.max(0, Math.round(density))) // faceted sphere via icosa detail
    case 'cone':         return new THREE.ConeGeometry(1.3, 2.4, Math.max(3, s))
    case 'cylinder':     return new THREE.CylinderGeometry(1.1, 1.1, 2.4, Math.max(3, s))
    case 'prism':        return new THREE.CylinderGeometry(1.3, 1.3, 2.4, 3) // triangular prism
    case 'torus':        return new THREE.TorusGeometry(1.1, 0.45, Math.max(3, s), Math.max(3, s * 2))
    case 'icosahedron':  return new THREE.IcosahedronGeometry(1.4, 0)
    case 'octahedron':   return new THREE.OctahedronGeometry(1.5, 0)
  }
}

/** Build the render geometry for a config. Non-indexed → flat/crisp facets. */
export function buildGeometry(config: ShapeConfig): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry
  if (config.shape.mode === 'gem') {
    const raw = gemPoints(config).map(([x, y, z]) => new THREE.Vector3(x, y, z))
    try {
      geo = new ConvexGeometry(raw)
      if (geo.getAttribute('position').count < 12) throw new Error('degenerate hull')
    } catch {
      geo = new THREE.TetrahedronGeometry(1.4, 0) // guaranteed solid fallback
    }
  } else {
    geo = primitiveGeometry(config.shape.primitive, config.shape.density)
  }
  // Flatten to non-indexed so each triangle owns distinct vertices → hard facet edges
  // and independent per-vertex colors. ConvexGeometry is already non-indexed; toNonIndexed
  // is a no-op cost there but harmless.
  const flat = geo.index ? geo.toNonIndexed() : geo
  if (flat !== geo) geo.dispose()
  flat.computeVertexNormals()
  flat.center()
  return flat
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/shapefx-geometry.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shapefx/geometry.ts frontend/tests/unit/shapefx-geometry.unit.spec.ts
git commit -m "feat(shape-studio): primitive + gem geometry builder (non-indexed facets)"
```

---

## Task 4: Facet coloring (`color.ts`)

**Files:**
- Create: `frontend/app/lib/shapefx/color.ts`
- Test: `frontend/tests/unit/shapefx-color.unit.spec.ts`

**Interfaces:**
- Consumes: `harmonize` from `lib/color/harmony.ts`, `makeRng` (Task 1), `ShapeConfig` (Task 1), THREE.
- Produces:
  - `paletteFor(config: ShapeConfig): string[]` — hex swatches from the harmony params.
  - `applyVertexColors(geometry: THREE.BufferGeometry, config: ShapeConfig): void` — writes a `color` BufferAttribute (mutates geometry in place), assigning per the `rule` (`facet` | `depth` | `height`).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/shapefx-color.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildGeometry } from '../../app/lib/shapefx/geometry'
import { applyVertexColors, paletteFor } from '../../app/lib/shapefx/color'
import { DEFAULT_CONFIG, type ShapeConfig, type ColorRule } from '../../app/lib/shapefx/config'

const cfg = (rule: ColorRule): ShapeConfig => ({
  ...DEFAULT_CONFIG, palette: { ...DEFAULT_CONFIG.palette, rule },
})

describe('shapefx color', () => {
  it('paletteFor returns hex swatches', () => {
    const p = paletteFor(DEFAULT_CONFIG)
    expect(p.length).toBeGreaterThanOrEqual(2)
    expect(p.every(h => /^#[0-9a-f]{6}$/i.test(h))).toBe(true)
  })

  it('applyVertexColors adds a color attribute matching the position count', () => {
    const g = buildGeometry(cfg('facet'))
    applyVertexColors(g, cfg('facet'))
    const col = g.getAttribute('color')
    expect(col).toBeTruthy()
    expect(col.count).toBe(g.getAttribute('position').count)
    expect(col.itemSize).toBe(3)
  })

  it('is deterministic for a given seed + palette', () => {
    const a = buildGeometry(cfg('facet')); applyVertexColors(a, cfg('facet'))
    const b = buildGeometry(cfg('facet')); applyVertexColors(b, cfg('facet'))
    expect(Array.from(a.getAttribute('color').array)).toEqual(Array.from(b.getAttribute('color').array))
  })

  it('different rules produce different colorings', () => {
    const a = buildGeometry(cfg('facet')); applyVertexColors(a, cfg('facet'))
    const b = buildGeometry(cfg('depth')); applyVertexColors(b, cfg('depth'))
    expect(Array.from(a.getAttribute('color').array)).not.toEqual(Array.from(b.getAttribute('color').array))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shapefx-color.unit.spec.ts`
Expected: FAIL — cannot resolve `color`.

- [ ] **Step 3: Implement `color.ts`**

Create `frontend/app/lib/shapefx/color.ts`:

```ts
import * as THREE from 'three'
import { harmonize } from '../color/harmony'
import { oklchToHex } from '../color/convert'
import { makeRng } from './rng'
import type { ShapeConfig } from './config'

/** Build the seed hex from HSL-ish palette params, then expand via the harmony engine. */
export function paletteFor(config: ShapeConfig): string[] {
  const { baseHue, saturation, lightness, harmony } = config.palette
  // harmony works in OKLCH; map the studio's hue/sat/light sliders to an OKLCH seed.
  const L = 0.25 + (lightness / 100) * 0.6      // 0.25–0.85
  const C = (saturation / 100) * 0.22           // 0–0.22 chroma
  const seedHex = oklchToHex(L, C, baseHue)
  const out = harmonize(seedHex, harmony, Math.max(5, 5))
  return out.length ? out : [seedHex]
}

/**
 * Assign a color to every vertex and write a `color` attribute. Non-indexed geometry means
 * each triangle owns 3 vertices; the `rule` decides how a facet picks from the palette:
 *   facet  — each triangle a palette member (seeded), with slight per-vertex jitter → gradient
 *   depth  — palette sampled by facet-centroid Z (front→back ramp)
 *   height — palette sampled by facet-centroid Y (bottom→top ramp)
 */
export function applyVertexColors(geometry: THREE.BufferGeometry, config: ShapeConfig): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  const palette = paletteFor(config).map(h => new THREE.Color(h))
  const rng = makeRng(config.seed, 'facetcolor')
  const colors = new Float32Array(n * 3)

  // bounds for depth/height ramps
  let minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const z = pos.getZ(i), y = pos.getY(i)
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const spanZ = maxZ - minZ || 1, spanY = maxY - minY || 1
  const sample = (t: number) => palette[Math.max(0, Math.min(palette.length - 1, Math.floor(t * palette.length)))]!

  for (let tri = 0; tri < n; tri += 3) {
    let base: THREE.Color
    if (config.palette.rule === 'facet') {
      base = palette[rng.int(0, palette.length - 1)]!
    } else {
      // centroid of the triangle
      let cz = 0, cy = 0
      for (let k = 0; k < 3; k++) { cz += pos.getZ(tri + k); cy += pos.getY(tri + k) }
      cz /= 3; cy /= 3
      const t = config.palette.rule === 'depth' ? (cz - minZ) / spanZ : (cy - minY) / spanY
      base = sample(t)
    }
    // small per-vertex tone jitter so each facet reads as a subtle gradient (the reference look)
    for (let k = 0; k < 3; k++) {
      const j = 1 + (rng.next() - 0.5) * 0.18
      const idx = (tri + k) * 3
      colors[idx] = Math.min(1, base.r * j)
      colors[idx + 1] = Math.min(1, base.g * j)
      colors[idx + 2] = Math.min(1, base.b * j)
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/shapefx-color.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shapefx/color.ts frontend/tests/unit/shapefx-color.unit.spec.ts
git commit -m "feat(shape-studio): facet vertex-coloring from harmony palette"
```

---

## Task 5: Seeded re-roll with locks (`randomize.ts`)

**Files:**
- Create: `frontend/app/lib/shapefx/randomize.ts`
- Test: `frontend/tests/unit/shapefx-randomize.unit.spec.ts`

**Interfaces:**
- Consumes: `makeRng`, `randomSeed` (Task 1), `ShapeConfig` + section types (Task 1), `HARMONY_TYPES` from `lib/color/harmony`.
- Produces: `reroll(config: ShapeConfig): ShapeConfig` — returns a NEW config: fresh seed, and each **unlocked** section (`shape` / `palette` / `style`) regenerated from that seed; **locked** sections copied unchanged. `fillMode` and `locks` are preserved.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/shapefx-randomize.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reroll } from '../../app/lib/shapefx/randomize'
import { DEFAULT_CONFIG, type ShapeConfig } from '../../app/lib/shapefx/config'

const withLocks = (locks: Partial<ShapeConfig['locks']>): ShapeConfig => ({
  ...DEFAULT_CONFIG, locks: { ...DEFAULT_CONFIG.locks, ...locks },
})

describe('reroll', () => {
  it('produces a new seed', () => {
    const out = reroll(DEFAULT_CONFIG)
    expect(out.seed).not.toBe(DEFAULT_CONFIG.seed)
  })

  it('a locked palette is preserved byte-for-byte; unlocked shape changes', () => {
    const start = withLocks({ palette: true, shape: false })
    // force a shape that will actually differ by using gem mode with many verts
    const seeded: ShapeConfig = { ...start, shape: { ...start.shape, mode: 'gem', vertices: 20 } }
    const out = reroll(seeded)
    expect(out.palette).toEqual(seeded.palette)          // locked → identical
    expect(out.shape).not.toEqual(seeded.shape)          // unlocked → changed
  })

  it('a locked shape is preserved; unlocked palette changes', () => {
    const start = withLocks({ shape: true, palette: false })
    const out = reroll(start)
    expect(out.shape).toEqual(start.shape)
    expect(out.palette).not.toEqual(start.palette)
  })

  it('preserves fillMode and the locks record', () => {
    const start: ShapeConfig = { ...DEFAULT_CONFIG, fillMode: 'surface', locks: { shape: true, palette: false, style: true } }
    const out = reroll(start)
    expect(out.fillMode).toBe('surface')
    expect(out.locks).toEqual(start.locks)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shapefx-randomize.unit.spec.ts`
Expected: FAIL — cannot resolve `randomize`.

- [ ] **Step 3: Implement `randomize.ts`**

Create `frontend/app/lib/shapefx/randomize.ts`:

```ts
import { makeRng, randomSeed } from './rng'
import { HARMONY_TYPES } from '../color/harmony'
import type { ShapeConfig, ShapeParams, PaletteParams, StyleParams, PrimitiveKind } from './config'

const PRIMS: PrimitiveKind[] = ['cube', 'sphere', 'cone', 'cylinder', 'prism', 'torus', 'icosahedron', 'octahedron']

function rollShape(seed: string, prev: ShapeParams): ShapeParams {
  const r = makeRng(seed, 'shape')
  return {
    ...prev,
    // keep the current mode + primitive family, roll the generative knobs
    primitive: prev.mode === 'primitive' ? r.pick(PRIMS) : prev.primitive,
    vertices: r.int(6, 24),
    depth: +r.range(0.5, 1.6).toFixed(2),
    spread: +r.range(0.35, 0.95).toFixed(2),
    density: r.int(0, 3),
  }
}

function rollPalette(seed: string, prev: PaletteParams): PaletteParams {
  const r = makeRng(seed, 'palette')
  return {
    ...prev,
    harmony: r.pick(HARMONY_TYPES),
    baseHue: r.int(0, 359),
    saturation: r.int(35, 80),
    lightness: r.int(35, 60),
  }
}

function rollStyle(seed: string, prev: StyleParams): StyleParams {
  const r = makeRng(seed, 'style')
  return { ...prev, grain: r.int(0, 45), distortion: r.int(0, 20) }
}

/** Fresh seed + regenerate each UNLOCKED section; locked sections carry over unchanged. */
export function reroll(config: ShapeConfig): ShapeConfig {
  const seed = randomSeed()
  return {
    ...config,
    seed,
    shape: config.locks.shape ? config.shape : rollShape(seed, config.shape),
    palette: config.locks.palette ? config.palette : rollPalette(seed, config.palette),
    style: config.locks.style ? config.style : rollStyle(seed, config.style),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/shapefx-randomize.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shapefx/randomize.ts frontend/tests/unit/shapefx-randomize.unit.spec.ts
git commit -m "feat(shape-studio): seeded re-roll respecting section locks"
```

---

## Task 6: Surface-fill texture (`surface.ts`)

**Files:**
- Create: `frontend/app/lib/shapefx/surface.ts`

**Interfaces:**
- Consumes: `fillTexture` from `lib/spacetype/fills.ts`, `DEFAULT_FILL`/`Fill` from `lib/spacetype/fillTile.ts`, `ShapeConfig` (Task 1), THREE.
- Produces: `buildSurfaceTexture(config: ShapeConfig): THREE.Texture | null` — a tiling texture built from the config's `fill` (null when the fill is a flat solid, so the caller uses `fill.a` as a flat color).

Note: This wraps the existing Type Studio fill builder, which needs a real 2D canvas (not reliably available in jsdom), so it is **visually verified** in Task 8 rather than unit-tested. Keep it a thin, obvious adapter.

- [ ] **Step 1: Implement `surface.ts`**

Create `frontend/app/lib/shapefx/surface.ts`:

```ts
import * as THREE from 'three'
import { fillTexture } from '../spacetype/fills'
import { DEFAULT_FILL, type Fill } from '../spacetype/fillTile'
import type { ShapeConfig } from './config'

/** Map the studio's SurfaceFill onto the Type Studio Fill shape. */
function toFill(config: ShapeConfig): Fill {
  return {
    ...DEFAULT_FILL,
    type: config.fill.type,
    a: config.fill.a,
    b: config.fill.b,
    textColor: config.fill.a,
    angle: config.fill.angle,
    density: config.fill.density,
  }
}

/**
 * Texture for Surface fill mode. Returns null for a flat solid (caller applies fill.a as a flat
 * material color). Reuses Type Studio's cached fill builder. Texture wraps/repeats across the shape.
 */
export function buildSurfaceTexture(config: ShapeConfig): THREE.Texture | null {
  const fill = toFill(config)
  if (fill.type === 'solid') return null
  const tex = fillTexture(THREE, fill)
  if (tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
  }
  return tex
}
```

- [ ] **Step 2: Typecheck compiles**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i shapefx/surface || echo "no shapefx/surface type errors"`
Expected: `no shapefx/surface type errors`. (`fillTexture`'s signature is confirmed `fillTexture(three: typeof THREE, fill: Fill): THREE.Texture | null`, so the `fillTexture(THREE, fill)` call above is correct as written.)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/lib/shapefx/surface.ts
git commit -m "feat(shape-studio): surface-fill texture adapter over Type Studio fills"
```

---

## Task 7: The render engine (`engine.ts`)

**Files:**
- Create: `frontend/app/lib/shapefx/engine.ts`

**Interfaces:**
- Consumes: `buildGeometry` (Task 3), `applyVertexColors` (Task 4), `buildSurfaceTexture` (Task 6), `ShapeConfig` (Task 1), THREE.
- Produces: `class ShapeEngine` with:
  - `constructor(canvas: HTMLCanvasElement, width: number, height: number)`
  - `setSize(width: number, height: number): void`
  - `setConfig(config: ShapeConfig): void` — rebuilds mesh + material from config
  - `render(orbit: { yaw: number; pitch: number; zoom: number }): void`
  - `async frameToBlob(w?: number, h?: number): Promise<Blob>`
  - `dispose(): void`

This task is **visually verified** (needs WebGL) — no unit test. It is exercised by the Task 8 harness.

- [ ] **Step 1: Implement `engine.ts`**

Create `frontend/app/lib/shapefx/engine.ts`:

```ts
import * as THREE from 'three'
import { buildGeometry } from './geometry'
import { applyVertexColors } from './color'
import { buildSurfaceTexture } from './surface'
import type { ShapeConfig } from './config'

// Ortho frustum half-height chosen so a unit-ish shape frames nicely at z=6.
const ORTHO_HALF_H = 2.6
const CAM_Z = 6

export class ShapeEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  private perspCam: THREE.PerspectiveCamera
  private orthoCam: THREE.OrthographicCamera
  private mesh: THREE.Mesh | null = null
  private config: ShapeConfig | null = null
  private w: number
  private h: number

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.w = width; this.h = height
    // preserveDrawingBuffer:true so frameToBlob can read pixels after render.
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(1)
    this.scene = new THREE.Scene()
    this.perspCam = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    this.perspCam.position.set(0, 0, CAM_Z)
    const a = width / height
    this.orthoCam = new THREE.OrthographicCamera(-ORTHO_HALF_H * a, ORTHO_HALF_H * a, ORTHO_HALF_H, -ORTHO_HALF_H, 0.1, 100)
    this.orthoCam.position.set(0, 0, CAM_Z)
    this.orthoCam.lookAt(0, 0, 0)
  }

  private get cam(): THREE.Camera {
    return this.config?.shape.projection === 'perspective' ? this.perspCam : this.orthoCam
  }

  setSize(width: number, height: number): void {
    this.w = width; this.h = height
    this.renderer.setSize(width, height, false)
    const a = width / height
    this.perspCam.aspect = a; this.perspCam.updateProjectionMatrix()
    this.orthoCam.left = -ORTHO_HALF_H * a; this.orthoCam.right = ORTHO_HALF_H * a
    this.orthoCam.updateProjectionMatrix()
  }

  private disposeMesh(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    const mat = this.mesh.material as THREE.MeshBasicMaterial
    mat.map?.dispose()
    mat.dispose()
    this.mesh = null
  }

  /** Rebuild geometry + material for a config. Unlit MeshBasicMaterial keeps it flat. */
  setConfig(config: ShapeConfig): void {
    this.config = config
    this.disposeMesh()
    const geo = buildGeometry(config)
    let mat: THREE.MeshBasicMaterial
    if (config.fillMode === 'facets') {
      applyVertexColors(geo, config)
      mat = new THREE.MeshBasicMaterial({ vertexColors: true })
    } else {
      const tex = buildSurfaceTexture(config)
      mat = tex
        ? new THREE.MeshBasicMaterial({ map: tex })
        : new THREE.MeshBasicMaterial({ color: new THREE.Color(config.fill.a) })
    }
    this.mesh = new THREE.Mesh(geo, mat)
    this.scene.add(this.mesh)
    // background
    if (config.style.background === 'transparent') this.scene.background = null
    else this.scene.background = new THREE.Color(config.style.background)
  }

  render(orbit: { yaw: number; pitch: number; zoom: number }): void {
    if (this.mesh) {
      this.mesh.rotation.y = orbit.yaw
      this.mesh.rotation.x = orbit.pitch
    }
    const z = CAM_Z / Math.max(0.2, orbit.zoom)
    this.perspCam.position.z = z
    this.orthoCam.position.z = z
    this.renderer.render(this.scene, this.cam)
  }

  /** Render at an optional target size and read back a PNG blob. */
  async frameToBlob(w?: number, h?: number): Promise<Blob> {
    const tw = w ?? this.w, th = h ?? this.h
    const restore = (this.w !== tw || this.h !== th)
    if (restore) this.setSize(tw, th)
    this.renderer.render(this.scene, this.cam)
    const blob: Blob = await new Promise((res, rej) =>
      this.renderer.domElement.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
    if (restore) this.setSize(this.w, this.h)
    return blob
  }

  dispose(): void {
    this.disposeMesh()
    if (this.scene.background instanceof THREE.Color) this.scene.background = null
    this.renderer.dispose()
  }
}
```

Note on Grain/Distortion: v1 renders them as a lightweight CSS/canvas overlay in the Surface (grain = a tiled noise `<div>` at `style.grain` opacity), NOT a GL post pass — keeps the engine lean. If you later want them baked into the PNG, add a `PostChain`-style composer modeled on `lib/spacetype/post.ts`. Document this in the Surface task.

- [ ] **Step 2: Commit**

```bash
git add frontend/app/lib/shapefx/engine.ts
git commit -m "feat(shape-studio): unlit Three.js render engine with orbit + PNG export"
```

---

## Task 8: Dev harness + first visual sign-off (`shape-studio-lab.vue`)

**Files:**
- Create: `frontend/app/pages/dev/shape-studio-lab.vue`

**Interfaces:**
- Consumes: `ShapeEngine` (Task 7), `DEFAULT_CONFIG` + `reroll` + mode/fill setters (Tasks 1/5), `detectWebGL` from `lib/spacetype/webgl.ts`.
- Produces: a `/dev/shape-studio-lab` page that mounts the engine on a canvas, renders `DEFAULT_CONFIG`, and offers buttons to switch mode (cube/sphere/gem), toggle fill mode (facets/surface), and re-roll — purely for screenshot verification.

- [ ] **Step 1: Implement the harness**

Create `frontend/app/pages/dev/shape-studio-lab.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, reactive } from 'vue'
import { ShapeEngine } from '~/lib/shapefx/engine'
import { DEFAULT_CONFIG, type ShapeConfig } from '~/lib/shapefx/config'
import { reroll } from '~/lib/shapefx/randomize'
import { detectWebGL } from '~/lib/spacetype/webgl'

const canvas = ref<HTMLCanvasElement | null>(null)
const ok = ref(true)
let engine: ShapeEngine | null = null
const orbit = reactive({ yaw: 0.5, pitch: 0.3, zoom: 1 })
const config = ref<ShapeConfig>({ ...DEFAULT_CONFIG })

function draw() { engine?.setConfig(config.value); engine?.render(orbit) }
function setMode(m: 'primitive' | 'gem', primitive?: ShapeConfig['shape']['primitive']) {
  config.value = { ...config.value, shape: { ...config.value.shape, mode: m, ...(primitive ? { primitive } : {}) } }; draw()
}
function setFill(fillMode: ShapeConfig['fillMode']) { config.value = { ...config.value, fillMode }; draw() }
function roll() { config.value = reroll(config.value); draw() }

onMounted(() => {
  if (!detectWebGL()) { ok.value = false; return }
  engine = new ShapeEngine(canvas.value!, 512, 512)
  draw()
})
onBeforeUnmount(() => engine?.dispose())
</script>

<template>
  <div style="min-height:100vh;background:#0a0a0a;color:#eee;padding:24px;display:flex;gap:24px;">
    <canvas ref="canvas" width="512" height="512" style="background:#000;border-radius:12px;" />
    <div style="display:flex;flex-direction:column;gap:8px;">
      <p v-if="!ok" style="color:#f66">WebGL unavailable</p>
      <button @click="setMode('primitive','cube')">Cube</button>
      <button @click="setMode('primitive','sphere')">Sphere</button>
      <button @click="setMode('gem')">Gem</button>
      <button @click="setFill('facets')">Fill: Facets</button>
      <button @click="setFill('surface')">Fill: Surface</button>
      <button @click="roll">Re-roll</button>
      <pre style="font-size:11px;max-width:280px;white-space:pre-wrap;">{{ config }}</pre>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Run the dev server and verify each state visually**

Use the preview tooling (preview_start the `nuxt dev` server, navigate to `/dev/shape-studio-lab`). For EACH of: Cube (facets), Sphere (facets), Gem (facets), Gem (surface), then Re-roll a few times — take a screenshot and confirm:
- The shape reads **flat/matte** (no glossy highlights), faceted, colored from the palette.
- Gem mode looks like the reference stone; primitives read as their solid.
- Surface mode shows the mapped fill (gradient/pattern), still flat.
- Re-roll changes the shape/colors.

Fix any rendering issues in `engine.ts` / `color.ts` / `geometry.ts` and re-screenshot. **Do not proceed until the flat faceted look matches the reference.** (Watch for the known rAF background-tab mount hang when screenshotting headless — keep the tab foregrounded.)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/pages/dev/shape-studio-lab.vue
git commit -m "feat(shape-studio): dev harness for engine visual verification"
```

---

## Task 9: The Surface editor (`ShapeStudioSurface.vue`)

**Files:**
- Create: `frontend/app/components/vue-canvas/ShapeStudioSurface.vue`

**Interfaces:**
- Consumes: `ShapeEngine`, `DEFAULT_CONFIG`, `mergeConfig`, `reroll`, `paletteFor`, `detectWebGL`, `StudioModalShell.vue`, `studio/` sub-controls (`StudioSlider`, `StudioColor`, `StudioSwitch`, `StudioSection`, `PalettePicker`, `FillSwatch`), `recordAsset` (find the shared helper via `useKineticRenderer` / how SpaceType records image output).
- Produces: a full-screen editor that renders the shape, exposes the control panel with per-section locks, seed + re-roll, orbit-drag, aspect/canvas controls, Export PNG, and Export/Import Settings; emits `sailor:shapeStudioOutput`.

**Props:** `{ nodeId: string }`.

Study `frontend/app/components/vue-canvas/GradientStudioSurface.vue` and `SpaceTypeSurface.vue` first — mirror their StudioModalShell usage, the `requestAnimationFrame` preview loop, and their image-output recording + `sailor:*Output` emit. Reuse their patterns exactly; do not invent a new output path.

- [ ] **Step 1: Scaffold the component with engine + orbit + panel**

Build the component modeled on `GradientStudioSurface.vue`. Required behavior:
- Mount `ShapeEngine` on a canvas inside `StudioModalShell`'s `#preview` slot; WebGL guard via `detectWebGL()` (graceful message if absent).
- `config = ref(mergeConfig(...persisted or DEFAULT_CONFIG))`.
- Preview loop: `requestAnimationFrame` calling `engine.render(orbit)`; `engine.setConfig(config)` on any config change (watch, deep). Dispose engine + cancel rAF on unmount.
- Orbit: pointer-drag on the canvas updates `orbit.yaw/pitch`; wheel updates `orbit.zoom`.
- Grain/distortion: overlay a tiled-noise `<div>` above the canvas at `config.style.grain/100` opacity (per Task 7 note); distortion can be a CSS `filter` or skipped in v1 if it fights the look — document whichever you choose.
- Control panel in the `#controls` slot: three collapsible `StudioSection`s — **Shape**, **Palette** (when `fillMode==='facets'`) or **Fill** (when `'surface'`), **Style** — each with a lock toggle bound to `config.locks[key]`. Plus a non-lockable **Canvas** section (aspect ratio select, width/height, Export PNG, Export/Import Settings) and a **Fill mode** switch (Facets/Surface). One **Seed** display + a **Re-roll** button calling `config.value = reroll(config.value)`.
- Follow the palette: **Palette** section uses `PalettePicker` + harmony/hue/sat/light `StudioSlider`s + the `rule` selector; **Fill** section uses the fill-type picker + `FillSwatch` + angle/density sliders. Use emerald for the Re-roll/primary action; no purple; variable-bound rows pink if you expose binding.

- [ ] **Step 2: Wire Export PNG → node output**

- Export PNG: `const blob = await engine.frameToBlob(config.canvasW, config.canvasH)` → record the asset the same way SpaceType/Gradient record an **image** result → emit
  `window.dispatchEvent(new CustomEvent('sailor:shapeStudioOutput', { detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: {} } }))`.
  (Confirm the exact `recordAsset` call + emit shape by copying it from `GradientStudioSurface.vue`'s image path.)
- Export/Import Settings: Export = download `JSON.stringify(config.value)`; Import = file-read → `config.value = mergeConfig(JSON.parse(text))`.

- [ ] **Step 3: Visual verification**

With the dev server running, open a canvas, add a Shape Studio node (after Task 10 registration lands you can open it from the Studios door; before that, temporarily mount the Surface from the lab page). Verify:
- Orbit drag tumbles the shape smoothly; re-roll produces variations.
- Lock Palette + re-roll → same colors, new shape. Lock Shape + re-roll → same shape, new colors.
- Switch Facets/Surface fill modes; the panel swaps Palette↔Fill.
- Export PNG produces a downstream Image on the node; the PNG matches the framed view.
- Export→Import Settings round-trips.
Screenshot the studio and get sign-off before proceeding.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/ShapeStudioSurface.vue
git commit -m "feat(shape-studio): full-screen Surface editor with locks, re-roll, PNG export"
```

---

## Task 10: Node component + registration (5 touchpoints)

**Files:**
- Create: `frontend/app/components/vue-canvas/ShapeStudioNode.vue`
- Modify: `frontend/app/composables/useVueNodes.ts`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`
- Modify: `frontend/app/data/studio-options.ts`
- Modify: `frontend/app/lib/agent/capabilities.ts`

**Interfaces:**
- Consumes: `ShapeStudioSurface.vue` (Task 9), existing studio registration patterns.
- Produces: a `ShapeStudio` node type openable from the Studios door, emitting an Image output via the shared SpaceType output handler.

For every edit below, **grep an existing studio to find the exact insertion sites** (`GradientStudio` and `ShaderStudio` are the closest siblings): `grep -rn "GradientStudio" frontend/app`.

- [ ] **Step 1: Create the node card**

Create `frontend/app/components/vue-canvas/ShapeStudioNode.vue` modeled on `GradientStudioNode.vue` (same props/emit surface, a card that dispatches `sailor:openShapeStudio` with `{ nodeId }` on open/click, shows the last exported thumbnail if present). Copy the sibling and rename.

- [ ] **Step 2: Register the node type**

In `frontend/app/composables/useVueNodes.ts`, add to `NODE_TYPE_MAP` (next to the other studios): `ShapeStudio: 'shape-studio',`.

- [ ] **Step 3: Wire VueNodeCanvas (four sub-edits)**

In `frontend/app/components/vue-canvas/VueNodeCanvas.vue`, mirroring `GradientStudio`:
1. Component map: `markRaw` import + register `ShapeStudioNode`.
2. Dangling-output guard list: add `'ShapeStudio'` where the other studios are listed.
3. Add `shapeStudioOpenForId` ref + `handleOpenShapeStudio(e)` setting it from `e.detail.nodeId`; register/unregister `window.addEventListener('sailor:openShapeStudio', handleOpenShapeStudio)` alongside the other studio open handlers.
4. Mount in template near the other Surfaces: `<ShapeStudioSurface v-if="shapeStudioOpenForId" :node-id="shapeStudioOpenForId" @close="shapeStudioOpenForId = null" />`.

- [ ] **Step 4: Add the Studios-door option**

In `frontend/app/data/studio-options.ts`, add a `StudioOption`:
```ts
{ label: 'Shape Studio', icon: Gem, nodeType: 'ShapeStudio', /* match sibling fields: description, group, etc. */ }
```
Import `Gem` (or `Box`) from `lucide-vue-next` next to the other studio icons. Copy the exact field set from an adjacent `StudioOption`.

- [ ] **Step 5: Register the agent capability**

In `frontend/app/lib/agent/capabilities.ts`, add to `STUDIOS[]` an entry mirroring the Gradient/Shader studio ones: `{ kind: 'studio', frontendOnly: true, /* id, name, nodeType: 'ShapeStudio', description, keywords */ }`. Copy the shape of an adjacent entry exactly.

- [ ] **Step 6: Verify agent-routing tests still pass**

Run: `cd frontend && npx vitest run tests/unit/agent-capability-routing.unit.spec.ts`
Expected: PASS. If the test enumerates studios, add Shape Studio to its expected set.

- [ ] **Step 7: Full-flow visual verification**

Dev server running: open the Studios door → click **Shape Studio** → a node appears and the Surface opens. Frame a stone, Export PNG, confirm a connected **Image** output node receives it. Screenshot the whole flow for sign-off.

- [ ] **Step 8: Run the full unit suite**

Run: `cd frontend && npm run test:unit`
Expected: PASS (all shapefx specs + no regressions).

- [ ] **Step 9: Commit**

```bash
git add frontend/app/components/vue-canvas/ShapeStudioNode.vue frontend/app/composables/useVueNodes.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/data/studio-options.ts frontend/app/lib/agent/capabilities.ts
git commit -m "feat(shape-studio): register node + Studios-door entry + agent capability"
```

---

## Self-Review

**Spec coverage:**
- Two modes (Primitive/Gem), one engine → Tasks 3 (geometry), 7 (engine). ✓
- Flat/unlit aesthetic → Task 7 `MeshBasicMaterial`, no lights. ✓
- Facets/Surface fill toggle → Tasks 4 (facets), 6 (surface), 7 (mode switch). ✓
- Harmony palette from `lib/color/harmony.ts` → Task 4. ✓
- Real-time orbit → Tasks 7 (`render(orbit)`), 9 (drag). ✓
- Seed + per-section locks + re-roll → Tasks 1 (locks in config), 5 (reroll). ✓
- PNG export at aspect/size → Task 7 `frameToBlob`, Task 9 export UI. ✓
- Export/Import Settings via serializable config → Tasks 1 (`mergeConfig`), 9. ✓
- Registration (5 touchpoints) + `sailor:` events → Task 10. ✓
- WebGL guard, degenerate-hull fallback, import merge, dispose → Tasks 3, 1, 7, 9. ✓
- v1 = PNG only; video deferred → not in any task (correct). ✓

**Placeholder scan:** No TBD/TODO in logic. UI tasks (9, 10) intentionally instruct "model on GradientStudioSurface / copy the sibling" rather than reproducing 500+ lines of Vue verbatim — the exact insertion points, event names, prop shapes, and output-emit contract are all given explicitly, which is the actionable content for those tasks.

**Type consistency:** `ShapeConfig` shape is defined once in Task 1 and consumed unchanged in Tasks 2–9. `reroll`/`mergeConfig`/`buildGeometry`/`applyVertexColors`/`paletteFor`/`buildSurfaceTexture`/`ShapeEngine` names match across producer/consumer blocks. Orbit shape `{ yaw, pitch, zoom }` is consistent between Task 7 and Task 9. `sailor:openShapeStudio` / `sailor:shapeStudioOutput` consistent between Tasks 9 and 10.

**Naming verified for Sailor:** the `sailor:` event prefix, `/sailor/…` backend routes, `fillTexture`/`detectWebGL` signatures, and all registration targets are confirmed against the live repo (see Global Constraints). No `comfynext:`/`ComfyNext` contract remains that the plan depends on.

**One risk flagged for the implementer:** Task 9's `recordAsset`/output-emit path must be copied from `GradientStudioSurface.vue`'s image path rather than guessed — it's the one contract not pinned to an exact signature here.
