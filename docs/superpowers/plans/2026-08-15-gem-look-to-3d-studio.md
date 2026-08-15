# Gem Look → 3D Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Shape Studio's distinctive faceted-gem look into 3D Studio (`scene3d`) as a new `gem` primitive plus harmony-palette, scatter/ombre coloring, and a shared-post distortion effect — additive only, Shape Studio untouched.

**Architecture:** 3D Studio renders a `SceneDoc` of `SceneObject`s through a three.js engine. Geometry is dispatched by `geometryFor(kind, …)`; per-primitive params live in one `PRIMITIVE_PARAMS` table; the gradient material colors facets on the GPU via an injected shader keyed by `gradientShading` + a mutable `uMode`; post-processing runs a shared catalog-frag chain. The port adds one primitive kind and extends those three existing systems — no architectural change.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, three.js (+ `three/examples/jsm` ConvexGeometry), Vitest for unit tests, the in-app Browser pane for render-proof.

## Global Constraints

- **`scene3d/config.ts` must stay three-free.** Its import graph is dynamically pulled by the Collection resolver and must never drag in `three` (see its header comment). `color/harmony.ts` + `color/convert.ts` are pure — safe to import; never import `three` or `materials.ts`/`post.ts` into `config.ts`.
- **`PRIMITIVE_KINDS`, `MODIFIER_SPECS` options, and `PostParamDef` option arrays are persistence contracts — append, never reorder.** Stored values are indices/keys.
- **Additive-only / no-op parity:** every new persisted field defaults to the pre-existing behavior (`paletteMode: 'manual'`, `distort: false`), so any saved scene/doc renders byte-identically until the user opts in.
- **Sanitizer round-trip rule:** any new persisted field MUST be added to the relevant tolerant parser (`parseMaterial` in `config.ts`, `PostSettings` sanitize, `PRIMITIVE_PARAMS`) or it will be silently dropped on save→load.
- **Run unit tests from `frontend/`:** `npx vitest run <path>`. Full suite baseline is large; run the specific file per task.
- **Render-proof, not synthetic:** GPU coloring/geometry changes must be proven with a real render + a pixel-variance or vertex-count assertion, never "it didn't throw" (per repo's "parity tests agree on a wrong answer" history).

---

### Task 1: Gem geometry module (`gem.ts`)

Pure, three-only geometry builder — the one genuinely-missing piece. Ported from `shapefx/points.ts` + `shapefx/geometry.ts`, self-contained (no `shapefx` import — that module is retired in Phase 2).

**Files:**
- Create: `frontend/app/lib/scene3d/gem.ts`
- Test: `frontend/tests/unit/scene3d-gem.unit.spec.ts`

**Interfaces:**
- Produces:
  - `gemPoints(points: number, spread: number, depth: number, seed: number): THREE.Vector3[]`
  - `gemGeometry(points: number, spread: number, depth: number, seed: number): THREE.BufferGeometry` — non-degenerate convex hull with a `uv` attribute, or a `TetrahedronGeometry(0.55, 0)` fallback when the hull degenerates.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/scene3d-gem.unit.spec.ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { gemPoints, gemGeometry } from '~/lib/scene3d/gem'

describe('scene3d gem geometry', () => {
  it('gemPoints is deterministic for a seed', () => {
    const a = gemPoints(16, 0.5, 1, 3)
    const b = gemPoints(16, 0.5, 1, 3)
    expect(a.length).toBe(16)
    expect(a.map(v => [v.x, v.y, v.z])).toEqual(b.map(v => [v.x, v.y, v.z]))
  })

  it('different seeds produce different clouds', () => {
    const a = gemPoints(16, 0.5, 1, 3)
    const b = gemPoints(16, 0.5, 1, 4)
    expect(a.map(v => v.x)).not.toEqual(b.map(v => v.x))
  })

  it('clamps the point count so a junk import cannot hang the hull', () => {
    expect(gemPoints(1e8, 0.5, 1, 0).length).toBeLessThanOrEqual(64)
    expect(gemPoints(0, 0.5, 1, 0).length).toBeGreaterThanOrEqual(4)
  })

  it('gemGeometry returns a solid hull with UVs', () => {
    const geo = gemGeometry(20, 0.6, 1, 1)
    expect(geo.getAttribute('position').count).toBeGreaterThanOrEqual(12)
    expect(geo.getAttribute('uv')).toBeTruthy()
    geo.dispose()
  })

  it('gemGeometry falls back to a tetrahedron on a degenerate cloud', () => {
    // depth 0 + spread 0 collapses points onto a plane → hull degenerates
    const geo = gemGeometry(4, 0, 0, 0)
    expect(geo.getAttribute('position').count).toBeGreaterThanOrEqual(12)
    geo.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-gem.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/scene3d/gem`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/scene3d/gem.ts
import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'

// Self-contained seeded RNG (mulberry32 over an xmur3 string hash). Duplicated
// from shapefx/rng.ts on purpose: shapefx is retired in Phase 2, so scene3d must
// not depend on it. Deterministic in the numeric seed.
function rngFor(seed: number): () => number {
  let h = 1779033703 ^ String(seed).length
  const s = `gem|${seed}`
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = (Math.imul(h ^ (h >>> 16), 2246822507) ^ (h >>> 13)) >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Seeded point cloud for a gem. Points fill a unit-ish ball, biased by `spread`
 * (tight → wide) and stretched along Z by `depth`. Their convex hull becomes the
 * faceted stone. Clamps the count at BOTH ends: a junk import (points: 1e8) would
 * otherwise hang ConvexGeometry.
 */
export function gemPoints(points: number, spread: number, depth: number, seed: number): THREE.Vector3[] {
  const count = Math.min(64, Math.max(4, Math.round(points)))
  const rnd = rngFor(seed)
  const out: THREE.Vector3[] = []
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1
    const theta = rnd() * Math.PI * 2
    const r = Math.pow(rnd(), 1 - 0.6 * spread) // spread high → radii pushed outward
    const s = Math.sqrt(1 - u * u)
    const x = r * s * Math.cos(theta) * (0.6 + spread)
    const y = r * s * Math.sin(theta) * (0.6 + spread)
    const z = r * u * depth
    out.push(new THREE.Vector3(x, y, z))
  }
  return out
}

/** Planar (front-facing XY, normalized to the shape's own bounds) UV backfill —
 *  ConvexGeometry sets only position + normal, so a surface fill would otherwise
 *  read UV (0,0) everywhere and render one flat texel. */
function ensureUV(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute('uv')) return
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i)
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1
  const uv = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    uv[i * 2] = (pos.getX(i) - minX) / spanX
    uv[i * 2 + 1] = (pos.getY(i) - minY) / spanY
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/** The gem's convex-hull geometry. Scaled to sit in the studio's ~unit-cube
 *  footprint like every other primitive, with a guaranteed-solid fallback. */
export function gemGeometry(points: number, spread: number, depth: number, seed: number): THREE.BufferGeometry {
  const raw = gemPoints(points, spread, depth, seed)
  let geo: THREE.BufferGeometry
  try {
    geo = new ConvexGeometry(raw)
    if (geo.getAttribute('position').count < 12) throw new Error('degenerate hull')
  } catch {
    geo = new THREE.TetrahedronGeometry(0.55, 0)
  }
  geo.scale(0.4, 0.4, 0.4) // bring the ~1.6-wide cloud into the unit-cube footprint
  ensureUV(geo)
  return geo
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-gem.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/gem.ts frontend/tests/unit/scene3d-gem.unit.spec.ts
git commit -m "feat(scene3d): gem convex-hull geometry module"
```

---

### Task 2: Register the gem primitive

Wire `gem` into the kind enum, param table, geometry dispatch, and the add-menu — so a user can place one and tune points/spread/depth/seed. The facet-flatten + jitter + prismatic shading already apply on top for free.

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` (`PrimitiveKind` ~23-29; `PRIMITIVE_KINDS` ~348-354)
- Modify: `frontend/app/lib/scene3d/primParams.ts` (`PRIMITIVE_PARAMS` ~47-150)
- Modify: `frontend/app/lib/scene3d/engine.ts` (`geometryFor` switch ~91-187)
- Modify: `frontend/app/lib/scene3d/primGroups.ts` (add-menu list)
- Test: `frontend/tests/unit/scene3d-gem.unit.spec.ts` (extend), and verify `scene3d-config.unit.spec.ts` drift test still passes

**Interfaces:**
- Consumes: `gemGeometry(...)` from Task 1.
- Produces: `PrimitiveKind` now includes `'gem'`; `PRIMITIVE_PARAMS['gem']` declares keys `points`, `spread`, `depth`, `gemSeed`; `geometryFor('gem', params)` returns the hull.

- [ ] **Step 1: Write the failing test (extend Task 1's spec)**

```ts
// append to frontend/tests/unit/scene3d-gem.unit.spec.ts
import { PRIMITIVE_KINDS } from '~/lib/scene3d/config'
import { PRIMITIVE_PARAMS } from '~/lib/scene3d/primParams'
import { geometryFor } from '~/lib/scene3d/engine'

describe('scene3d gem registration', () => {
  it('gem is a registered, param-carrying kind', () => {
    expect(PRIMITIVE_KINDS).toContain('gem')
    expect(PRIMITIVE_PARAMS.gem.map(p => p.key)).toEqual(['points', 'spread', 'depth', 'gemSeed'])
  })

  it('geometryFor builds the gem hull from params', () => {
    const geo = geometryFor('gem', { points: 24, spread: 0.6, depth: 1, gemSeed: 2 })
    expect(geo.getAttribute('position').count).toBeGreaterThanOrEqual(12)
    expect(geo.getAttribute('uv')).toBeTruthy()
    geo.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-gem.unit.spec.ts`
Expected: FAIL — `'gem'` not in `PRIMITIVE_KINDS`; `PRIMITIVE_PARAMS.gem` undefined.

- [ ] **Step 3a: Add the kind (config.ts)**

In `frontend/app/lib/scene3d/config.ts`, extend the union (line ~28-29) and the list (line ~353). Append only:

```ts
export type PrimitiveKind =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
  | 'capsule' | 'pyramid' | 'prism'
  | 'icosahedron' | 'octahedron' | 'dodecahedron'
  | 'torusKnot' | 'ring'
  | 'text' | 'shape' | 'svgPath'
  | 'mesh'
  | 'gem'
```

```ts
export const PRIMITIVE_KINDS: PrimitiveKind[] = [
  'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
  'capsule', 'pyramid', 'prism',
  'icosahedron', 'octahedron', 'dodecahedron',
  'torusKnot', 'ring',
  'text', 'shape', 'svgPath', 'mesh',
  'gem',
]
```

- [ ] **Step 3b: Add the params (primParams.ts)**

In `PRIMITIVE_PARAMS` (before the closing `}` after `mesh: []`, line ~149), add:

```ts
  // Convex-hull gem (see gem.ts). Point count drives facet density; spread widens
  // the stone; depth stretches it along Z; gemSeed re-rolls the hull.
  gem: [
    { key: 'points', label: 'Facets', hint: 'How many points form the stone — more gives finer facets', min: 4, max: 40, step: 1, default: 14 },
    { key: 'spread', label: 'Spread', hint: 'Tight, pointy stone → wide, full one', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'depth', label: 'Depth', hint: 'Flat, cut-gem slab → deep, chunky stone', min: 0.2, max: 2, step: 0.01, default: 1 },
    { key: 'gemSeed', label: 'Seed', hint: 'Shuffles the facets into a different stone', min: 0, max: 99, step: 1, default: 0 },
  ],
```

- [ ] **Step 3c: Add the geometry dispatch (engine.ts)**

In `geometryFor`'s switch, add a case (import `gemGeometry` at the top of `engine.ts`):

```ts
    case 'gem':
      return gemGeometry(p('points'), p('spread'), p('depth'), p('gemSeed'))
```

Add near the other geometry imports at the top of `engine.ts`:

```ts
import { gemGeometry } from './gem'
```

- [ ] **Step 3d: Add to the add-menu (primGroups.ts)**

Open `frontend/app/lib/scene3d/primGroups.ts`, find the `PRIM_GROUPS` group that best fits a faceted solid (the same group as `icosahedron`/`octahedron`), and add an entry. Use an existing imported icon (e.g. the one used for `octahedron`) to avoid a new dependency:

```ts
    { kind: 'gem', label: 'Gem', icon: Gem },
```

If no `Gem` icon is imported, reuse the octahedron/diamond icon already imported in that file rather than adding an import. (The `scene3d-config.unit.spec.ts` drift test asserts PRIM_GROUPS covers every placeable kind — `gem` is placeable, so this entry is REQUIRED for that test to pass.)

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run tests/unit/scene3d-gem.unit.spec.ts tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-params.unit.spec.ts`
Expected: PASS (gem tests green; config drift test green now that PRIM_GROUPS includes `gem`).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/config.ts frontend/app/lib/scene3d/primParams.ts frontend/app/lib/scene3d/engine.ts frontend/app/lib/scene3d/primGroups.ts frontend/tests/unit/scene3d-gem.unit.spec.ts
git commit -m "feat(scene3d): register gem primitive (kind, params, dispatch, menu)"
```

---

### Task 3: Harmony palette

Let a gradient material auto-generate a harmonious dark→light ramp from one hue/sat/light seed + a harmony scheme, instead of hand-authoring stops. Reuses the entire existing ramp/shading GPU path — only the *source* of the stops changes.

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` — `SceneMaterial` fields (~90-135), `MATERIAL_DEFAULTS` (~405-411 area), `parseMaterial` (~811 area), and add `rampStopsOf` next to `gradientStopsOf` (~490)
- Modify: `frontend/app/lib/scene3d/materials.ts` — build path (line 738) and update path (lines 1002, 1005) use `rampStopsOf` instead of `gradientStopsOf`
- Test: `frontend/tests/unit/scene3d-harmony-palette.unit.spec.ts`

**Interfaces:**
- Consumes: `harmonize`, `toStops`, `HarmonyType` from `~/lib/color/harmony`; `oklchToHex` from `~/lib/color/convert`.
- Produces: `SceneMaterial` gains optional `paletteMode: 'manual' | 'harmony'`, `paletteHue`, `paletteSat`, `paletteLight`, `paletteHarmony: HarmonyType`; `rampStopsOf(mat): GradientStop[]` returns harmony stops in harmony mode, else `gradientStopsOf(mat)`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/scene3d-harmony-palette.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { rampStopsOf, parseMaterialForTest } from './helpers/scene3d-material'
import type { SceneMaterial } from '~/lib/scene3d/config'

const base: SceneMaterial = { type: 'gradient', color: '#222222', roughness: 0.5, metalness: 0 }

describe('scene3d harmony palette', () => {
  it('manual mode returns the authored/synthesized stops unchanged', () => {
    const stops = rampStopsOf({ ...base, gradientB: '#ffffff' })
    expect(stops.length).toBe(2)
    expect(stops[0]!.color).toBe('#222222')
  })

  it('harmony mode generates a monotonic dark→light ramp', () => {
    const stops = rampStopsOf({
      ...base, paletteMode: 'harmony', paletteHue: 210, paletteSat: 0.5,
      paletteLight: 0.6, paletteHarmony: 'analogous',
    })
    expect(stops.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.pos).toBeGreaterThan(stops[i - 1]!.pos)
    }
  })

  it('harmony mode is deterministic in its inputs', () => {
    const mk = () => rampStopsOf({ ...base, paletteMode: 'harmony', paletteHue: 40, paletteSat: 0.6, paletteLight: 0.5, paletteHarmony: 'triadic' })
    expect(mk()).toEqual(mk())
  })

  it('palette fields round-trip through parseMaterial', () => {
    const m = parseMaterialForTest({ type: 'gradient', color: '#222', roughness: 0.5, metalness: 0, paletteMode: 'harmony', paletteHue: 123, paletteSat: 0.4, paletteLight: 0.7, paletteHarmony: 'complementary' })
    expect(m.paletteMode).toBe('harmony')
    expect(m.paletteHue).toBe(123)
    expect(m.paletteHarmony).toBe('complementary')
  })
})
```

Create the tiny test helper so the pure functions are reachable without three:

```ts
// frontend/tests/unit/helpers/scene3d-material.ts
export { rampStopsOf } from '~/lib/scene3d/config'
// parseMaterial is module-private in config.ts; expose a thin test shim via serializeDoc/parseDoc.
import { parseDoc, serializeDoc, defaultDoc, createPrimitive } from '~/lib/scene3d/config'
import type { SceneMaterial } from '~/lib/scene3d/config'
export function parseMaterialForTest(raw: any): SceneMaterial {
  const doc = defaultDoc()
  const obj = createPrimitive('box')
  obj.material = raw
  doc.objects = [obj as any]
  const round = parseDoc(serializeDoc(doc))
  return (round.objects[0] as any).material
}
```

(If `parseDoc`/`serializeDoc` are named differently in `config.ts`, use the actual serialize/parse entry points — grep `export function serialize`/`parse` in `config.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-harmony-palette.unit.spec.ts`
Expected: FAIL — `rampStopsOf` is not exported; palette fields dropped by `parseMaterial`.

- [ ] **Step 3a: Add the material fields + defaults (config.ts)**

Import at the top of `config.ts` (pure, three-free):

```ts
import { harmonize, type HarmonyType } from '~/lib/color/harmony'
import { oklchToHex } from '~/lib/color/convert'
import { toStops } from '~/lib/color/harmony'
```

Add to the `SceneMaterial` interface (after `gradientShading`, ~line 112):

```ts
  /** When 'harmony', the gradient ramp is GENERATED from paletteHue/Sat/Light +
   *  paletteHarmony instead of the authored `gradientStops` — see rampStopsOf.
   *  Absent/'manual' keeps the authored stops, so old docs are unchanged. */
  paletteMode?: 'manual' | 'harmony'
  paletteHue?: number       // 0..360, seed hue
  paletteSat?: number       // 0..1, mapped to OKLCH chroma 0..0.4
  paletteLight?: number     // 0..1, OKLCH lightness of the seed
  paletteHarmony?: HarmonyType
```

Add defaults to `MATERIAL_DEFAULTS` (the object near line 405-411 that holds `gradientShading: 'smooth'`):

```ts
  paletteMode: 'manual' as const,
  paletteHue: 210,
  paletteSat: 0.5,
  paletteLight: 0.6,
  paletteHarmony: 'analogous' as HarmonyType,
```

- [ ] **Step 3b: Add `rampStopsOf` (config.ts, next to `gradientStopsOf` ~496)**

```ts
/** Ramp stops for the RENDER path: a harmony-generated dark→light ramp when
 *  paletteMode is 'harmony', else the authored/synthesized stops. Kept separate
 *  from gradientStopsOf (the editor's by-reference model) so the ramp editor is
 *  untouched while the rendered ramp can be generated. Pure — no three. */
export function rampStopsOf(mat: SceneMaterial): GradientStop[] {
  if (mat.paletteMode !== 'harmony') return gradientStopsOf(mat)
  const hue = mat.paletteHue ?? MATERIAL_DEFAULTS.paletteHue
  const sat = mat.paletteSat ?? MATERIAL_DEFAULTS.paletteSat
  const light = mat.paletteLight ?? MATERIAL_DEFAULTS.paletteLight
  const scheme = mat.paletteHarmony ?? MATERIAL_DEFAULTS.paletteHarmony
  const seedHex = oklchToHex(light, sat * 0.4, hue)
  const N = 5
  return toStops(harmonize(seedHex, scheme, N), N)
}
```

- [ ] **Step 3c: Parse the new fields (config.ts, `parseMaterial` ~811)**

After the `gradientShading` line, add:

```ts
    if (m?.paletteMode === 'manual' || m?.paletteMode === 'harmony') out.paletteMode = m.paletteMode
    if (typeof m?.paletteHue === 'number') out.paletteHue = num(m.paletteHue, MATERIAL_DEFAULTS.paletteHue)
    if (typeof m?.paletteSat === 'number') out.paletteSat = num(m.paletteSat, MATERIAL_DEFAULTS.paletteSat)
    if (typeof m?.paletteLight === 'number') out.paletteLight = num(m.paletteLight, MATERIAL_DEFAULTS.paletteLight)
    if (typeof m?.paletteHarmony === 'string' && HARMONY_TYPES.includes(m.paletteHarmony)) out.paletteHarmony = m.paletteHarmony
```

Import `HARMONY_TYPES` alongside the harmony imports:

```ts
import { harmonize, toStops, HARMONY_TYPES, type HarmonyType } from '~/lib/color/harmony'
```

- [ ] **Step 3d: Point the render path at `rampStopsOf` (materials.ts)**

- Line 738: `const stops = rampStopsOf(mat)` (was `gradientStopsOf(mat)`).
- Line 1002: `const sig = rampSignature(rampStopsOf(mat))`.
- Line 1005: `u.uRamp.value = buildRampTexture(rampStopsOf(mat))`.

Update the import at `materials.ts:15` to include `rampStopsOf`:

```ts
  MATERIAL_DEFAULTS, gradientAngles, gradientDirection, gradientStopsOf, rampStopsOf, opalStopsOf,
```

(Leave `opalStopsOf` and the opal path untouched — harmony palette is scoped to the gradient material, which is the gem's coloring path.)

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run tests/unit/scene3d-harmony-palette.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts`
Expected: PASS. (Existing material tests still green — manual mode is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/config.ts frontend/app/lib/scene3d/materials.ts frontend/tests/unit/scene3d-harmony-palette.unit.spec.ts frontend/tests/unit/helpers/scene3d-material.ts
git commit -m "feat(scene3d): harmony-generated gradient palette (rampStopsOf)"
```

---

### Task 4: scatter + ombre coloring modes

Two new facet coloring modes alongside faceted/prismatic. Both ride the existing facet program via new `uMode` branches (3 = scatter, 4 = ombre) and a new per-face random attribute.

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` — widen `gradientShading` union (~112) + its parse guard (~811)
- Modify: `frontend/app/lib/scene3d/engine.ts` — `addFaceExtentAttributes` (~281) also writes `aFaceRand`
- Modify: `frontend/app/lib/scene3d/materials.ts` — facet vert/frag GLSL decls+bodies (512-541), `uMode` map in build (749) and update (1013)
- Test: `frontend/tests/unit/scene3d-facet-coloring.unit.spec.ts`

**Interfaces:**
- Consumes: the facet program from Task 3's untouched render path.
- Produces: `gradientShading` union now `'smooth' | 'faceted' | 'prismatic' | 'scatter' | 'ombre'`; geometry carries an `aFaceRand` attribute; `uMode` ∈ {1,2,3,4}.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/scene3d-facet-coloring.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { geometryFor } from '~/lib/scene3d/engine'
import { buildGeometry } from '~/lib/scene3d/engine'
import { parseMaterialForTest } from './helpers/scene3d-material'

describe('scene3d facet coloring modes', () => {
  it('scatter and ombre survive material parsing', () => {
    for (const mode of ['scatter', 'ombre'] as const) {
      const m = parseMaterialForTest({ type: 'gradient', color: '#222', roughness: 0.5, metalness: 0, gradientShading: mode })
      expect(m.gradientShading).toBe(mode)
    }
  })

  it('facet-variant geometry carries a per-face random attribute', () => {
    // buildGeometry(kind, params, modifiers, variant, content, font)
    const geo = buildGeometry('gem', { points: 20, spread: 0.6, depth: 1, gemSeed: 1 }, undefined, 'facet')
    const rand = geo.getAttribute('aFaceRand')
    expect(rand).toBeTruthy()
    expect(rand!.count).toBe(geo.getAttribute('position').count)
    // same value across a face's 3 verts, different across faces
    expect(rand!.getX(0)).toBe(rand!.getX(1))
    expect(rand!.getX(0)).toBe(rand!.getX(2))
    expect(rand!.getX(0)).not.toBe(rand!.getX(3))
    geo.dispose()
  })
})
```

(Confirm `buildGeometry`'s exact signature at `engine.ts:307-311` and match the argument order in the test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-facet-coloring.unit.spec.ts`
Expected: FAIL — parse guard rejects `scatter`/`ombre`; no `aFaceRand` attribute.

- [ ] **Step 3a: Widen the union + parse guard (config.ts)**

Line ~112:

```ts
  gradientShading?: 'smooth' | 'faceted' | 'prismatic' | 'scatter' | 'ombre'
```

Line ~811 — replace the guard with a set membership check:

```ts
    if (['smooth', 'faceted', 'prismatic', 'scatter', 'ombre'].includes(m?.gradientShading)) out.gradientShading = m.gradientShading
```

- [ ] **Step 3b: Emit `aFaceRand` (engine.ts `addFaceExtentAttributes`, ~281)**

Add a per-face random (hash of the face's first-vertex position → stable, seedless), written identically to all 3 verts of the face:

```ts
function addFaceExtentAttributes(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  const min = new Float32Array(n * 3)
  const max = new Float32Array(n * 3)
  const rand = new Float32Array(n)
  for (let v = 0; v < n; v += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const a = pos.getComponent(v, axis)
      const b = pos.getComponent(v + 1, axis)
      const c = pos.getComponent(v + 2, axis)
      const lo = Math.min(a, b, c)
      const hi = Math.max(a, b, c)
      for (let k = 0; k < 3; k++) {
        min[(v + k) * 3 + axis] = lo
        max[(v + k) * 3 + axis] = hi
      }
    }
    // Stable per-face random from the face centroid — no seed, deterministic.
    const cx = pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2)
    const cy = pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2)
    let h = Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453
    h = h - Math.floor(h)
    for (let k = 0; k < 3; k++) rand[v + k] = h
  }
  geo.setAttribute('aFaceMin', new THREE.BufferAttribute(min, 3))
  geo.setAttribute('aFaceMax', new THREE.BufferAttribute(max, 3))
  geo.setAttribute('aFaceRand', new THREE.BufferAttribute(rand, 1))
}
```

- [ ] **Step 3c: Extend the facet shader (materials.ts 512-541)**

Add the attribute + varying to `GRADIENT_FACET_VERT_DECL`:

```glsl
attribute vec3 aFaceMin;
attribute vec3 aFaceMax;
attribute float aFaceRand;
varying vec3 vGradPos;
flat varying vec3 vGradFlat;
flat varying vec3 vFaceMin;
flat varying vec3 vFaceMax;
flat varying float vFaceRand;
```

Add to `GRADIENT_FACET_VERT_BODY`:

```glsl
vFaceRand = aFaceRand;
```

Add the varying to `GRADIENT_FACET_FRAG_DECL` (after the `vFaceMax` flat varying):

```glsl
flat varying float vFaceRand;
```

Replace `GRADIENT_FACET_FRAG_BODY` with the 4-mode version:

```glsl
#include <color_fragment>
{
  float t;
  if (uMode == 2) {
    // prismatic: full ramp across THIS face's own extent
    t = gradT(vGradPos, vFaceMin, vFaceMax);
  } else if (uMode == 3) {
    // scatter: one random discrete swatch per face (6 buckets)
    t = (floor(vFaceRand * 6.0) + 0.5) / 6.0;
  } else if (uMode == 4) {
    // ombre: per-face ramp sample nudged by a per-face dither → stippled bands
    t = gradT(vGradFlat, uBoxMin, uBoxMax) + (vFaceRand - 0.5) * 0.15;
  } else {
    // faceted (1): one flat tone per face against the whole-object box
    t = gradT(vGradFlat, uBoxMin, uBoxMax);
  }
  diffuseColor.rgb = gradSample(clamp(t, 0.0, 1.0));
}
```

- [ ] **Step 3d: Map `uMode` for the new modes (materials.ts 749 + 1013)**

Add a helper near the gradient build and use it in both places (replace the two `=== 'prismatic' ? 2 : 1` expressions):

```ts
const FACET_UMODE: Record<string, number> = { faceted: 1, prismatic: 2, scatter: 3, ombre: 4 }
const facetUMode = (shading: string | undefined): number => FACET_UMODE[shading ?? 'faceted'] ?? 1
```

Line 749:

```ts
      if (facetProgram) gradUniforms.uMode = { value: facetUMode(shading) }
```

Line 1013:

```ts
      if (u.uMode) u.uMode.value = facetUMode(mat.gradientShading ?? MATERIAL_DEFAULTS.gradientShading)
```

(`facetProgram = shading !== 'smooth'` at line 737 already routes scatter/ombre to the facet program — no change there.)

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run tests/unit/scene3d-facet-coloring.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts`
Expected: PASS. (Existing engine/material tests still green — `aFaceRand` is additive; other modes unchanged.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/config.ts frontend/app/lib/scene3d/engine.ts frontend/app/lib/scene3d/materials.ts frontend/tests/unit/scene3d-facet-coloring.unit.spec.ts
git commit -m "feat(scene3d): scatter + ombre facet coloring modes"
```

---

### Task 5: Screen-space distortion (shared post effect)

Add a catalog `distort.frag` (port of `shapefx/post.ts`'s two-noise-field UV warp) and register it as a shared post effect, so 3D Studio — and every studio on the shared stack — gains a final-image warp. No-op by default.

**Files:**
- Create: `shader_effects/distort.frag`
- Modify: `shader_effects/manifest.json` (register `distort` + its uniform defaults)
- Modify: `frontend/shared/spacetype/state.ts` — add `distort` / `distortAmount` to the `PostSettings` type
- Modify: `frontend/app/lib/studio/post/settings.ts` — `DEFAULT_POST` + `postEnabled`
- Modify: `frontend/app/lib/studio/post/manifest.ts` — `POST_EFFECTS` entry + `POST_CHAIN_ORDER`
- Test: `frontend/tests/unit/studio-post-distort.unit.spec.ts`

**Interfaces:**
- Consumes: the existing `chain.ts` catalog-frag renderer (generic over any `POST_EFFECTS` entry with a `frag`).
- Produces: `PostSettings` gains `distort: boolean` + `distortAmount: number`; a `distort` catalog effect.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/studio-post-distort.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_POST, postEnabled } from '~/lib/studio/post/settings'
import { POST_EFFECTS, POST_CHAIN_ORDER } from '~/lib/studio/post/manifest'
import catalog from '../../../shader_effects/manifest.json'

describe('shared post: distortion', () => {
  it('ships off by default and is a no-op until enabled', () => {
    expect(DEFAULT_POST.distort).toBe(false)
    expect(typeof DEFAULT_POST.distortAmount).toBe('number')
    expect(postEnabled({ ...DEFAULT_POST })).toBe(false)
  })

  it('postEnabled turns on when distort is on', () => {
    expect(postEnabled({ ...DEFAULT_POST, distort: true })).toBe(true)
  })

  it('is registered in the effect manifest, chain order, and catalog', () => {
    expect(POST_EFFECTS.find(e => e.id === 'distort')?.frag).toBe('distort')
    expect(POST_CHAIN_ORDER).toContain('distort')
    expect((catalog as any).distort).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/studio-post-distort.unit.spec.ts`
Expected: FAIL — `distort` absent everywhere.

- [ ] **Step 3a: Write the catalog frag**

First read an existing simple full-frame frag for the exact I/O convention: `shader_effects/chromatic_aberration.frag` (uniform names, `u_image0`, `v_texCoord`, `fragColor0`, the `#version`/precision header). Then create `shader_effects/distort.frag` matching that header exactly, with this body:

```glsl
// (header copied verbatim from chromatic_aberration.frag: #version, precision,
//  in vec2 v_texCoord, uniform sampler2D u_image0, layout(location=0) out vec4 fragColor0)
uniform float u_amount;   // 0..1 distortion strength
uniform vec2  u_resolution;
uniform float u_seed;

float vhash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = vhash(i), b = vhash(i + vec2(1.0, 0.0)), c = vhash(i + vec2(0.0, 1.0)), d = vhash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = v_texCoord;
  if (u_amount > 0.0) {
    float n1 = vnoise(uv * 6.0 + u_seed);
    float n2 = vnoise(uv * 6.0 - u_seed + 17.3);
    vec2 px = (vec2(n1, n2) - 0.5) * (u_amount * 45.0);
    uv += px / max(u_resolution, vec2(1.0));
  }
  vec4 src = texture(u_image0, clamp(uv, 0.0, 1.0));
  fragColor0 = vec4(clamp(src.rgb, 0.0, 1.0), src.a);
}
```

Match `u_image0`/`v_texCoord`/`fragColor0`/version to the template frag's actual identifiers — if they differ (e.g. `u_texture`), use the template's names, not these.

- [ ] **Step 3b: Register in `shader_effects/manifest.json`**

Add a `distort` entry mirroring `chromatic_aberration`'s shape (name/uniforms/default). Provide `default`s for every uniform this stack won't map to a user param (`u_resolution` is host-provided; `u_seed` fixed). Example (adapt keys to the file's actual schema):

```json
"distort": {
  "name": "Distort",
  "uniforms": {
    "u_amount": { "type": "float", "default": 0.0 },
    "u_seed": { "type": "float", "default": 3.7 },
    "u_resolution": { "type": "vec2", "default": [1024, 1024] }
  }
}
```

- [ ] **Step 3c: Add the settings fields (`frontend/shared/spacetype/state.ts`)**

Grep the `PostSettings` type in that file and add two fields near the other toggle+amount pairs:

```ts
  distort: boolean
  distortAmount: number
```

- [ ] **Step 3d: Defaults + enable predicate (`settings.ts`)**

`DEFAULT_POST` — add:

```ts
  distort: false, distortAmount: 0.3,
```

`postEnabled` — add `|| p.distort` to the OR chain, and update its doc comment's count (twelve → thirteen).

- [ ] **Step 3e: Manifest entry + chain order (`manifest.ts`)**

Append to `POST_EFFECTS`:

```ts
  {
    // Two-noise-field UV warp ported from shapefx/post.ts. u_resolution is host-
    // provided (chain seeds it); u_seed sits at the catalog default. distortAmount
    // 0..1 → u_amount identity (the frag scales to a 45px budget itself).
    id: 'distort', label: 'Distort', enableKey: 'distort', frag: 'distort',
    params: [
      { kind: 'slider', uniform: 'u_amount', settingsKey: 'distortAmount', label: 'Distort amount', min: 0, max: 1, step: 0.02, hint: 'Wobbles the whole image with noise' },
    ],
  },
```

Add `'distort'` to `POST_CHAIN_ORDER` — place it early (before dot/halftone screens so those pattern on the warped image), e.g. after `'blur'`:

```ts
export const POST_CHAIN_ORDER = [
  'gtao', 'color', 'duotone', 'bloom', 'chroma', 'blur', 'distort',
  'halftone', 'dotScreen', 'glitch', 'film', 'vignette', 'grain',
]
```

If `u_resolution` isn't auto-seeded by `chain.ts` for mapped effects, confirm how `chroma`/`halftone` receive their resolution/size uniforms (chain seeds catalog `default`s, then params) — the `default` in manifest.json covers a still frame; a host that provides real resolution will override it. No extra chain code should be required.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run tests/unit/studio-post-distort.unit.spec.ts tests/unit/studio-post-settings.unit.spec.ts tests/unit/post-effects.unit.spec.ts tests/unit/studio-post-chain.unit.spec.ts`
Expected: PASS. If a manifest-coverage or settings-count test asserts an exact effect/field count, update that expected number in the same commit (it's a deliberate addition).

- [ ] **Step 5: Commit**

```bash
git add shader_effects/distort.frag shader_effects/manifest.json frontend/shared/spacetype/state.ts frontend/app/lib/studio/post/settings.ts frontend/app/lib/studio/post/manifest.ts frontend/tests/unit/studio-post-distort.unit.spec.ts
git commit -m "feat(post): screen-space distortion as a shared catalog effect"
```

---

### Task 6: Studio UI — gem params, palette controls, coloring modes

Surface everything in the 3D Studio panel: gem params render automatically from `PRIMITIVE_PARAMS`, but the palette (mode/hue/sat/light/harmony) and the two new coloring modes need UI. Distortion appears automatically in the shared post panel.

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` — the material/gradient panel: extend the `gradientShading` segmented control (`matGradientShading`, ~line 574 / template ~4127) with `scatter` + `ombre`; add a palette block (mode toggle + hue/sat/light sliders + harmony select) bound to the material fields.
- (No change needed for gem geometry params — the Geometry panel renders `PRIMITIVE_PARAMS[kind]` generically. Verify the gem shows Facets/Spread/Depth/Seed.)

**Interfaces:**
- Consumes: `SceneMaterial.paletteMode/paletteHue/paletteSat/paletteLight/paletteHarmony`, `gradientShading` (widened) from Tasks 3-4; `HARMONY_TYPES`/`HARMONY_LABELS` from `~/lib/color/harmony`.

- [ ] **Step 1: Extend the shading segmented control**

Find `matGradientShading` (~line 574) and the segmented control in the template (~4127). Add the two options so the control reads `Smooth · Faceted · Prismatic · Scatter · Ombre`, writing the same string values into `material.gradientShading`. Follow the exact existing pattern for that control (option list + click handler) — do not hand-roll a new widget.

- [ ] **Step 2: Add the palette block**

Below the ramp editor, add a palette group bound to the current material:
- A `Palette` mode toggle: `Manual · Harmony` → `material.paletteMode`.
- When `harmony`: a Hue slider (0-360 → `paletteHue`), Saturation slider (0-1 → `paletteSat`), Lightness slider (0.2-0.9 → `paletteLight`), and a Harmony `<select>` populated from `HARMONY_TYPES` with `HARMONY_LABELS` as display text → `paletteHarmony`.
- When `manual`: keep the existing ramp editor visible (unchanged).

Reuse the studio's existing slider/segmented/select components used elsewhere in this file (grep the file for how `gradientOffset`/`gradientType` are bound) so styling and change-plumbing match. Every write must go through the same material-mutation path the existing gradient controls use, so autosave + undo work.

- [ ] **Step 3: Verify in the browser (render-proof)**

Start the dev server and drive it (do NOT ask the user to check):

```bash
# preview via the Browser pane tools, not a raw shell dev server
```

1. `preview_start` the frontend dev server (use `127.0.0.1`, per the repo's localhost-426 note).
2. Open a canvas, add a **Gem** primitive, open 3D Studio on it.
3. Confirm the Geometry panel shows Facets/Spread/Depth/Seed and the gem re-rolls when Seed changes.
4. Set material type to Gradient, set shading to **Prismatic** → confirm the cut-gem shimmer.
5. Switch **Palette → Harmony**, drag Hue → confirm the stone's colors shift harmoniously.
6. Switch shading to **Scatter** (confetti facets), then **Ombre** (stippled) → confirm each looks distinct.
7. In the Post panel, enable **Distort**, raise the amount → confirm the frame warps.
8. `read_console_messages` — confirm no errors.
9. `computer{action:"screenshot"}` for the record.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): gem palette + scatter/ombre + distortion UI"
```

---

### Task 7: Render-proof harness test (variance, not just "it rendered")

A headless-ish assertion that the coloring modes actually differ and the gem is solid — guarding against the repo's "flat wash passes the parity test" failure mode.

**Files:**
- Modify or create: a dev harness page under `frontend/app/pages/dev/` (mirror `dev/shape-harness.vue`) exposing a forced-sync render that returns pixel stats, OR add a Vitest test using a `gl` headless context if the existing `scene3d-*` tests already do (grep `tests/unit/scene3d-engine.unit.spec.ts` for a WebGL/render harness).
- Test: extend `frontend/tests/unit/scene3d-facet-coloring.unit.spec.ts` if a headless GL harness exists; otherwise a `dev/gem-harness.vue` probed via the Browser pane.

**Interfaces:**
- Consumes: everything from Tasks 1-6.

- [ ] **Step 1: Determine the render-proof mechanism**

Grep the existing engine test for a render path:

```bash
cd frontend && grep -nE "WebGL|gl\b|render|createCanvas|headless|readPixels" tests/unit/scene3d-engine.unit.spec.ts | head
```

If a headless render harness exists, write a Vitest test that renders a gem twice — once `scatter`, once `smooth` — and asserts the rendered pixel buffers differ (facet-to-facet variance), and that a `scatter` render has more distinct color buckets than a `smooth` one. If NO headless GL harness exists in unit tests, skip the Vitest form and do the proof through the Browser pane in a `dev/gem-harness.vue` page:

- [ ] **Step 2 (browser path): build the harness page + probe**

Create `frontend/app/pages/dev/gem-harness.vue` mirroring `dev/shape-harness.vue`: mount a `Scene3D` engine, add a gem, expose `window.__gemProbe(mode)` returning `{ vertexCount, distinctColorBuckets }` computed from a forced synchronous `readback` of one rendered frame (per the "hidden pane = rAF paused" note, force a sync render — do not rely on rAF). Then via the Browser pane:

1. `preview_start` + navigate to `/dev/gem-harness`.
2. `javascript_tool`: `await window.__gemProbe('smooth')` and `await window.__gemProbe('scatter')`.
3. Assert `vertexCount >= 12` and `scatter.distinctColorBuckets > smooth.distinctColorBuckets`.
4. Screenshot for the record.

- [ ] **Step 3: Run / record**

Run the Vitest form (`npx vitest run tests/unit/scene3d-facet-coloring.unit.spec.ts`) or capture the browser probe output + screenshot.
Expected: gem is solid; scatter shows more color variance than smooth.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/unit/scene3d-facet-coloring.unit.spec.ts frontend/app/pages/dev/gem-harness.vue
git commit -m "test(scene3d): render-proof for gem solidity + coloring variance"
```

---

## Self-Review

**Spec coverage:**
- Gem primitive → Tasks 1-2. ✓
- Harmony palette → Task 3. ✓
- scatter + ombre → Task 4. ✓
- screen-space distortion (shared post) → Task 5. ✓
- Config round-trip for every new field → parse guards in Tasks 3 (palette), 4 (shading), 5 (post settings). ✓
- UI surfacing → Task 6. ✓
- Render-proof (not synthetic) → Task 7 + Task 6 step 3. ✓
- Out-of-scope (randomize/locks, Shape Studio changes) → not touched. ✓

**Placeholder scan:** No TBD/TODO. Two deliberate "confirm the real identifier" notes (buildGeometry signature in Task 4; catalog frag I/O names in Task 5) are verification instructions against real files, not placeholders — each names the exact file to read and what to match.

**Type consistency:** `rampStopsOf` (Task 3) is the name used by materials.ts edits in Task 3 and referenced nowhere conflicting. `gradientShading` union widened once (Task 4) and its parse guard updated in the same task. `paletteMode`/`paletteHue`/`paletteSat`/`paletteLight`/`paletteHarmony` named identically across config field, defaults, parse, and UI (Task 6). `facetUMode` helper defined and used in both build (749) and update (1013). `distort`/`distortAmount` named identically across state type, DEFAULT_POST, postEnabled, POST_EFFECTS `enableKey`/`settingsKey`. ✓

**Scope:** One coherent subsystem (the gem look in 3D Studio). Appropriately single-plan.
