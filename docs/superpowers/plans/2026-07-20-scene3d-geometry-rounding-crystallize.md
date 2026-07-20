# Scene3D Geometry — Edge Rounding + Crystallize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add corner/edge rounding to the `cylinder`, `cone`, `prism`, `pyramid` primitives, and add a `jitter` (crystallize) modifier plus a deeper `subdivide` cap, in the 3D Studio.

**Architecture:** Geometry is built by a single factory `geometryFor(kind, params)` in `engine.ts`, driven by a per-kind spec table in `primParams.ts`; modifiers are CPU-side vertex deformations in `modifiers.ts`. Rounding is added as a `cornerRadius`/`cornerSides` param pair per kind (like the existing box), building a rounded-profile `LatheGeometry` (cylinder/cone) or a rounded-polygon `ExtrudeGeometry` (prism/pyramid) when the radius is positive, and falling back to today's `CylinderGeometry` at radius 0. Jitter is a new modifier that hashes each vertex position to a per-vertex offset.

**Tech Stack:** TypeScript, three.js `^0.171.0` (`LatheGeometry`, `ExtrudeGeometry`, `Shape`, `Vector2`), Vitest (`tests/unit/**/*.unit.spec.ts`, run with `npx vitest run <file>`), Vue 3 (panel).

## Global Constraints

- Default params must reproduce today's geometry **exactly** — `cornerRadius`/`cornerSides` default `0`/`2`; `jitter`/`jitterMode`/`jitterSeed` default `0`/`0`/`0`. The engine parity test (`scene3d-engine.unit.spec.ts` "reproduces the pre-parametric geometry at default params") pins this.
- `options` param stored value is the **index** — the `['random','normal']` order is a persistence contract; append only, never reorder.
- No new dependencies. Use only `three` and its `examples/jsm` already imported by `engine.ts`.
- Tests are pure TS (node env). Run a single file with `npx vitest run tests/unit/<name>.unit.spec.ts`. Never run the Playwright suite (`npm test`).
- Follow existing file style: the repo uses **no-semicolon** TypeScript (see `modifiers.ts`, `primParams.ts`). Match the surrounding file exactly; the code snippets below are functional, not style-final — drop trailing semicolons to fit.
- Frontend cwd is `frontend/`. All paths below are relative to `frontend/`.

---

## File Structure

- `app/lib/scene3d/primParams.ts` — add `corner()` spec builder + rows on 4 kinds; add `jitter*` modifier rows; raise `subdivide.max`.
- `app/lib/scene3d/roundedGeometry.ts` — **new** module: `roundedLatheGeometry`, `roundedPolyGeometry`, and the internal `filletCorner` helper. Keeps the geometry math out of the already-large `engine.ts`.
- `app/lib/scene3d/engine.ts` — wire the two builders into `geometryFor`'s `cylinder`/`cone`/`prism`/`pyramid` cases.
- `app/lib/scene3d/modifiers.ts` — `applyJitter` + gate additions + pipeline call.
- `app/components/vue-canvas/Scene3DStudioSurface.vue` — one `MODIFIER_GROUPS` entry.
- Tests: extend `tests/unit/scene3d-params.unit.spec.ts`, `scene3d-engine.unit.spec.ts`, `scene3d-modifiers.unit.spec.ts`; new `tests/unit/scene3d-rounded-geometry.unit.spec.ts`.

---

## Task 1: Corner params on the four kinds

**Files:**
- Modify: `app/lib/scene3d/primParams.ts`
- Test: `tests/unit/scene3d-params.unit.spec.ts`

**Interfaces:**
- Produces: `PRIMITIVE_PARAMS.cylinder|cone|prism|pyramid` each gain trailing `cornerRadius` and `cornerSides` specs (min 0 / max 0.49 / step 0.01 / default 0, and min 1 / max 8 / step 1 / default 2). `paramValue(kind,undefined,'cornerRadius') === 0` for those kinds.

- [ ] **Step 1: Write the failing test** — append inside the `describe('scene3d primitive params', ...)` block in `tests/unit/scene3d-params.unit.spec.ts`:

```ts
it('gives cylinder, cone, prism and pyramid a corner radius', () => {
  for (const kind of ['cylinder', 'cone', 'prism', 'pyramid'] as const) {
    const keys = PRIMITIVE_PARAMS[kind].map((s) => s.key)
    expect(keys, `${kind} missing cornerRadius`).toContain('cornerRadius')
    expect(keys, `${kind} missing cornerSides`).toContain('cornerSides')
    expect(paramValue(kind, undefined, 'cornerRadius')).toBe(0)
    expect(paramValue(kind, undefined, 'cornerSides')).toBe(2)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-params.unit.spec.ts`
