# 3D Studio Parametric Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every 3D Studio primitive its own geometry parameters (detail, corner radius, arcs, tube, winding, radii) driven by one schema table, and show object scale as Size in scene units.

**Architecture:** A new `lib/scene3d/primParams.ts` holds a `PRIMITIVE_PARAMS` table describing each kind's parameters (label, hint, range, default). `geometryFor(kind, params)` in `engine.ts` reads it to build geometry; the Selection panel renders it as a `v-for` of sliders. Geometry changes swap `mesh.geometry` in place under a new geometry key, leaving the material instance and transform untouched.

**Tech Stack:** Vue 3 / Nuxt 4, TypeScript, three.js 0.171 (including `RoundedBoxGeometry` from `three/examples/jsm/geometries/`), vitest.

## Global Constraints

- Zero new npm dependencies. `RoundedBoxGeometry` ships with the installed three package.
- Back-compat is hard: every parameter default must reproduce today's geometry exactly; old scene JSON without `params` must render unchanged; absent stays absent through serialize→parse.
- Parameters must never force a material rebuild — the material instance and its in-place update path survive geometry swaps.
- Parsing follows the existing tolerant pattern: unknown keys dropped, non-finite dropped, in-range values clamped.
- Vue-first: no bridge/iframe changes.
- Commit hygiene (parallel sessions share this tree): stage only your own files and hunks, never `git add -A`, never `git stash`. Commit to `main`.
- Gates for every task: `cd frontend && npx vitest run tests/unit/scene3d-*.unit.spec.ts` green, and `npx vue-tsc --noEmit | grep -i scene3d` empty (a repo-wide baseline of unrelated errors is normal).

---

### Task 1: Parameter schema table and model

**Files:**
- Create: `frontend/app/lib/scene3d/primParams.ts`
- Create: `frontend/tests/unit/scene3d-params.unit.spec.ts`
- Modify: `frontend/app/lib/scene3d/config.ts` (PrimitiveObject interface ~line 60; the primitive branch of the object parser ~line 229)
- Modify: `frontend/tests/unit/scene3d-config.unit.spec.ts` (add a round-trip test)

**Interfaces:**
- Consumes: `PrimitiveKind` and `PRIMITIVE_KINDS` from `~/lib/scene3d/config`.
- Produces, relied on by Tasks 2 and 3:
  - `interface ParamSpec { key: string; label: string; hint: string; min: number; max: number; step: number; default: number; control?: 'slider' | 'toggle' }`
  - `const PRIMITIVE_PARAMS: Record<PrimitiveKind, ParamSpec[]>`
  - `function paramValue(kind: PrimitiveKind, params: Record<string, number> | undefined, key: string): number`
  - `function sanitizeParams(kind: PrimitiveKind, raw: unknown): Record<string, number> | undefined`
  - `PrimitiveObject` gains `params?: Record<string, number>`

**Import-cycle rule:** `primParams.ts` must import `PrimitiveKind` with `import type` only. `config.ts` imports `sanitizeParams` as a value. That keeps the value dependency one-directional (config → primParams).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/scene3d-params.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PRIMITIVE_PARAMS, paramValue, sanitizeParams } from '~/lib/scene3d/primParams'
import { PRIMITIVE_KINDS } from '~/lib/scene3d/config'

