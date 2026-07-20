# Scene3D Polyhedra Rounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add corner/edge rounding to the `icosahedron`, `octahedron`, `dodecahedron` primitives in the 3D Studio, via a convex-offset (Minkowski-with-sphere) construction.

**Architecture:** A new `roundedHullGeometry(base, cornerRadius, cornerSides)` builds a point cloud — each base vertex offset by `cornerRadius` along its incident face normals (flat faces), along arcs between them (rounded edges), and along the average normal (rounded corner) — then takes the convex hull via three's `ConvexGeometry`, scales it back to the base's size, and adds spherical UVs. `geometryFor` calls it when `cornerRadius > 0`, else returns the plain polyhedron.

**Tech Stack:** TypeScript, three.js `^0.171.0` (`ConvexGeometry` from `examples/jsm/geometries/ConvexGeometry.js`, `Vector3`), Vitest.

## Global Constraints

- At `cornerRadius: 0`, each polyhedron MUST be byte-identical to today's `IcosahedronGeometry(0.55, detail)` / `OctahedronGeometry(0.55, detail)` / `DodecahedronGeometry(0.55, detail)` (the engine parity test pins this). `cornerRadius`/`cornerSides` default `0`/`2`.
- three.js `^0.171.0` only; no new deps. `ConvexGeometry`/`ConvexHull` ship in `examples/jsm` (verified present).
- Repo style: **no-semicolon** TypeScript; match surrounding files (`roundedGeometry.ts`, `engine.ts`).
- Frontend cwd `frontend/`. Run a single unit file: `npx vitest run tests/unit/<name>.unit.spec.ts`.
- Commit hygiene: parallel sessions are active — `git add` ONLY the files each task names, never `-A`/`.`. Check `git status --short <file>` first; if a target file carries uncommitted parallel WIP you didn't make, stage only your own hunks or report BLOCKED.

---

## File Structure

- `app/lib/scene3d/roundedGeometry.ts` — add `roundedHullGeometry` + `addSphericalUV` (module already exists from the edge-rounding feature).
- `app/lib/scene3d/primParams.ts` — append `...corner()` (the existing shared builder) to the three polyhedra spec lists.
- `app/lib/scene3d/engine.ts` — three `geometryFor` cases.
- Tests: extend `scene3d-rounded-geometry.unit.spec.ts`, `scene3d-engine.unit.spec.ts`, `scene3d-params.unit.spec.ts`.

---

## Task 1: Corner params on the three polyhedra

**Files:**
- Modify: `app/lib/scene3d/primParams.ts`
- Test: `tests/unit/scene3d-params.unit.spec.ts`

**Interfaces:**
- Produces: `PRIMITIVE_PARAMS.icosahedron|octahedron|dodecahedron` each gain trailing `cornerRadius` + `cornerSides` specs (via the existing `corner()` builder). `paramValue(kind, undefined, 'cornerRadius') === 0`.

- [ ] **Step 1: Write the failing test** — append inside `describe('scene3d primitive params', ...)`:

```ts
it('gives the convex polyhedra a corner radius', () => {
  for (const kind of ['icosahedron', 'octahedron', 'dodecahedron'] as const) {
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
Expected: FAIL — `paramValue` throws on undeclared `cornerRadius` for these kinds.

- [ ] **Step 3: Implement** — in `PRIMITIVE_PARAMS`, change the three polyhedra rows to append `...corner()` (the `corner()` builder already exists in this file, used by cylinder/cone/prism/pyramid):

```ts
  // IcosahedronGeometry(0.55)
  icosahedron: [subdivision(), ...corner()],
  // OctahedronGeometry(0.55)
  octahedron: [subdivision(), ...corner()],
  // DodecahedronGeometry(0.55)
  dodecahedron: [subdivision(), ...corner()],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scene3d-params.unit.spec.ts`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/primParams.ts tests/unit/scene3d-params.unit.spec.ts
git commit -m "feat(scene3d): declare corner rounding params on the convex polyhedra"
```

---

## Task 2: `roundedHullGeometry` + `addSphericalUV`

**Files:**
- Modify: `app/lib/scene3d/roundedGeometry.ts`
- Test: `tests/unit/scene3d-rounded-geometry.unit.spec.ts`