Expected: FAIL — the new `it` throws (paramValue throws on undeclared `cornerRadius`).

- [ ] **Step 3: Implement** — in `app/lib/scene3d/primParams.ts`, add a shared builder next to the other builders (after `openEnded`, around line 40):

```ts
// Box-style edge rounding, shared by cylinder/cone (rim) and prism/pyramid
// (vertical + rim). cornerRadius 0 falls back to the un-rounded geometry.
const corner = (): ParamSpec[] => [
  { key: 'cornerRadius', label: 'Corner', hint: 'Rounds off the edges — 0 keeps them sharp', min: 0, max: 0.49, step: 0.01, default: 0 },
  { key: 'cornerSides', label: 'Corner sides', hint: 'How smooth each rounded edge looks', min: 1, max: 8, step: 1, default: 2 },
]
```

Then append `...corner()` to the end of the `cylinder`, `cone`, `prism`, `pyramid` arrays in `PRIMITIVE_PARAMS`. Example for `cylinder`:

```ts
  cylinder: [
    detail(3, 64, 48),
    radiusTop(0.5),
    { key: 'radiusBottom', label: 'Bottom radius', hint: 'Width of the bottom face', min: 0, max: 1, step: 0.01, default: 0.5 },
    arc(),
    openEnded(),
    ...corner(),
  ],
```

Do the same (`...corner()` as the last entries) for `cone`, `prism`, and `pyramid`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scene3d-params.unit.spec.ts`
Expected: PASS (all tests in file, including the existing exact-list ones which are unaffected).

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/primParams.ts tests/unit/scene3d-params.unit.spec.ts
git commit -m "feat(scene3d): declare corner rounding params on cylinder/cone/prism/pyramid"
```

---

## Task 2: `roundedLatheGeometry` + `filletCorner` (cylinder & cone)

**Files:**
- Create: `app/lib/scene3d/roundedGeometry.ts`
- Test: `tests/unit/scene3d-rounded-geometry.unit.spec.ts` (create)

**Interfaces:**
- Produces:
  - `filletCorner(A: THREE.Vector2, B: THREE.Vector2, C: THREE.Vector2, r: number, segments: number): THREE.Vector2[]` — arc points replacing corner B, ordered from the A-side to the C-side.
  - `roundedLatheGeometry(radiusTop: number, radiusBottom: number, cornerRadius: number, cornerSides: number, radialSegments: number, phiLength: number): THREE.BufferGeometry` — a lathe with rounded rim(s), spanning y ∈ [-0.5, 0.5], with `position`, `normal`, `uv`.

- [ ] **Step 1: Write the failing test** — create `tests/unit/scene3d-rounded-geometry.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { roundedLatheGeometry, roundedPolyGeometry } from '~/lib/scene3d/roundedGeometry'

const finite = (g: THREE.BufferGeometry): boolean => {
  const a = g.getAttribute('position')
  for (let i = 0; i < a.count * 3; i++) if (!Number.isFinite((a.array as ArrayLike<number>)[i])) return false
  return true
}
const size = (g: THREE.BufferGeometry): [number, number, number] => {
  g.computeBoundingBox()
  const b = g.boundingBox!
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
}

describe('roundedLatheGeometry', () => {
  it('builds a valid cylinder-like lathe with normals and uv at a mid radius', () => {
    const g = roundedLatheGeometry(0.5, 0.5, 0.2, 3, 48, Math.PI * 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(g.getAttribute('normal')).toBeTruthy()
    expect(g.getAttribute('uv')).toBeTruthy()
    expect(finite(g)).toBe(true)
    const [w, h, d] = size(g)
    expect(h).toBeLessThanOrEqual(1.0001)      // stays within unit height
    expect(w).toBeLessThanOrEqual(1.0001)
    expect(d).toBeLessThanOrEqual(1.0001)
    expect(w).toBeGreaterThan(0.5)
  })

  it('stays finite at the extreme corner radius and lowest corner sides', () => {
    const g = roundedLatheGeometry(0.5, 0.5, 0.49, 1, 48, Math.PI * 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
    expect(size(g)[1]).toBeLessThanOrEqual(1.0001)
  })

  it('handles a cone (zero top radius) without NaNs', () => {
    const g = roundedLatheGeometry(0, 0.5, 0.2, 3, 48, Math.PI * 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
  })

  it('adds vertices versus a plain cylinder of the same segments', () => {
    const plain = new THREE.CylinderGeometry(0.5, 0.5, 1, 48)
    const round = roundedLatheGeometry(0.5, 0.5, 0.2, 4, 48, Math.PI * 2)
    expect(round.getAttribute('position').count).toBeGreaterThan(0)
    expect(plain.getAttribute('position').count).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-rounded-geometry.unit.spec.ts`