describe('scene3d primitive params', () => {
  it('has a spec list for every primitive kind', () => {
    expect(Object.keys(PRIMITIVE_PARAMS).sort()).toEqual([...PRIMITIVE_KINDS].sort())
  })

  it('gives every spec a default inside its own range and a unique key', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const specs = PRIMITIVE_PARAMS[kind]
      expect(specs.length, `${kind} has no params`).toBeGreaterThan(0)
      const keys = specs.map((s) => s.key)
      expect(new Set(keys).size, `${kind} has duplicate keys`).toBe(keys.length)
      for (const s of specs) {
        expect(s.default, `${kind}.${s.key} default below min`).toBeGreaterThanOrEqual(s.min)
        expect(s.default, `${kind}.${s.key} default above max`).toBeLessThanOrEqual(s.max)
        expect(s.min).toBeLessThan(s.max)
        expect(s.step).toBeGreaterThan(0)
        expect(s.hint.length, `${kind}.${s.key} needs a tooltip hint`).toBeGreaterThan(0)
      }
    }
  })

  it('resolves a stored value, falls back to the default, and clamps', () => {
    expect(paramValue('sphere', { detail: 12 }, 'detail')).toBe(12)
    expect(paramValue('sphere', undefined, 'detail')).toBe(48)
    expect(paramValue('sphere', {}, 'arc')).toBe(360)
    expect(paramValue('sphere', { detail: 9999 }, 'detail')).toBe(64)
    expect(paramValue('sphere', { detail: -5 }, 'detail')).toBe(4)
    expect(paramValue('sphere', { detail: Number.NaN }, 'detail')).toBe(48)
  })

  it('throws on a param key the kind does not have', () => {
    expect(() => paramValue('sphere', undefined, 'cornerRadius')).toThrow()
  })

  it('sanitizes: drops unknown and non-finite keys, clamps, keeps absent absent', () => {
    expect(sanitizeParams('sphere', undefined)).toBeUndefined()
    expect(sanitizeParams('sphere', {})).toBeUndefined()
    expect(sanitizeParams('sphere', { nope: 3 })).toBeUndefined()
    expect(sanitizeParams('sphere', { detail: 'big' })).toBeUndefined()
    expect(sanitizeParams('sphere', { detail: Number.POSITIVE_INFINITY })).toBeUndefined()
    expect(sanitizeParams('sphere', { detail: 16, nope: 3 })).toEqual({ detail: 16 })
    expect(sanitizeParams('sphere', { detail: 9999 })).toEqual({ detail: 64 })
  })

  it('gives the box a corner radius and the polyhedra a subdivision detail', () => {
    expect(PRIMITIVE_PARAMS.box.map((s) => s.key)).toEqual(['cornerRadius', 'cornerSides'])
    expect(paramValue('box', undefined, 'cornerRadius')).toBe(0)
    expect(paramValue('icosahedron', undefined, 'detail')).toBe(0)
    expect(paramValue('icosahedron', { detail: 2 }, 'detail')).toBe(2)
  })

  it('models the open-ended flag as a 0/1 toggle so params stay numeric', () => {
    const spec = PRIMITIVE_PARAMS.cylinder.find((s) => s.key === 'openEnded')!
    expect(spec.control).toBe('toggle')
    expect(spec.min).toBe(0)
    expect(spec.max).toBe(1)
    expect(spec.default).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-params.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/scene3d/primParams`.

- [ ] **Step 3: Create the parameter table**

Create `frontend/app/lib/scene3d/primParams.ts`:

```ts
// Per-primitive geometry parameters. One table drives both the geometry factory
// (engine.ts) and the Geometry panel (Scene3DStudioSurface.vue), so adding a
// knob is one row here rather than new code in two places.
//
// Every default reproduces the geometry the studio shipped before parameters
// existed — see the per-kind comments for the original three.js call.
import type { PrimitiveKind } from '~/lib/scene3d/config'

export interface ParamSpec {
  key: string
  label: string
  hint: string
  min: number
  max: number
  step: number
  default: number
  /** 'toggle' renders a checkbox and stores 0 | 1, keeping params a flat number map. */
  control?: 'slider' | 'toggle'
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Shared spec builders — most kinds want the same Detail/Arc knobs with
// different ranges, and repeating the copy would let it drift.
const detail = (min: number, max: number, def: number): ParamSpec =>
  ({ key: 'detail', label: 'Detail', hint: 'Segment count — low values give a faceted, low-poly look', min, max, step: 1, default: def })
const subdivision = (): ParamSpec =>
  ({ key: 'detail', label: 'Detail', hint: 'Subdivides the faces toward a geodesic sphere', min: 0, max: 3, step: 1, default: 0 })
const arc = (): ParamSpec =>
  ({ key: 'arc', label: 'Arc', hint: 'Sweeps only part of the way around, leaving a wedge', min: 30, max: 360, step: 1, default: 360 })
const radiusTop = (def: number): ParamSpec =>
  ({ key: 'radiusTop', label: 'Top radius', hint: 'Width of the top face — 0 comes to a point', min: 0, max: 1, step: 0.01, default: def })
const openEnded = (): ParamSpec =>
  ({ key: 'openEnded', label: 'Open ended', hint: 'Removes the end caps, leaving a hollow tube', min: 0, max: 1, step: 1, default: 0, control: 'toggle' })

export const PRIMITIVE_PARAMS: Record<PrimitiveKind, ParamSpec[]> = {
  // BoxGeometry(1, 1, 1) at cornerRadius 0
  box: [
    { key: 'cornerRadius', label: 'Corner', hint: 'Rounds off every edge of the box', min: 0, max: 0.49, step: 0.01, default: 0 },
    { key: 'cornerSides', label: 'Corner sides', hint: 'How smooth each rounded edge looks', min: 1, max: 8, step: 1, default: 2 },
  ],
  // SphereGeometry(0.5, 48, 32)
  sphere: [
    detail(4, 64, 48),
    arc(),
    { key: 'sweep', label: 'Sweep', hint: 'Trims the ball down from the bottom toward a dome', min: 10, max: 180, step: 1, default: 180 },
  ],
  // CylinderGeometry(0.5, 0.5, 1, 48)
  cylinder: [
    detail(3, 64, 48),
    radiusTop(0.5),
    { key: 'radiusBottom', label: 'Bottom radius', hint: 'Width of the bottom face', min: 0, max: 1, step: 0.01, default: 0.5 },
    arc(),
    openEnded(),
  ],
  // ConeGeometry(0.5, 1, 48) === CylinderGeometry(0, 0.5, 1, 48)
  cone: [
    detail(3, 64, 48),
    radiusTop(0),
    { key: 'radiusBottom', label: 'Bottom radius', hint: 'Width of the bottom face', min: 0, max: 1, step: 0.01, default: 0.5 },
    arc(),
    openEnded(),
  ],
  // TorusGeometry(0.5, 0.18, 24, 64)
  torus: [
    detail(8, 64, 64),
    { key: 'tube', label: 'Tube', hint: 'Thickness of the ring itself', min: 0.02, max: 0.45, step: 0.01, default: 0.18 },
    arc(),
  ],
  // PlaneGeometry(2, 2)
  plane: [detail(1, 32, 1)],
  // CapsuleGeometry(0.35, 0.5, 8, 24)
  capsule: [
    detail(4, 32, 24),
    { key: 'radius', label: 'Radius', hint: 'Thickness of the rounded body', min: 0.1, max: 0.5, step: 0.01, default: 0.35 },
    { key: 'length', label: 'Length', hint: 'Straight section between the two domed caps', min: 0, max: 2, step: 0.05, default: 0.5 },
  ],
  // ConeGeometry(0.55, 1, 4, 1).rotateY(PI/4)
  pyramid: [
    { key: 'detail', label: 'Detail', hint: 'Number of sides in the base — 4 is a classic pyramid', min: 3, max: 12, step: 1, default: 4 },
    radiusTop(0),
  ],
  // CylinderGeometry(0.5, 0.5, 1, 3)
  prism: [
    { key: 'detail', label: 'Detail', hint: 'Number of sides — 3 is a triangular prism, 6 a hexagonal one', min: 3, max: 24, step: 1, default: 3 },
    radiusTop(0.5),
  ],
  // IcosahedronGeometry(0.55)
  icosahedron: [subdivision()],
  // OctahedronGeometry(0.55)
  octahedron: [subdivision()],
  // DodecahedronGeometry(0.55)
  dodecahedron: [subdivision()],
  // TorusKnotGeometry(0.4, 0.12, 128, 16) — p and q default to 2 and 3
  torusKnot: [
    detail(32, 256, 128),
    { key: 'tube', label: 'Tube', hint: 'Thickness of the knotted rope', min: 0.02, max: 0.3, step: 0.01, default: 0.12 },
    { key: 'p', label: 'P winding', hint: 'How many times the rope loops around the axis', min: 1, max: 8, step: 1, default: 2 },
    { key: 'q', label: 'Q winding', hint: 'How many times it winds through the hole', min: 1, max: 8, step: 1, default: 3 },
  ],
  // RingGeometry(0.22, 0.5, 48)
  ring: [
    detail(3, 64, 48),
    { key: 'innerRadius', label: 'Inner radius', hint: 'Size of the hole in the middle', min: 0, max: 0.49, step: 0.01, default: 0.22 },
    arc(),
  ],
}

/** Resolve one parameter: a stored value clamped to its range, else the spec
 *  default. Throws on a key the kind does not declare — that is a programming
 *  error, and the drift test in scene3d-params catches it. */
export function paramValue(
  kind: PrimitiveKind,
  params: Record<string, number> | undefined,
  key: string,
): number {
  const spec = PRIMITIVE_PARAMS[kind].find((s) => s.key === key)
  if (!spec) throw new Error(`scene3d: primitive "${kind}" has no geometry param "${key}"`)
  const v = params?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default
}

/** Tolerant parse for persisted params: keep only keys this kind declares, drop
 *  non-finite values, clamp the rest. Returns undefined when nothing survives so
 *  absent stays absent and serialize→parse round-trips exactly. */
export function sanitizeParams(kind: PrimitiveKind, raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const spec of PRIMITIVE_PARAMS[kind]) {
    const v = src[spec.key]
    if (typeof v === 'number' && Number.isFinite(v)) out[spec.key] = clamp(v, spec.min, spec.max)
  }
  return Object.keys(out).length > 0 ? out : undefined
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-params.unit.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing round-trip test**

Add to `frontend/tests/unit/scene3d-config.unit.spec.ts`, immediately before the final `menu groups cover every primitive kind` test:

```ts
  it('round-trips primitive geometry params and drops junk ones', () => {
    const doc = defaultDoc()
    const sphere = createPrimitive('sphere', doc.objects)
    sphere.params = { detail: 12, arc: 180 }
    doc.objects.push(sphere)
    const box = createPrimitive('box', doc.objects)
    box.params = { cornerRadius: 0.2, cornerSides: 4 }
    doc.objects.push(box)
    const plain = createPrimitive('cone', doc.objects)
    doc.objects.push(plain)
    expect(parseDoc(serializeDoc(doc))).toEqual(doc)

    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].params = { detail: 12, bogus: 5, arc: 9999 }
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).params).toEqual({ detail: 12, arc: 360 })
    expect((back.objects[2] as any).params).toBeUndefined()
  })
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: FAIL — `params` survives serialization but the parser drops it, so the round-trip is not equal.

- [ ] **Step 7: Wire params into the model**

In `frontend/app/lib/scene3d/config.ts`, add the import beneath the existing header comment block (before the `PrimitiveKind` type is used elsewhere is fine — place it at the top of the file):

```ts
import { sanitizeParams } from '~/lib/scene3d/primParams'
```

Change the `PrimitiveObject` interface (around line 60):

```ts
export interface PrimitiveObject extends SceneObjectBase {
  kind: 'primitive'
  primitive: PrimitiveKind
  /** Geometry parameters keyed by ParamSpec.key (primParams.ts). Absent means
   *  every default, which reproduces the pre-parametric geometry. */
  params?: Record<string, number>
}
```

Change the primitive branch of the object parser (around line 229):

```ts
        if (o.kind === 'primitive' && PRIMITIVE_KINDS.includes(o.primitive)) {
          const params = sanitizeParams(o.primitive, o.params)
          return [{ ...common, kind: 'primitive', primitive: o.primitive, ...(params ? { params } : {}) }]
        }
```

- [ ] **Step 8: Run the full scene3d suite**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: PASS, all files green.

Run: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/primParams.ts frontend/app/lib/scene3d/config.ts \
        frontend/tests/unit/scene3d-params.unit.spec.ts frontend/tests/unit/scene3d-config.unit.spec.ts
git commit -m "feat(3d-studio): geometry parameter schema for every primitive"
```

---

### Task 2: Parametric geometry factory and in-place rebuilds

**Files:**
- Modify: `frontend/app/lib/scene3d/engine.ts` (`geometryFor` at lines 18-36; the mesh creation branch ~line 182; the `geoVariant` block at lines 210-229)
- Modify: `frontend/tests/unit/scene3d-engine.unit.spec.ts`

**Interfaces:**
- Consumes: `PRIMITIVE_PARAMS`, `paramValue` from `~/lib/scene3d/primParams`; `PrimitiveObject.params` from `~/lib/scene3d/config`.
- Produces, relied on by Task 3:
  - `export function geometryFor(kind: PrimitiveKind, params?: Record<string, number>): THREE.BufferGeometry` (was module-private and single-argument)
  - `export function baseSizeFor(kind: PrimitiveKind, params?: Record<string, number>): [number, number, number]` — unscaled bounding dimensions
  - `SceneEngine.baseSizeOf(id: string): [number, number, number] | null` — same for any object including GLBs

- [ ] **Step 1: Write the failing tests**

Replace the whole contents of `frontend/tests/unit/scene3d-engine.unit.spec.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { sunDirection, geometryFor, baseSizeFor } from '~/lib/scene3d/engine'
import { PRIMITIVE_KINDS, type PrimitiveKind } from '~/lib/scene3d/config'

describe('scene3d sun direction', () => {
  it('points straight up at 90° elevation', () => {
    const [x, y, z] = sunDirection(0, 90)
    expect(y).toBeCloseTo(1)
    expect(Math.hypot(x, z)).toBeCloseTo(0)
  })
  it('is a unit vector at arbitrary angles', () => {
    const [x, y, z] = sunDirection(123, 34)
    expect(Math.hypot(x, y, z)).toBeCloseTo(1)
    expect(y).toBeCloseTo(Math.sin((34 * Math.PI) / 180))
  })
})

const sizeOf = (g: THREE.BufferGeometry): [number, number, number] => {
  g.computeBoundingBox()
  const b = g.boundingBox!
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
}

describe('scene3d parametric geometry', () => {
  // The pre-parametric calls are the oracle: at default params the factory must
  // still produce exactly these meshes, so old scenes render unchanged.
  const ORIGINALS: Record<PrimitiveKind, () => THREE.BufferGeometry> = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    sphere: () => new THREE.SphereGeometry(0.5, 48, 32),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 48),
    cone: () => new THREE.ConeGeometry(0.5, 1, 48),
    torus: () => new THREE.TorusGeometry(0.5, 0.18, 24, 64),
    plane: () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    capsule: () => new THREE.CapsuleGeometry(0.35, 0.5, 8, 24),
    pyramid: () => new THREE.ConeGeometry(0.55, 1, 4, 1).rotateY(Math.PI / 4),
    prism: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 3),
    icosahedron: () => new THREE.IcosahedronGeometry(0.55),
    octahedron: () => new THREE.OctahedronGeometry(0.55),
    dodecahedron: () => new THREE.DodecahedronGeometry(0.55),
    torusKnot: () => new THREE.TorusKnotGeometry(0.4, 0.12, 128, 16),
    ring: () => new THREE.RingGeometry(0.22, 0.5, 48).rotateX(-Math.PI / 2),
  }

  it('reproduces the pre-parametric geometry at default params', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const got = geometryFor(kind)
      const want = ORIGINALS[kind]()
      expect(got.getAttribute('position').count, `${kind} vertex count`)
        .toBe(want.getAttribute('position').count)
      const [gx, gy, gz] = sizeOf(got)
      const [wx, wy, wz] = sizeOf(want)
      expect(gx, `${kind} width`).toBeCloseTo(wx, 5)
      expect(gy, `${kind} height`).toBeCloseTo(wy, 5)
      expect(gz, `${kind} depth`).toBeCloseTo(wz, 5)
    }
  })

  it('builds every kind at both ends of every parameter range', () => {
    // Guards against a param wired to a three.js argument that rejects its own
    // extreme (a 0-segment ring, a degenerate radius) — each must still build.
    for (const kind of PRIMITIVE_KINDS) {
      for (const spec of PRIMITIVE_PARAMS[kind]) {
        for (const v of [spec.min, spec.max]) {
          const g = geometryFor(kind, { [spec.key]: v })
          expect(g.getAttribute('position').count, `${kind}.${spec.key}=${v}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('drives the side count of radial shapes from detail', () => {
    const hex = geometryFor('cylinder', { detail: 6 })
    const many = geometryFor('cylinder', { detail: 48 })
    expect(hex.getAttribute('position').count).toBeLessThan(many.getAttribute('position').count)
    // A 6-sided cylinder is a hexagonal prism: its flat-to-flat width is
    // narrower than the 1.0 circumscribed diameter of the smooth one.
    expect(sizeOf(hex)[2]).toBeLessThan(sizeOf(many)[2])
  })

  it('rounds the box corners and keeps its overall size', () => {
    const plain = geometryFor('box')
    const round = geometryFor('box', { cornerRadius: 0.2, cornerSides: 4 })
    expect(round.getAttribute('position').count).toBeGreaterThan(plain.getAttribute('position').count)
    const [w, h, d] = sizeOf(round)
    expect(w).toBeCloseTo(1, 3)
    expect(h).toBeCloseTo(1, 3)
    expect(d).toBeCloseTo(1, 3)
  })

  it('cuts a partial sweep with arc', () => {
    const full = geometryFor('torus')
    const half = geometryFor('torus', { arc: 180 })
    // Half a torus keeps its full height and radius but loses half its span.
    expect(sizeOf(half)[0]).toBeLessThan(sizeOf(full)[0])
  })

  it('subdivides the polyhedra toward a sphere', () => {
    const flat = geometryFor('icosahedron')
    const smooth = geometryFor('icosahedron', { detail: 2 })
    expect(smooth.getAttribute('position').count).toBeGreaterThan(flat.getAttribute('position').count)
  })

  it('reports unscaled base dimensions', () => {
    const [w, h, d] = baseSizeFor('box')
    expect(w).toBeCloseTo(1)
    expect(h).toBeCloseTo(1)
    expect(d).toBeCloseTo(1)
    // A fatter tube makes the whole torus bigger, so Size must follow params.
    expect(baseSizeFor('torus', { tube: 0.4 })[0])
      .toBeGreaterThan(baseSizeFor('torus', { tube: 0.05 })[0])
  })
})
```

Add the missing import at the top of that test file, beside the others:

```ts
import { PRIMITIVE_PARAMS } from '~/lib/scene3d/primParams'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: FAIL — `geometryFor` and `baseSizeFor` are not exported from `engine.ts`.

- [ ] **Step 3: Rewrite the geometry factory**

In `frontend/app/lib/scene3d/engine.ts`, add these imports next to the existing ones:

```ts
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { PRIMITIVE_PARAMS, paramValue } from '~/lib/scene3d/primParams'
```

Replace `geometryFor` (currently lines 18-36) with:

```ts
/** Build a primitive's geometry from its parameters. Defaults reproduce the
 *  pre-parametric geometry exactly — the engine unit test pins that against the
 *  original three.js calls. */
export function geometryFor(kind: PrimitiveKind, params?: Record<string, number>): THREE.BufferGeometry {
  const p = (key: string): number => paramValue(kind, params, key)
  const rad = (deg: number): number => (deg * Math.PI) / 180
  switch (kind) {
    case 'box': {
      const r = p('cornerRadius')
      // RoundedBoxGeometry degenerates at radius 0, so a square box stays a BoxGeometry.
      return r <= 0 ? new THREE.BoxGeometry(1, 1, 1) : new RoundedBoxGeometry(1, 1, 1, p('cornerSides'), r)
    }
    case 'sphere': {
      const d = p('detail')
      // Height segments track width at the original 32:48 ratio.
      return new THREE.SphereGeometry(0.5, d, Math.max(2, Math.round((d * 2) / 3)), 0, rad(p('arc')), 0, rad(p('sweep')))
    }
    case 'cylinder':
    case 'cone':
      return new THREE.CylinderGeometry(
        p('radiusTop'), p('radiusBottom'), 1, p('detail'), 1, p('openEnded') > 0.5, 0, rad(p('arc')),
      )
    case 'torus':
      return new THREE.TorusGeometry(0.5, p('tube'), Math.max(3, Math.round(p('detail') * 0.375)), p('detail'), rad(p('arc')))
    case 'plane':
      return new THREE.PlaneGeometry(2, 2, p('detail'), p('detail')).rotateX(-Math.PI / 2)
    case 'capsule': {
      const d = p('detail')
      return new THREE.CapsuleGeometry(p('radius'), p('length'), Math.max(2, Math.round(d / 3)), d)
    }
    // 4-sided cone = pyramid; the quarter turn keeps the square footprint
    // axis-aligned and stays applied at every side count for continuity.
    case 'pyramid':
      return new THREE.CylinderGeometry(p('radiusTop'), 0.55, 1, p('detail'), 1).rotateY(Math.PI / 4)
    case 'prism':
      return new THREE.CylinderGeometry(p('radiusTop'), 0.5, 1, p('detail'))
    case 'icosahedron': return new THREE.IcosahedronGeometry(0.55, p('detail'))
    case 'octahedron': return new THREE.OctahedronGeometry(0.55, p('detail'))
    case 'dodecahedron': return new THREE.DodecahedronGeometry(0.55, p('detail'))
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(0.4, p('tube'), p('detail'), Math.max(3, Math.round(p('detail') / 8)), p('p'), p('q'))
    case 'ring':
      return new THREE.RingGeometry(p('innerRadius'), 0.5, p('detail'), 1, 0, rad(p('arc'))).rotateX(-Math.PI / 2)
  }
}

/** Unscaled bounding dimensions of a primitive at the given params — the Size
 *  row multiplies these by the object's scale. Pure: builds, measures, disposes. */
export function baseSizeFor(kind: PrimitiveKind, params?: Record<string, number>): [number, number, number] {
  const geo = geometryFor(kind, params)
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  const size: [number, number, number] = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
  geo.dispose()
  return size
}

/** Stable geometry signature: kind + every declared param in table order +
 *  the shading variant. Changing it swaps mesh.geometry in place. */
function geoKeyFor(obj: PrimitiveObject, variant: 'smooth' | 'facet'): string {
  const vals = PRIMITIVE_PARAMS[obj.primitive].map((s) => paramValue(obj.primitive, obj.params, s.key))
  return `${obj.primitive}|${vals.join(',')}|${variant}`
}
```

If `PrimitiveObject` is not already imported in `engine.ts`, add it to the existing `import type { ... } from '~/lib/scene3d/config'` line.

- [ ] **Step 4: Build the mesh with params and key it**

In `syncObject`'s creation branch (around line 182), replace the two lines that build geometry and stamp the variant:

```ts
        const geo = geometryFor(obj.primitive, obj.params)
        const mat = materialFor(obj.material, geo)
```

and replace `mesh.userData.geoVariant = 'smooth'` with:

```ts
        mesh.userData.geoKey = geoKeyFor(obj, 'smooth') // facet variant applied by the sync below
```

- [ ] **Step 5: Generalize the variant block into a geometry-key rebuild**

Replace the block at lines 210-229 (from `const wantFacet =` through `mesh.userData.geoVariant = variant`) with:

```ts
      const wantFacet = obj.material.type === 'gradient' &&
        (obj.material.gradientShading ?? 'smooth') !== 'smooth'
      const variant = wantFacet ? 'facet' : 'smooth'
      const geoKey = geoKeyFor(obj, variant)
      // Geometry params and the shading variant share one key: either change
      // swaps the geometry in place, leaving the material instance (and its
      // in-place update path) and the transform untouched.
      if (mesh.userData.geoKey !== geoKey) {
        mesh.geometry.dispose()
        let geo = geometryFor(obj.primitive, obj.params)
        if (wantFacet) {
          if (geo.index) geo = geo.toNonIndexed()
          geo.computeVertexNormals()
          addFaceExtentAttributes(geo)
        }
        mesh.geometry = geo
        mesh.userData.geoKey = geoKey
      }
```

- [ ] **Step 6: Add the engine's base-size lookup**

Add this public method to `SceneEngine`, next to the other object-facing methods:

```ts
  /** Unscaled bounding dimensions of any object, primitives and GLBs alike.
   *  Returns null while a GLB is still loading (its group is empty). */
  baseSizeOf(id: string): [number, number, number] | null {
    const root = this.objectRoots.get(id)
    if (!root) return null
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) return null
    const s = root.scale
    return [
      (box.max.x - box.min.x) / (s.x || 1),
      (box.max.y - box.min.y) / (s.y || 1),
      (box.max.z - box.min.z) / (s.z || 1),
    ]
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: PASS, 9 tests.

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: PASS, all files green.

Run: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/engine.ts frontend/tests/unit/scene3d-engine.unit.spec.ts
git commit -m "feat(3d-studio): parametric geometry factory with in-place rebuilds"
```

---

### Task 3: Geometry panel and Size row

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (script setup: imports, proxies; template: the Transform section's Scale row ~line 794, plus a new Geometry section between Transform and Material)

**Interfaces:**
- Consumes: `PRIMITIVE_PARAMS` and `paramValue` from `~/lib/scene3d/primParams`; `baseSizeFor` and `SceneEngine.baseSizeOf` from `~/lib/scene3d/engine`; `PrimitiveObject.params` from `~/lib/scene3d/config`.
- Produces: nothing further depends on this task.

**Existing conventions to follow in this file:** `StudioSection` wraps each panel group; `StudioSlider` takes `label`, `hint`, `:min`, `:max`, `:step` and a `v-model` (or `:model-value` + `@update:model-value`); the `matParam` helper is the model for parameter proxies; numeric transform inputs use `class="studio-num"` with `v-model.number`. This file may carry other sessions' uncommitted edits — touch only the blocks named here.

- [ ] **Step 1: Add the imports and proxies**

In the `<script setup>` block, add to the imports:

```ts
import { PRIMITIVE_PARAMS, paramValue } from '~/lib/scene3d/primParams'
import { baseSizeFor } from '~/lib/scene3d/engine'
```

Add, next to the existing `matParam` helper:

```ts
// Geometry params for the selected primitive. Reads resolve through the schema
// (stored value clamped, else the spec default); writes create the params bag
// on first touch.
function paramOf(key: string): number {
  const o = selected.value
  return o && o.kind === 'primitive' ? paramValue(o.primitive, o.params, key) : 0
}
function setParam(key: string, v: number): void {
  const o = selected.value
  if (!o || o.kind !== 'primitive') return
  if (!o.params) o.params = {}
  o.params[key] = v
}

// Size = scale expressed in scene units. Base dimensions come from the geometry
// itself, so they follow parameter changes (a fatter torus tube is a bigger
// torus). GLBs fall back to the engine's measured bounds.
const baseSize = computed<[number, number, number]>(() => {
  const o = selected.value
  if (!o) return [1, 1, 1]
  if (o.kind === 'primitive') return baseSizeFor(o.primitive, o.params)
  return engine?.baseSizeOf(o.id) ?? [1, 1, 1]
})
const sizeAxis = (i: 0 | 1 | 2, scl: { value: number }) => computed({
  get: () => Math.round(scl.value * (baseSize.value[i] || 1) * 100) / 100,
  set: (v: number) => { scl.value = (baseSize.value[i] || 1) ? v / (baseSize.value[i] || 1) : 1 },
})
const sizeX = sizeAxis(0, sclX)
const sizeY = sizeAxis(1, sclY)
const sizeZ = sizeAxis(2, sclZ)
```

If `engine` is held in a ref (e.g. `engineRef`) rather than a plain variable in this file, read it accordingly — check the surrounding code and match it.

- [ ] **Step 2: Swap the Scale row for Size**

In the template, replace the Scale block (around lines 794-799):

```vue
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Size</label>
          <div class="grid grid-cols-3 gap-1.5">
            <input v-model.number="sizeX" type="number" step="0.05" aria-label="Size X" class="studio-num" />
            <input v-model.number="sizeY" type="number" step="0.05" aria-label="Size Y" class="studio-num" />
            <input v-model.number="sizeZ" type="number" step="0.05" aria-label="Size Z" class="studio-num" />
          </div>
        </div>
```

- [ ] **Step 3: Add the Geometry section**

Insert immediately after the Transform `StudioSection` closes and before the Material one begins:

```vue
      <StudioSection v-if="selected?.kind === 'primitive'" title="Geometry">
        <div class="space-y-2.5">
          <template v-for="spec in PRIMITIVE_PARAMS[selected.primitive]" :key="spec.key">
            <label
              v-if="spec.control === 'toggle'"
              class="flex cursor-pointer items-center justify-between text-[11px] text-white/55"
              :title="spec.hint"
            >
              <span>{{ spec.label }}</span>
              <input
                type="checkbox"
                class="h-3.5 w-3.5 accent-white/70"
                :checked="paramOf(spec.key) > 0.5"
                @change="setParam(spec.key, ($event.target as HTMLInputElement).checked ? 1 : 0)"
              />
            </label>
            <StudioSlider
              v-else
              :model-value="paramOf(spec.key)"
              :label="spec.label"
              :hint="spec.hint"
              :min="spec.min"
              :max="spec.max"
              :step="spec.step"
              @update:model-value="(v: number) => setParam(spec.key, v)"
            />
          </template>
        </div>
      </StudioSection>
```

- [ ] **Step 4: Run the gates**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: PASS, all files green.

Run: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d`
Expected: no output.

- [ ] **Step 5: Verify in the browser with real interactions**

Reuse a running dev server if one exists (`ps aux | grep -i nuxt`); never kill a server you did not start. Always use `127.0.0.1:3000`, never `localhost`. Drive the page with the browser-pane tools, using real pointer interactions — dispatched synthetic events have produced false passes in this codebase because OrbitControls captures the pointer.

Create the node by dispatching `sailor:addNode` with type `Scene3DStudio`, then click Edit, add a primitive through the `+ Primitive` menu, and select it. Then confirm each of:

1. The Geometry section lists the selected shape's parameters, and switching to a different primitive kind swaps the list.
2. Dragging **Detail** on a cylinder down to 6 visibly turns it into a hexagonal prism.
3. Dragging **Corner** on a box visibly rounds its edges.
4. Dragging **Arc** on a torus opens it into an arch.
5. Dragging a gizmo scale handle updates the Size numbers, and typing a Size value resizes the object.
6. A gradient object set to `faceted` keeps its faceted shading after a parameter change (this exercises the shared geometry key).
7. Save, close, reopen: the parameters are restored.
8. `read_console_messages` shows no errors throughout.

Capture screenshots for 2, 3 and 4.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(3d-studio): geometry panel and Size in scene units"
```

If `git diff` shows unrelated hunks from a parallel session in that file, stage only your own with `git diff -- <file> > /tmp/mine.patch`, edit the patch down, and `git apply --cached`. Never `git add -A`, never `git stash`.

---

## Self-Review

**Spec coverage:** parameter schema table → Task 1; per-shape parameter table with defaults reproducing current geometry → Task 1 (table) and Task 2 (factory plus the oracle test); `geometryFor(kind, params)` and geometry-only rebuild key → Task 2; base dimensions → Task 2 (`baseSizeFor`, `baseSizeOf`); Geometry section and `paramProxy` equivalent → Task 3 (`paramOf`/`setParam`); Size row → Task 3; tolerant parsing → Task 1; all four testing bullets → Task 1 Steps 1/5, Task 2 Step 1, Task 3 Step 5.

**Naming note:** the spec sketched a `paramProxy(key)` computed; the plan implements the same contract as the `paramOf`/`setParam` pair, which suits `:model-value` + `@update:model-value` in a `v-for` better than a computed per key. The spec's `geoKey` used `JSON.stringify(sortedParams)`; the plan uses table-order values joined by commas — same stability, cheaper and order-independent by construction.

**Type consistency:** `ParamSpec`, `PRIMITIVE_PARAMS`, `paramValue`, `sanitizeParams` (Task 1) are used under those exact names in Tasks 2 and 3; `geometryFor`/`baseSizeFor` (Task 2) are used under those names in Task 3; `params?: Record<string, number>` is the same type throughout.