**Interfaces:**
- Consumes: `ConvexGeometry` from `three/examples/jsm/geometries/ConvexGeometry.js`.
- Produces:
  - `roundedHullGeometry(base: THREE.BufferGeometry, cornerRadius: number, cornerSides: number): THREE.BufferGeometry` — a rounded convex hull of `base`, scaled to `base`'s bounding radius, with `position`, `normal`, `uv`. Does NOT dispose `base` (caller owns it).
  - `addSphericalUV(geo: THREE.BufferGeometry): void` — sets a spherical `uv` attribute.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/scene3d-rounded-geometry.unit.spec.ts` (the `finite`/`size` helpers already exist at file top; add the import):

```ts
import { roundedHullGeometry } from '~/lib/scene3d/roundedGeometry'
// (add roundedHullGeometry to the existing import from '~/lib/scene3d/roundedGeometry')

describe('roundedHullGeometry', () => {
  const bases = () => ({
    icosahedron: new THREE.IcosahedronGeometry(0.55),
    octahedron: new THREE.OctahedronGeometry(0.55),
    dodecahedron: new THREE.DodecahedronGeometry(0.55),
  })

  it('builds a valid rounded hull with normals and uv for each polyhedron', () => {
    for (const [name, base] of Object.entries(bases())) {
      const g = roundedHullGeometry(base, 0.12, 3)
      expect(g.getAttribute('position').count, name).toBeGreaterThan(0)
      expect(g.getAttribute('normal'), name).toBeTruthy()
      expect(g.getAttribute('uv'), name).toBeTruthy()
      expect(finite(g), name).toBe(true)
    }
  })

  it('preserves the base bounding size (does not balloon)', () => {
    const base = new THREE.IcosahedronGeometry(0.55)
    base.computeBoundingSphere()
    const r0 = base.boundingSphere!.radius
    const g = roundedHullGeometry(base, 0.2, 3)
    g.computeBoundingSphere()
    expect(g.boundingSphere!.radius).toBeCloseTo(r0, 2)
  })

  it('keeps some faces flat (offset-face triangles share an exact normal)', () => {
    const base = new THREE.DodecahedronGeometry(0.55)
    const g = roundedHullGeometry(base, 0.06, 2)
    const nrm = g.getAttribute('normal')
    // count triangles whose 3 vertices share an identical normal (a flat facet)
    let flatTris = 0
    for (let t = 0; t < nrm.count; t += 3) {
      const same =
        nrm.getX(t) === nrm.getX(t + 1) && nrm.getX(t + 1) === nrm.getX(t + 2) &&
        nrm.getY(t) === nrm.getY(t + 1) && nrm.getY(t + 1) === nrm.getY(t + 2) &&
        nrm.getZ(t) === nrm.getZ(t + 1) && nrm.getZ(t + 1) === nrm.getZ(t + 2)
      if (same) flatTris++
    }
    expect(flatTris).toBeGreaterThan(0)
  })

  it('stays finite at the extreme radius and lowest corner sides', () => {
    const base = new THREE.OctahedronGeometry(0.55)
    const g = roundedHullGeometry(base, 0.49, 1)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
  })

  it('adds vertices as corner sides rises (smoother arcs)', () => {
    const base = new THREE.IcosahedronGeometry(0.55)
    const coarse = roundedHullGeometry(base, 0.2, 1).getAttribute('position').count
    const smooth = roundedHullGeometry(base, 0.2, 8).getAttribute('position').count
    expect(smooth).toBeGreaterThan(coarse)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-rounded-geometry.unit.spec.ts -t roundedHull`
Expected: FAIL — `roundedHullGeometry` is not exported.

- [ ] **Step 3: Implement** — append to `app/lib/scene3d/roundedGeometry.ts`. Add the import at the top of the file (next to the existing `import * as THREE from 'three'`):

```ts
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
```

Then append:

```ts
/** Spherical UV projection — ConvexGeometry sets position+normal but no uv, and
 *  the plain polyhedra have uvs, so textured materials need this to keep working. */
export function addSphericalUV(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const uv: number[] = []
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    const u = 0.5 + Math.atan2(v.z, v.x) / (Math.PI * 2)
    const w = 0.5 - Math.asin(Math.min(1, Math.max(-1, v.y))) / Math.PI
    uv.push(u, w)
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
}

/** Spherical interpolation of two unit vectors. */
function slerpDir(u: THREE.Vector3, w: THREE.Vector3, t: number): THREE.Vector3 {
  const dot = Math.min(1, Math.max(-1, u.dot(w)))
  const om = Math.acos(dot)
  if (om < 1e-4) return u.clone()
  const s = Math.sin(om)
  return u.clone().multiplyScalar(Math.sin((1 - t) * om) / s)
    .add(w.clone().multiplyScalar(Math.sin(t * om) / s)).normalize()
}

/** Round a CONVEX polyhedron's edges/corners by a convex offset: the Minkowski sum
 *  of the solid with a sphere of radius `cornerRadius`, approximated as the convex
 *  hull of per-vertex sample clouds. Faces stay flat (offset-face points), edges and
 *  corners round (arc samples). Result is scaled back to the base's bounding size so
 *  dragging Corner doesn't balloon the shape. Does not dispose `base`. */
export function roundedHullGeometry(
  base: THREE.BufferGeometry, cornerRadius: number, cornerSides: number,
): THREE.BufferGeometry {
  const pos = base.getAttribute('position') as THREE.BufferAttribute
  const index = base.index
  const triCount = index ? index.count / 3 : pos.count / 3
  const vAt = (i: number): THREE.Vector3 =>
    new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i)

  // Unique vertices keyed on quantised position, each with its incident face normals.
  const key = (p: THREE.Vector3): string =>
    `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`
  const verts = new Map<string, { p: THREE.Vector3, normals: THREE.Vector3[] }>()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3()
  for (let t = 0; t < triCount; t++) {
    a.copy(vAt(t * 3)); b.copy(vAt(t * 3 + 1)); c.copy(vAt(t * 3 + 2))
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize()
    for (const p of [a, b, c]) {
      const k = key(p)
      let e = verts.get(k)
      if (!e) { e = { p: p.clone(), normals: [] }; verts.set(k, e) }
      // dedupe near-parallel normals so a vertex keeps one entry per distinct face plane
      if (!e.normals.some((m) => m.dot(n) > 0.9999)) e.normals.push(n.clone())
    }
  }

  const steps = Math.max(1, Math.round(cornerSides))
  const points: THREE.Vector3[] = []
  for (const { p, normals } of verts.values()) {
    const dirs: THREE.Vector3[] = normals.map((m) => m.clone()) // flat faces
    for (let i = 0; i < normals.length; i++) {
      for (let j = i + 1; j < normals.length; j++) {
        for (let s = 1; s <= steps; s++) {
          dirs.push(slerpDir(normals[i]!, normals[j]!, s / (steps + 1))) // rounded edges
        }
      }
    }
    if (normals.length > 0) {
      const avg = new THREE.Vector3()
      for (const m of normals) avg.add(m)
      if (avg.lengthSq() > 1e-8) dirs.push(avg.normalize()) // corner cap
    }
    for (const d of dirs) points.push(p.clone().addScaledVector(d, cornerRadius))
  }

  const geo = new ConvexGeometry(points)

  // Preserve the base's overall size — the offset grows it by ~cornerRadius.
  base.computeBoundingSphere()
  geo.computeBoundingSphere()
  const r0 = base.boundingSphere!.radius
  const r1 = geo.boundingSphere!.radius
  if (r1 > 1e-6) geo.scale(r0 / r1, r0 / r1, r0 / r1)

  addSphericalUV(geo)
  return geo
}
```

- [ ] **Step 4: Run the hull tests**

Run: `npx vitest run tests/unit/scene3d-rounded-geometry.unit.spec.ts`
Expected: PASS (all describes — lathe, poly, and the new hull).

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/roundedGeometry.ts tests/unit/scene3d-rounded-geometry.unit.spec.ts
git commit -m "feat(scene3d): rounded convex-hull geometry for the polyhedra"
```

---

## Task 3: Wire the polyhedra into `geometryFor`

**Files:**
- Modify: `app/lib/scene3d/engine.ts` (`geometryFor` polyhedra cases + import)
- Test: `tests/unit/scene3d-engine.unit.spec.ts`

**Interfaces:**
- Consumes: `roundedHullGeometry` (Task 2).
- Produces: `geometryFor('icosahedron'|'octahedron'|'dodecahedron', { cornerRadius > 0 })` returns a rounded hull; unchanged at `cornerRadius: 0`.

- [ ] **Step 1: Write the failing test** — append inside `describe('scene3d parametric geometry', ...)` in `tests/unit/scene3d-engine.unit.spec.ts`:

```ts
it('rounds the polyhedra edges and preserves their footprint', () => {
  for (const kind of ['icosahedron', 'octahedron', 'dodecahedron'] as const) {
    const plain = geometryFor(kind)
    const round = geometryFor(kind, { cornerRadius: 0.15, cornerSides: 3 })
    expect(round.getAttribute('position').count, kind).toBeGreaterThan(0)
    expect(round.getAttribute('uv'), `${kind} uv`).toBeTruthy()
    // size preserved within a small tolerance
    plain.computeBoundingSphere(); round.computeBoundingSphere()
    expect(round.boundingSphere!.radius, kind).toBeCloseTo(plain.boundingSphere!.radius, 1)
  }
})

it('keeps the polyhedra identical at cornerRadius 0', () => {
  for (const kind of ['icosahedron', 'octahedron', 'dodecahedron'] as const) {
    const a = geometryFor(kind).getAttribute('position').count
    const b = geometryFor(kind, { cornerRadius: 0 }).getAttribute('position').count
    expect(b, kind).toBe(a)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: FAIL — the round test fails (rounding not wired; counts unchanged / no uv difference).

- [ ] **Step 3: Implement** — in `app/lib/scene3d/engine.ts`:

3a. Add to the `roundedGeometry` import (which already imports `roundedLatheGeometry, roundedPolyGeometry`):

```ts
import { roundedLatheGeometry, roundedPolyGeometry, roundedHullGeometry } from '~/lib/scene3d/roundedGeometry'
```

3b. Replace the three polyhedra cases. Find them by content (currently one-liners: `case 'icosahedron': return new THREE.IcosahedronGeometry(0.55, p('detail'))` etc.) and replace with:

```ts
    case 'icosahedron': {
      const base = new THREE.IcosahedronGeometry(0.55, p('detail'))
      const cr = p('cornerRadius')
      if (cr <= 0) return base
      const hull = roundedHullGeometry(base, cr, p('cornerSides'))
      base.dispose()
      return hull
    }
    case 'octahedron': {
      const base = new THREE.OctahedronGeometry(0.55, p('detail'))
      const cr = p('cornerRadius')
      if (cr <= 0) return base
      const hull = roundedHullGeometry(base, cr, p('cornerSides'))
      base.dispose()
      return hull
    }
    case 'dodecahedron': {
      const base = new THREE.DodecahedronGeometry(0.55, p('detail'))
      const cr = p('cornerRadius')
      if (cr <= 0) return base
      const hull = roundedHullGeometry(base, cr, p('cornerSides'))
      base.dispose()
      return hull
    }
```

- [ ] **Step 4: Run the engine tests (and params/rounded)**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-rounded-geometry.unit.spec.ts`
Expected: PASS — including the pre-existing "reproduces the pre-parametric geometry at default params" (polyhedra parity) and "builds every kind at both ends of every parameter range" (now exercises `cornerRadius: 0.49` on the three polyhedra).

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/engine.ts tests/unit/scene3d-engine.unit.spec.ts
git commit -m "feat(scene3d): build rounded geometry for icosahedron/octahedron/dodecahedron"
```

---

## Task 4: Full suite + browser verification

- [ ] **Step 1: Run every scene3d unit test**

Run: `npx vitest run tests/unit/scene3d-*.unit.spec.ts`
Expected: all PASS.

- [ ] **Step 2: Launch/attach the studio and verify visually** — the `dev/scene3d-lab` page mounts the studio standalone. Use the existing dev server on `127.0.0.1:3000` (do NOT start a new one — parallel sessions run servers; see project memory). Because the 3D render loop makes pointer actions time out, drive it via `javascript_tool`: add a Dodecahedron (and an Icosahedron), set the **Corner** slider (find the range input labelled "Corner", set `.value` and dispatch an `input` event) to ~0.15 and ~0.4, vary **Corner sides**. Confirm: flat faces stay flat, edges/corners round smoothly (no inside-out normals, no gaps or spikes), size stays roughly constant as Corner rises, and it composes with Subdivide+Jitter. Screenshot before/after.

- [ ] **Step 3: Final polish commit** if any visual issue needs a tweak (e.g. normal winding, UV seam).

---

## Self-Review Notes

- **Coverage:** params (Task 1), hull builder incl. flat-faces + size-preserve + uv + extremes (Task 2), factory wiring + parity + both-ends (Task 3), full suite + live (Task 4).
- **Parity:** `cornerRadius: 0` short-circuits to the exact original constructor before building any base-derived hull — byte-identical.
- **Type consistency:** `roundedHullGeometry(base, cornerRadius, cornerSides)` and `addSphericalUV(geo)` signatures identical across Tasks 2–3; caller disposes the temp base.
- **Known visual risks (Task 4 verifies):** ConvexGeometry face winding/normals; spherical-UV seam; heavy detail+cornerSides point-cloud cost (deferred rebuild absorbs it).