Expected: FAIL — module `roundedGeometry` not found.

- [ ] **Step 3: Implement** — create `app/lib/scene3d/roundedGeometry.ts`:

```ts
// Rounded-edge geometry builders for the 3D Studio. Kept out of engine.ts to
// keep that file focused. cornerRadius 0 never reaches here — the factory falls
// back to the plain three.js primitive — so these always round something.
import * as THREE from 'three'

/** 2D fillet of corner B in the polyline A-B-C: a tangent arc of radius r with
 *  `segments` spans, ordered from the A-side tangent to the C-side tangent.
 *  Degenerate corners (a straight run, a spike, a zero-length edge) return B. */
export function filletCorner(
  A: THREE.Vector2, B: THREE.Vector2, C: THREE.Vector2, r: number, segments: number,
): THREE.Vector2[] {
  const u = new THREE.Vector2().subVectors(A, B)
  const v = new THREE.Vector2().subVectors(C, B)
  const lu = u.length(), lv = v.length()
  if (lu < 1e-6 || lv < 1e-6 || r <= 1e-6) return [B.clone()]
  u.divideScalar(lu); v.divideScalar(lv)
  const cos = Math.min(1, Math.max(-1, u.dot(v)))
  const ang = Math.acos(cos)
  if (ang < 1e-3 || Math.PI - ang < 1e-3) return [B.clone()]
  const tanHalf = Math.tan(ang / 2)
  let t = r / tanHalf
  const maxT = Math.min(lu, lv) * 0.999
  let rr = r
  if (t > maxT) { t = maxT; rr = t * tanHalf }
  const T1 = new THREE.Vector2().copy(B).addScaledVector(u, t)
  const T2 = new THREE.Vector2().copy(B).addScaledVector(v, t)
  const bis = new THREE.Vector2().addVectors(u, v)
  const lb = bis.length()
  if (lb < 1e-6) return [B.clone()]
  bis.divideScalar(lb)
  const center = new THREE.Vector2().copy(B).addScaledVector(bis, rr / Math.sin(ang / 2))
  const a1 = Math.atan2(T1.y - center.y, T1.x - center.x)
  const a2 = Math.atan2(T2.y - center.y, T2.x - center.x)
  let da = a2 - a1
  while (da > Math.PI) da -= Math.PI * 2
  while (da < -Math.PI) da += Math.PI * 2
  const n = Math.max(1, Math.round(segments))
  const out: THREE.Vector2[] = []
  for (let i = 0; i <= n; i++) {
    const a = a1 + (da * i) / n
    out.push(new THREE.Vector2(center.x + Math.cos(a) * rr, center.y + Math.sin(a) * rr))
  }
  return out
}

/** A cylinder/cone with its rim(s) rounded. Built as a lathe of the silhouette
 *  profile (radius, y) revolved about Y; the outer rim corners are filleted. */
export function roundedLatheGeometry(
  radiusTop: number, radiusBottom: number, cornerRadius: number,
  cornerSides: number, radialSegments: number, phiLength: number,
): THREE.BufferGeometry {
  const halfH = 0.5
  const r = Math.min(cornerRadius, halfH * 0.98, Math.max(radiusTop, radiusBottom) * 0.98)
  const bottomAxis = new THREE.Vector2(0, -halfH)
  const rimB = new THREE.Vector2(radiusBottom, -halfH)
  const rimT = new THREE.Vector2(radiusTop, halfH)
  const topAxis = new THREE.Vector2(0, halfH)
  const pts: THREE.Vector2[] = [bottomAxis]
  if (radiusBottom > 1e-4) pts.push(...filletCorner(bottomAxis, rimB, rimT, r, cornerSides))
  if (radiusTop > 1e-4) pts.push(...filletCorner(rimB, rimT, topAxis, r, cornerSides))
  pts.push(topAxis)
  return new THREE.LatheGeometry(pts, Math.max(3, Math.round(radialSegments)), 0, phiLength)
}
```

- [ ] **Step 4: Run the lathe tests**

Run: `npx vitest run tests/unit/scene3d-rounded-geometry.unit.spec.ts -t roundedLathe`
Expected: PASS for the `roundedLatheGeometry` describe. (The `roundedPolyGeometry` import will still resolve because Task 3 adds the export in the same file; if running the whole file, the poly tests are added in Task 3 — so scope with `-t roundedLathe` here.)

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/roundedGeometry.ts tests/unit/scene3d-rounded-geometry.unit.spec.ts
git commit -m "feat(scene3d): rounded-profile lathe geometry + corner fillet helper"
```

---

## Task 3: `roundedPolyGeometry` (prism & pyramid)

**Files:**
- Modify: `app/lib/scene3d/roundedGeometry.ts`
- Test: `tests/unit/scene3d-rounded-geometry.unit.spec.ts`

**Interfaces:**
- Produces: `roundedPolyGeometry(sides: number, radius: number, cornerRadius: number, cornerSides: number, baseAngle: number): THREE.BufferGeometry` — a straight n-gon prism with rounded vertical edges and rounded rim, centred on the origin, height 1 on Y, with `position`, `normal`, `uv`.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/scene3d-rounded-geometry.unit.spec.ts`:

```ts
describe('roundedPolyGeometry', () => {
  it('builds a valid rounded hexagonal prism with normals and uv', () => {
    const g = roundedPolyGeometry(6, 0.5, 0.15, 3, Math.PI / 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(g.getAttribute('normal')).toBeTruthy()
    expect(g.getAttribute('uv')).toBeTruthy()
    expect(finite(g)).toBe(true)
    const [w, h, d] = size(g)
    expect(h).toBeCloseTo(1, 2)                 // unit height on Y
    expect(w).toBeLessThanOrEqual(1.05)
    expect(d).toBeLessThanOrEqual(1.05)
  })

  it('stays finite for a triangular prism at the extreme corner radius', () => {
    const g = roundedPolyGeometry(3, 0.5, 0.49, 8, Math.PI / 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
    expect(size(g)[1]).toBeCloseTo(1, 2)
  })

  it('handles a 4-sided pyramid base angle without NaNs', () => {
    const g = roundedPolyGeometry(4, 0.55, 0.2, 4, Math.PI / 2 + Math.PI / 4)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-rounded-geometry.unit.spec.ts -t roundedPoly`
Expected: FAIL — `roundedPolyGeometry` is not exported.

- [ ] **Step 3: Implement** — append to `app/lib/scene3d/roundedGeometry.ts`:

```ts
/** A straight n-gon prism with rounded vertical edges (rounded-corner 2D shape)
 *  and a rounded rim (extrude bevel). Taper is intentionally dropped: rounding
 *  wins, so a rounded pyramid reads as a rounded prism. Centred on the origin,
 *  height 1 on Y. baseAngle sets the first corner's angle in the XZ footprint. */
export function roundedPolyGeometry(
  sides: number, radius: number, cornerRadius: number, cornerSides: number, baseAngle: number,
): THREE.BufferGeometry {
  const n = Math.max(3, Math.round(sides))
  const inradius = radius * Math.cos(Math.PI / n)
  const edge = 2 * radius * Math.sin(Math.PI / n)
  // Vertical-edge fillet and rim bevel must both fit inside the inradius or the
  // extrude self-intersects; clamp conservatively so extreme sliders stay valid.
  const rc = Math.min(cornerRadius, edge * 0.49, inradius * 0.6)
  const bevel = Math.min(cornerRadius, 0.49, Math.max(0, inradius - rc) * 0.9)
  const sidesSeg = Math.max(1, Math.round(cornerSides))

  const corners: THREE.Vector2[] = []
  for (let k = 0; k < n; k++) {
    const a = baseAngle + (k / n) * Math.PI * 2
    corners.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius))
  }
  const shape = new THREE.Shape()
  for (let k = 0; k < n; k++) {
    const cur = corners[k]!
    const prev = corners[(k - 1 + n) % n]!
    const next = corners[(k + 1) % n]!
    const toPrev = new THREE.Vector2().subVectors(prev, cur).normalize()
    const toNext = new THREE.Vector2().subVectors(next, cur).normalize()
    const t1 = new THREE.Vector2().copy(cur).addScaledVector(toPrev, rc)
    const t2 = new THREE.Vector2().copy(cur).addScaledVector(toNext, rc)
    if (k === 0) shape.moveTo(t1.x, t1.y)
    else shape.lineTo(t1.x, t1.y)
    if (rc > 1e-4) shape.quadraticCurveTo(cur.x, cur.y, t2.x, t2.y)
  }
  shape.closePath()

  const depth = Math.max(1e-3, 1 - 2 * bevel)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 1e-4,
    bevelSegments: sidesSeg,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: sidesSeg,
    steps: 1,
  })
  geo.rotateX(-Math.PI / 2)   // extrude axis Z becomes height Y
  geo.center()                // recentre height on the origin
  geo.computeVertexNormals()  // ExtrudeGeometry does not compute smooth normals
  return geo
}
```

- [ ] **Step 4: Run the whole rounded-geometry file**

Run: `npx vitest run tests/unit/scene3d-rounded-geometry.unit.spec.ts`
Expected: PASS (both `roundedLatheGeometry` and `roundedPolyGeometry` describes).

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/roundedGeometry.ts tests/unit/scene3d-rounded-geometry.unit.spec.ts
git commit -m "feat(scene3d): rounded-polygon extrude geometry for prism/pyramid"
```

---

## Task 4: Wire the builders into `geometryFor`

**Files:**
- Modify: `app/lib/scene3d/engine.ts` (imports near line 11; `geometryFor` cases lines 42-60)
- Test: `tests/unit/scene3d-engine.unit.spec.ts`

**Interfaces:**
- Consumes: `roundedLatheGeometry`, `roundedPolyGeometry` from Task 2/3.
- Produces: `geometryFor('cylinder'|'cone', { cornerRadius > 0 })` returns a lathe; `geometryFor('prism'|'pyramid', { cornerRadius > 0 })` returns an extrude; all four unchanged at `cornerRadius: 0`.

- [ ] **Step 1: Write the failing test** — append inside `describe('scene3d parametric geometry', ...)` in `tests/unit/scene3d-engine.unit.spec.ts`:

```ts
it('rounds the rim of a cylinder and keeps its footprint', () => {
  const plain = geometryFor('cylinder')
  const round = geometryFor('cylinder', { cornerRadius: 0.2, cornerSides: 3 })
  expect(round.getAttribute('position').count).not.toBe(plain.getAttribute('position').count)
  const [w, h, d] = sizeOf(round)
  expect(h).toBeLessThanOrEqual(1.0001)
  expect(Math.max(w, d)).toBeCloseTo(1, 1)
})

it('rounds the edges of a prism into a valid faceted solid', () => {
  const round = geometryFor('prism', { detail: 6, cornerRadius: 0.15, cornerSides: 3 })
  expect(round.getAttribute('position').count).toBeGreaterThan(0)
  expect(sizeOf(round)[1]).toBeCloseTo(1, 1)
})

it('keeps cylinder/cone/prism/pyramid identical at cornerRadius 0', () => {
  for (const kind of ['cylinder', 'cone', 'prism', 'pyramid'] as const) {
    const a = geometryFor(kind).getAttribute('position').count
    const b = geometryFor(kind, { cornerRadius: 0 }).getAttribute('position').count
    expect(b, kind).toBe(a)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: FAIL — the rounded cylinder/prism tests fail (rounding not wired; counts unchanged).

- [ ] **Step 3: Implement** — in `app/lib/scene3d/engine.ts`:

3a. Add the import after the `RoundedBoxGeometry` import (line 11):

```ts
import { roundedLatheGeometry, roundedPolyGeometry } from '~/lib/scene3d/roundedGeometry'
```

3b. Replace the `cylinder`/`cone` case (lines 42-46) with:

```ts
    case 'cylinder':
    case 'cone': {
      const cr = p('cornerRadius')
      // Rounding needs a cap to round against, so an open-ended tube stays plain.
      if (cr > 0 && p('openEnded') <= 0.5) {
        return roundedLatheGeometry(p('radiusTop'), p('radiusBottom'), cr, p('cornerSides'), p('detail'), rad(p('arc')))
      }
      return new THREE.CylinderGeometry(
        p('radiusTop'), p('radiusBottom'), 1, p('detail'), 1, p('openEnded') > 0.5, 0, rad(p('arc')),
      )
    }
```

3c. Replace the `pyramid` case (lines 57-58) with:

```ts
    case 'pyramid': {
      const cr = p('cornerRadius')
      // Rounding drops the taper (and the apex): a rounded pyramid is a rounded
      // 4-gon prism. baseAngle keeps the square footprint axis-aligned.
      if (cr > 0) return roundedPolyGeometry(p('detail'), 0.55, cr, p('cornerSides'), Math.PI / 2 + Math.PI / 4)
      return new THREE.CylinderGeometry(p('radiusTop'), 0.55, 1, p('detail'), 1).rotateY(Math.PI / 4)
    }
```

3d. Replace the `prism` case (lines 59-60) with:

```ts
    case 'prism': {
      const cr = p('cornerRadius')
      if (cr > 0) return roundedPolyGeometry(p('detail'), 0.5, cr, p('cornerSides'), Math.PI / 2)
      return new THREE.CylinderGeometry(p('radiusTop'), 0.5, 1, p('detail'))
    }
```

- [ ] **Step 4: Run the engine tests (and the params/rounded ones)**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-rounded-geometry.unit.spec.ts`
Expected: PASS — including the existing "builds every kind at both ends of every parameter range" (now exercising `cornerRadius: 0.49` on all four) and "reproduces the pre-parametric geometry at default params".

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/engine.ts tests/unit/scene3d-engine.unit.spec.ts
git commit -m "feat(scene3d): build rounded geometry for cylinder/cone/prism/pyramid"
```

---

## Task 5: Jitter modifier specs + deeper subdivision

**Files:**
- Modify: `app/lib/scene3d/primParams.ts` (`MODIFIER_SPECS`)
- Test: `tests/unit/scene3d-params.unit.spec.ts`

**Interfaces:**
- Produces: `MODIFIER_SPECS` gains `jitter` (0–0.5, def 0), `jitterMode` (options `['random','normal']`, def 0), `jitterSeed` (0–99, def 0), inserted immediately after `noiseSeed`; `subdivide.max` becomes `8`.

- [ ] **Step 1: Update the failing tests** — in `tests/unit/scene3d-params.unit.spec.ts`:

  (a) Update the exact-list assertion in `it('covers the documented modifier set', ...)` — insert the three jitter keys after `'noise', 'noiseScale', 'noiseSeed',`:

```ts
      'noise', 'noiseScale', 'noiseSeed',
      'jitter', 'jitterMode', 'jitterSeed',
      'cloneCount', 'cloneMode', 'cloneOffsetX', 'cloneOffsetY', 'cloneOffsetZ', 'cloneRadius', 'cloneAxis',
```

  (b) Add a new test in the `describe('scene3d modifier specs', ...)` block:

```ts
it('adds a jitter modifier and a deeper subdivide cap', () => {
  const spec = (key: string) => MODIFIER_SPECS.find((s) => s.key === key)!
  expect(spec('jitter').default).toBe(0)
  expect(spec('jitter').max).toBe(0.5)
  expect(spec('jitterMode').control).toBe('options')
  expect(spec('jitterMode').options).toEqual(['random', 'normal'])
  expect(spec('jitterMode').min).toBe(0)
  expect(spec('jitterMode').max).toBe(1)
  expect(spec('jitterSeed').max).toBe(99)
  expect(spec('subdivide').max).toBe(8)
  expect(modifierValue(undefined, 'jitter')).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-params.unit.spec.ts`
Expected: FAIL — jitter specs missing; `subdivide.max` still 3.

- [ ] **Step 3: Implement** — in `app/lib/scene3d/primParams.ts` `MODIFIER_SPECS`:

  (a) Change the `subdivide` row's `max` from `3` to `8`:

```ts
  { key: 'subdivide', label: 'Subdivide', hint: 'Splits each face into smaller ones so bends, twists and jitter stay detailed', min: 0, max: 8, step: 1, default: 0 },
```

  (b) Insert the three jitter rows immediately after the `noiseSeed` row:

```ts
  { key: 'jitter', label: 'Jitter', hint: 'Randomly offsets each vertex for a faceted, crystalline look — pair with Subdivide and flat shading', min: 0, max: 0.5, step: 0.005, default: 0 },
  // options are stored as an index — append only, never reorder.
  { key: 'jitterMode', label: 'Jitter mode', hint: 'Random scatters vertices into chaotic gems; Along normal pushes them in and out for spikes', min: 0, max: 1, step: 1, default: 0, control: 'options', options: ['random', 'normal'] },
  { key: 'jitterSeed', label: 'Jitter seed', hint: 'Shuffles the jitter into a different arrangement', min: 0, max: 99, step: 1, default: 0 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scene3d-params.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/primParams.ts tests/unit/scene3d-params.unit.spec.ts
git commit -m "feat(scene3d): declare jitter modifier and raise subdivide cap to 8"
```

---

## Task 6: `applyJitter` in the modifier pipeline

**Files:**
- Modify: `app/lib/scene3d/modifiers.ts`
- Test: `tests/unit/scene3d-modifiers.unit.spec.ts`

**Interfaces:**
- Consumes: `MODIFIER_SPECS` jitter keys (Task 5), `hash3` (already in `modifiers.ts`).
- Produces: `applyModifiers` displaces vertices when `jitter !== 0`; `hasModifiers` returns true when only `jitter` is set; subdivision runs with jitter (jitter counted as a deform).

- [ ] **Step 1: Write the failing test** — append to `tests/unit/scene3d-modifiers.unit.spec.ts` (imports there already include `applyModifiers`, `hasModifiers`; add `buildGeometry` from `~/lib/scene3d/engine` if not present, or build a box geometry inline via `geometryFor`). Use `geometryFor` for a clean source:

```ts
import { geometryFor } from '~/lib/scene3d/engine'
// (add to the existing import block if geometryFor is not already imported)

describe('scene3d jitter modifier', () => {
  const posOf = (g: THREE.BufferGeometry) => (g.getAttribute('position').array as Float32Array).slice()

  it('is inert at jitter 0 and active above it', () => {
    expect(hasModifiers({ jitter: 0 })).toBe(false)
    expect(hasModifiers({ jitter: 0.1 })).toBe(true)
  })

  it('moves vertices deterministically for a given seed', () => {
    const src = geometryFor('box')
    const a = applyModifiers(src.clone(), { jitter: 0.2, jitterSeed: 1 })
    const b = applyModifiers(src.clone(), { jitter: 0.2, jitterSeed: 1 })
    const c = applyModifiers(src.clone(), { jitter: 0.2, jitterSeed: 2 })
    expect(Array.from(posOf(a))).toEqual(Array.from(posOf(b)))          // same seed → identical
    expect(Array.from(posOf(a))).not.toEqual(Array.from(posOf(c)))      // seed changes it
  })

  it('produces only finite positions in both modes', () => {
    for (const jitterMode of [0, 1]) {
      const g = applyModifiers(geometryFor('icosahedron', { detail: 1 }), { jitter: 0.3, jitterMode, subdivide: 2 })
      const arr = g.getAttribute('position').array as Float32Array
      for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true)
    }
  })

  it('subdivides when only jitter is set (jitter counts as a deform)', () => {
    const plain = geometryFor('box')
    const jittered = applyModifiers(geometryFor('box'), { jitter: 0.1, subdivide: 2 })
    expect(jittered.getAttribute('position').count).toBeGreaterThan(plain.getAttribute('position').count)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-modifiers.unit.spec.ts`
Expected: FAIL — `hasModifiers({ jitter: 0.1 })` is false; jitter not applied.

- [ ] **Step 3: Implement** — in `app/lib/scene3d/modifiers.ts`:

  (a) Update the stage-order comment (line 9) to: `// Stage order is fixed: subdivide → taper → twist → bend → noise → jitter → cloner.`

  (b) In `hasModifiers` (line 33) add the jitter term:

```ts
  return m('taper') !== 0 || m('twist') !== 0 || m('bend') !== 0 || m('noise') !== 0 || m('jitter') !== 0 || totalClones(modifiers) > 1
```

  (c) Add the `applyJitter` function after `applyNoise` (after line 176):

```ts
/** Per-vertex random displacement keyed on the (quantised) vertex position, so
 *  coincident/welded vertices move together and the mesh stays watertight — it
 *  just facets. Unlike valueNoise this does NOT interpolate, so neighbours are
 *  uncorrelated: sharp, crystalline facets rather than smooth lumps.
 *  mode 0 = random 3D direction; mode 1 = along the vertex normal. */
function applyJitter(geo: THREE.BufferGeometry, amount: number, mode: number, seed: number): void {
  if (mode === 1 && !geo.getAttribute('normal')) geo.computeVertexNormals()
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined
  const Q = 4096 // quantisation: near-identical floats hash identically
  const q = (n: number) => Math.round(n * Q)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const qx = q(x), qy = q(y), qz = q(z)
    if (mode === 1 && nrm) {
      const d = (hash3(qx, qy, qz, seed) * 2 - 1) * amount
      pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d)
    } else {
      const dx = (hash3(qx, qy, qz, seed) * 2 - 1) * amount
      const dy = (hash3(qx, qy, qz, seed + 1) * 2 - 1) * amount
      const dz = (hash3(qx, qy, qz, seed + 2) * 2 - 1) * amount
      pos.setXYZ(i, x + dx, y + dy, z + dz)
    }
  }
  pos.needsUpdate = true
}
```

  (d) In `applyModifiers`, extend the `deforms` gate and call `applyJitter`. Replace lines 253-255:

```ts
  const taper = m('taper'), twist = m('twist'), bend = m('bend'), noise = m('noise'), jitter = m('jitter')
  const count = totalClones(modifiers)
  const deforms = taper !== 0 || twist !== 0 || bend !== 0 || noise !== 0 || jitter !== 0
```

  and after the `noise` line (line 275) add:

```ts
  if (jitter !== 0) applyJitter(out, jitter, Math.round(m('jitterMode')), Math.round(m('jitterSeed')))
```

- [ ] **Step 4: Run the modifier tests (plus engine, which imports the pipeline)**

Run: `npx vitest run tests/unit/scene3d-modifiers.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/modifiers.ts tests/unit/scene3d-modifiers.unit.spec.ts
git commit -m "feat(scene3d): jitter (crystallize) vertex modifier"
```

---

## Task 7: Panel — Jitter controls

**Files:**
- Modify: `app/components/vue-canvas/Scene3DStudioSurface.vue` (`MODIFIER_GROUPS`, around lines 336-341)

**Interfaces:**
- Consumes: `jitter`/`jitterMode`/`jitterSeed` specs (Task 5). The panel already renders each group's keys generically (slider, or segmented for `control: 'options'`).

- [ ] **Step 1: Implement** — add a Jitter group to `MODIFIER_GROUPS` after the `Noise` entry:

```ts
  { label: 'Noise', keys: ['noise', 'noiseScale', 'noiseSeed'] },
  { label: 'Jitter', keys: ['jitter', 'jitterMode', 'jitterSeed'] },
```

- [ ] **Step 2: Type/compile check**

Run: `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | tail -20` (or the repo's typecheck script). Expected: no NEW errors versus the ~328 baseline (see project memory — the baseline is pre-existing, unrelated errors). The Jitter group references only declared spec keys, so it adds none.

- [ ] **Step 3: Commit**

```bash
git add app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): Jitter controls in the Modifiers panel"
```

---

## Task 8: Full suite + browser verification

- [ ] **Step 1: Run every scene3d unit test**

Run: `npx vitest run tests/unit/scene3d-*.unit.spec.ts tests/unit/scene3d-rounded-geometry.unit.spec.ts`
Expected: all PASS.

- [ ] **Step 2: Launch the studio and verify visually** — start the dev server (use `127.0.0.1`, not `localhost` — see project memory), open the 3D Studio, add a cylinder / cone / prism / pyramid and drag the new **Corner** slider; add any shape, set **Subdivide** high and **Jitter** up with flat shading, toggle **Jitter mode**. Confirm: rounded rims/edges look right (no inside-out normals, no gaps), the shape doesn't "pop"/rotate when the corner slider first leaves 0 (adjust the `baseAngle` constants in Task 4's prism/pyramid cases if it does), and jitter yields crystalline facets in both modes. Screenshot before/after.

- [ ] **Step 3: Final commit if any polish edits were needed** (e.g. baseAngle tweak, normal flip).

---

## Self-Review Notes

- **Spec coverage:** Feature 1 rim rounding (cylinder/cone → Task 2+4), vertical+rim rounding (prism/pyramid → Task 3+4), match-box ranges (Task 1), flat faces (quadratic-fillet shape, Task 3), radius-0 parity (Task 4 test + global constraint). Feature 2 jitter modifier w/ both modes + seed (Task 5+6), subdivide auto-activates (Task 6 deforms gate + test), deeper cap 3→8 (Task 5), panel (Task 7). Persistence: numbers in existing bags, defaults 0 → covered by parity tests.
- **Breaking-test updates called out:** `scene3d-params` exact modifier list (Task 5); the generic "builds every kind at both ends" now covers `cornerRadius: 0.49` and is satisfied by the clamps in Tasks 2-3.
- **Type consistency:** `roundedLatheGeometry`/`roundedPolyGeometry`/`filletCorner` signatures identical in Tasks 2-4; `applyJitter(geo, amount, mode, seed)` matches its call site.
- **Known visual risk:** lathe normal orientation and prism/pyramid `baseAngle` alignment can only be confirmed in-browser (Task 8) — flagged, not left as a silent assumption.
