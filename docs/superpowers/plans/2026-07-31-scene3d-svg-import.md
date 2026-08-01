# Scene3D SVG Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop or paste an SVG into 3D Studio and get real extruded 3D geometry — one object per path, held together by a group.

**Architecture:** An imported path is a new `svgPath` **primitive kind**, so it inherits every material, modifier, motion and the Size row from the pipeline `text` already uses. The import half **reuses** the existing paper.js SVG pipeline in `useVectorSvg.ts` (its core extracted into a neutral `svgToLeafPaths`). The render half converts a stored `d` string into `THREE.Shape[]` via `SVGLoader` and hands them to the unchanged `extrudeShapes()`.

**Tech Stack:** Vue 3 + TypeScript (Nuxt 4), three.js 0.171 (`SVGLoader`, `ExtrudeGeometry`), paper.js 0.12 (headless, already a dependency), vitest (unit), Playwright (E2E).

## Global Constraints

- **`svgPath` is a `PrimitiveKind`, not a new `SceneObject` kind.** Path data lives in `PrimitiveContent`.
- **The stored `d` is in SVG convention (Y DOWN).** The Y flip happens once, at geometry build, in `pathToShapes`. Never flip at import.
- **Reuse, don't rebuild.** `svgToPathLayers` in `useVectorSvg.ts` already parses SVG with paper.js (`expandShapes: true`, `applyMatrix: true`). Extract its core; do not write a second SVG parser.
- **`SVGLoader.pointsToStroke` returns a `BufferGeometry` of triangles, not a `Shape`** — it cannot feed `ExtrudeGeometry`. Stroke outlines are built with paper.js boolean ops.
- **Stroke outlining is exact for round caps/joins** (what Lucide, Feather and Heroicons use). Miter and bevel are approximated as round. Dasharray is ignored — a dashed stroke outlines as solid.
- **Path-count threshold is `SVG_SPLIT_THRESHOLD = 40`**, one exported constant.
- **"Merged" means one `svgPath` whose `d` holds every path's subpaths concatenated** — same primitive, same extruder, holes still resolved across the set. Not a second code path.
- `hierarchy.ts` and any new pure module must not import from `./engine` and must stay WebGL-free.
- Euler order `'XYZ'` everywhere.
- **Sailor's only accent colour is action blue; purple is banned.**
- House comment style in `lib/scene3d/`: explain WHY, name the failure mode a rule prevents.
- Parallel Claude sessions share this checkout AND its git index. Commit via a private index (see any task's commit step); never `git add -A`, `git add .`, `git stash`, or `git commit -- <pathspec>`.
- Unit: `cd frontend && npx vitest run <path>`. E2E: `cd frontend && PW_BASE_URL=http://127.0.0.1:3000 npx playwright test <path>` — a dev server and backend are already running on `127.0.0.1:3000` / `:8188`; **do not run `./dev.sh`**, and never use `localhost` (IPv6 listener returns 426).

---

### Task 1: Extract `svgToLeafPaths` from the Compositor's importer

**Files:**
- Modify: `frontend/app/composables/useVectorSvg.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SvgLeafPath` interface and `svgToLeafPaths(svg, opts?)`. Tasks 4, 5 and 6 depend on both.

**Why:** `svgToPathLayers` already does the whole import — paper.js with `expandShapes: true` (rect/circle/ellipse/polygon become real paths) and `applyMatrix: true` (transforms baked), a walk to leaf `Path`/`CompoundPath` items, whole-import normalization, and per-path `d`/fill/stroke/strokeWidth/fillRule. It returns Compositor `PathLayer`s, which 3D cannot use. Extract the core; leave the Compositor's behaviour byte-identical.

- [ ] **Step 1: Add the neutral interface and function**

In `frontend/app/composables/useVectorSvg.ts`, above `svgToPathLayers`:

```ts
/** One leaf path from an imported SVG, in normalized import space (the whole
 *  import scaled so its bounds span `targetWidth`, centred on its own midpoint).
 *  Deliberately free of any consumer's layer/object type: the Compositor maps
 *  these to PathLayers, 3D Studio maps them to svgPath primitives. */
export interface SvgLeafPath {
  d: string
  /** CSS colour, or 'none'. */
  fill: string
  /** CSS colour, or 'none'. */
  stroke: string
  /** Already multiplied by the import's normalization factor. */
  strokeWidth: number
  fillRule: 'nonzero' | 'evenodd'
}

export interface SvgImportOpts {
  /** Fraction of the target space the whole import should span (default 0.6). */
  targetWidth?: number
}

/** Normalized bounds of the whole import, in the same space as each `d`. */
export interface SvgLeafResult {
  paths: SvgLeafPath[]
  bbox: { w: number; h: number }
}
```

- [ ] **Step 2: Move the body**

Move the existing body of `svgToPathLayers` into a new `svgToLeafPaths(svg: string, opts: SvgImportOpts = {}): Promise<SvgLeafResult>`, changing only its final loop to push `SvgLeafPath` objects instead of calling `createPathLayer`, and returning `{ paths, bbox }`. Keep every existing comment — the coordinate contract and the `expandShapes`/`applyMatrix` rationale are load-bearing.

- [ ] **Step 3: Reduce `svgToPathLayers` to a wrapper**

```ts
/**
 * Parse an SVG string into one or more PathLayers (one per leaf path, so
 * per-shape fills/strokes are preserved). Returns [] if nothing usable.
 *
 * A thin mapping over `svgToLeafPaths` — the parsing, normalization and
 * coordinate contract all live there now, shared with 3D Studio's importer.
 */
export async function svgToPathLayers(svg: string, opts: ImportOpts = {}): Promise<PathLayer[]> {
  const { paths, bbox } = await svgToLeafPaths(svg, { targetWidth: opts.targetWidth ?? 0.6 })
  const cx = opts.cx ?? 0.5
  const cy = opts.cy ?? 0.5
  return paths.map((p) => createPathLayer({
    d: p.d, bbox: { ...bbox }, scale: 1, x: cx, y: cy,
    fill: p.fill, fillRule: p.fillRule, stroke: p.stroke, strokeWidth: p.strokeWidth,
  }))
}
```

Note the default `targetWidth` differs between the two entry points: `svgToPathLayers` keeps `0.6`, which is the Compositor's existing behaviour and must not change.

- [ ] **Step 4: Verify nothing about the Compositor changed**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit 2>&1 | grep -E "useVectorSvg|useLocalLayerEditor|useCompositorLayers" | head`
Expected: no output.

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run 2>&1 | tail -8`
Expected: the repo's known baseline of 16 failures in 8 unrelated files (agent-capability-routing, artifact-next-steps, critique-fix-chips, gradientfx, spacetype-palette, ticker-effect, video-model-adapt). No new failures.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
export GIT_INDEX_FILE=/private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/eb1b3416-c889-4c34-b77e-bba637d024d2/scratchpad/svg-idx-t1
git read-tree HEAD
git add frontend/app/composables/useVectorSvg.ts
git commit -m "refactor(vector): extract svgToLeafPaths so 3D can share the SVG importer"
unset GIT_INDEX_FILE
```

---

### Task 2: The `svgPath` primitive kind

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts`
- Modify: `frontend/app/lib/scene3d/primParams.ts`
- Modify: `frontend/tests/unit/scene3d-config.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `'svgPath'` in `PrimitiveKind`; `path?: string` and `pathKey?: string` on `PrimitiveContent`; `svgPathKey(d: string): string`; `createSvgPathObject(d, existing, opts?)`. Tasks 3, 5 and 6 depend on these.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('scene3d config', …)` in `frontend/tests/unit/scene3d-config.unit.spec.ts`:

```ts
  it('round-trips an svgPath primitive with its path content', () => {
    const doc = defaultDoc()
    const o = createSvgPathObject('M0 0 L10 0 L10 10 Z', doc.objects)
    doc.objects = [o]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects).toHaveLength(1)
    const p = back.objects[0] as PrimitiveObject
    expect(p.primitive).toBe('svgPath')
    expect(p.content?.path).toBe('M0 0 L10 0 L10 10 Z')
    expect(p.content?.pathKey).toBe(svgPathKey('M0 0 L10 0 L10 10 Z'))
  })

  it('gives different pathKeys to different paths', () => {
    expect(svgPathKey('M0 0 L10 0 Z')).not.toBe(svgPathKey('M0 0 L20 0 Z'))
  })

  it('appends svgPath to PRIMITIVE_KINDS last, and excludes it from the add menu', () => {
    // svgPath is the one primitive that cannot be PLACED — it exists only as the
    // product of an import — so PRIM_GROUPS deliberately does not carry it.
    expect(PRIMITIVE_KINDS).toContain('svgPath')
    expect(PRIMITIVE_KINDS[PRIMITIVE_KINDS.length - 1]).toBe('svgPath')
    expect(NOT_PLACEABLE_KINDS).toContain('svgPath')
  })
```

Then change the existing menu-coverage assertion (around line 204) from an exact match to an exact match against the *placeable* kinds:

```ts
    const menuKinds = PRIM_GROUPS.flatMap((g) => g.kinds.map((k) => k.kind))
    // PRIM_GROUPS must still cover every kind a user can PLACE, exactly and in
    // order — the drift guard stays strict. `svgPath` is exempt because it has
    // no blank form to place: it only ever arrives carrying imported path data.
    const placeable = PRIMITIVE_KINDS.filter((k) => !NOT_PLACEABLE_KINDS.includes(k))
    expect(menuKinds).toEqual(placeable)
```

Extend the file's imports with `createSvgPathObject`, `svgPathKey`, `NOT_PLACEABLE_KINDS`, and `type PrimitiveObject`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: FAIL — `createSvgPathObject` is not exported.

- [ ] **Step 3: Implement in `config.ts`**

Extend the kind union (append only — stored indices are a persistence contract):

```ts
export type PrimitiveKind =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
  | 'capsule' | 'pyramid' | 'prism'
  | 'icosahedron' | 'octahedron' | 'dodecahedron'
  | 'torusKnot' | 'ring'
  | 'text' | 'shape' | 'svgPath'
```

Add `'svgPath'` as the last entry of the `PRIMITIVE_KINDS` array, and next to it:

```ts
/** Kinds with no blank form to place from the add menu — they only exist
 *  carrying data from an import. PRIM_GROUPS deliberately omits these, and the
 *  drift test subtracts them before asserting exact menu coverage, so the guard
 *  stays strict for everything a user CAN place. */
export const NOT_PLACEABLE_KINDS: PrimitiveKind[] = ['svgPath']
```

Extend `PrimitiveContent`:

```ts
export interface PrimitiveContent {
  text?: string
  font?: string
  /** An SVG path `d` with transforms already baked, in SVG convention (Y DOWN).
   *  The single stored form for every source element — rect, circle, polygon and
   *  path all normalize to this. The Y flip to scene space happens once at
   *  geometry build (pathToShapes), NOT here, so this stays a faithful path. */
  path?: string
  /** Digest of `path`, used ONLY as a geometry cache key. geoKeyFor stringifies
   *  the whole `content` on EVERY sync for EVERY object; a multi-KB `d` would
   *  put tens of KB of string work on the drag path. A cache key, not a security
   *  boundary — a cheap non-cryptographic hash is the right tool. */
  pathKey?: string
}
```

Add the hash and the factory next to `createPrimitive`:

```ts
/** Cheap 32-bit string digest (FNV-1a), prefixed with length so two different
 *  paths must collide in BOTH to alias. Only ever used as a cache key. */
export function svgPathKey(d: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < d.length; i++) {
    h ^= d.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${d.length}:${(h >>> 0).toString(36)}`
}

export function createSvgPathObject(
  d: string,
  existing: SceneObject[],
  opts: { name?: string; color?: string } = {},
): PrimitiveObject {
  const o: PrimitiveObject = {
    kind: 'primitive', primitive: 'svgPath',
    id: newId(), name: numberedName(opts.name ?? 'Path', existing), visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL },
    content: { path: d, pathKey: svgPathKey(d) },
  }
  if (opts.color) o.material.color = opts.color
  return o
}
```

In `parseDoc`'s `parseContent`, carry both fields through:

```ts
    if (typeof raw.path === 'string') c.path = raw.path
    if (typeof raw.pathKey === 'string') c.pathKey = raw.pathKey
```

- [ ] **Step 4: Add the geometry params in `primParams.ts`**

Add to `PRIMITIVE_PARAMS`, mirroring `text`'s extrude knobs minus the type-specific ones:

```ts
  // Extruded outline from an imported SVG path
  svgPath: [
    { key: 'depth', label: 'Depth', hint: 'How far the shape extrudes in 3D space', min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: 'bevel', label: 'Bevel', hint: 'Rounds off the edges for a smoother look', min: 0, max: 0.1, step: 0.005, default: 0.01 },
    { key: 'bevelSegments', label: 'Bevel segments', hint: 'How smooth each beveled edge looks', min: 1, max: 5, step: 1, default: 2 },
    { key: 'curveSegments', label: 'Curve segments', hint: 'How detailed the curves appear', min: 2, max: 12, step: 1, default: 6 },
  ],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: PASS, including the three new tests and every pre-existing one.

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "scene3d" | head`
Expected: no output. This feature's typecheck is currently completely clean; keep it that way. If a `switch` or ternary elsewhere fails to compile because the union grew, **that is the exhaustiveness guard working — fix the switch, do not cast**.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
export GIT_INDEX_FILE=/private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/eb1b3416-c889-4c34-b77e-bba637d024d2/scratchpad/svg-idx-t2
git read-tree HEAD
git add frontend/app/lib/scene3d/config.ts frontend/app/lib/scene3d/primParams.ts frontend/tests/unit/scene3d-config.unit.spec.ts
git commit -m "feat(scene3d): svgPath primitive kind with path content and cache key"
unset GIT_INDEX_FILE
```

---

### Task 3: `d` → geometry, and the Y flip

**Files:**
- Create: `frontend/app/lib/scene3d/svgPath.ts`
- Create: `frontend/tests/unit/scene3d-svg-path.unit.spec.ts`
- Modify: `frontend/app/lib/scene3d/engine.ts`

**Interfaces:**
- Consumes: `svgPathKey` (Task 2).
- Produces: `pathToShapes(d: string): THREE.Shape[]`. The engine's `geometryFor` handles `'svgPath'`.

**This is the half where the bugs live.** It needs only `DOMParser`, so it unit-tests under happy-dom.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/scene3d-svg-path.unit.spec.ts`:

```ts
// @vitest-environment happy-dom
// SVGLoader needs DOMParser; nothing here needs WebGL.
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { pathToShapes } from '~/lib/scene3d/svgPath'

/** Signed area of a shape's outer contour (shoelace), in path units. */
function area(shape: THREE.Shape): number {
  const pts = shape.getPoints(24)
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

describe('scene3d svgPath', () => {
  // A 10x10 square with a 4x4 square hole, wound so nonzero treats the inner
  // subpath as a hole.
  const SQUARE_WITH_HOLE =
    'M0 0 L10 0 L10 10 L0 10 Z M3 3 L3 7 L7 7 L7 3 Z'

  it('resolves an inner subpath as a hole, not a second solid', () => {
    const shapes = pathToShapes(SQUARE_WITH_HOLE)
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.holes).toHaveLength(1)
    // 100 minus the 16-unit hole, not 100 and not 116.
    const net = area(shapes[0]!) - area(new THREE.Shape(shapes[0]!.holes[0]!.getPoints(24)))
    expect(net).toBeCloseTo(84, 0)
  })

  it('flips Y: the topmost point of the SVG becomes the MAXIMUM y in scene space', () => {
    // In SVG, y=0 is the TOP. After the flip it must be the largest scene y.
    const shapes = pathToShapes('M0 0 L10 0 L10 10 L0 10 Z')
    const ys = shapes.flatMap((s) => s.getPoints(4).map((p) => p.y))
    // The SVG's y=0 edge is the top; flipped, it is at scene y = 0, and the
    // SVG's y=10 edge (visually lower) is at scene y = -10.
    expect(Math.max(...ys)).toBeCloseTo(0, 5)
    expect(Math.min(...ys)).toBeCloseTo(-10, 5)
  })

  it('returns no shapes for an unparseable d, and does not throw', () => {
    expect(() => pathToShapes('not a path')).not.toThrow()
    expect(pathToShapes('not a path')).toEqual([])
  })

  it('returns no shapes for an empty d', () => {
    expect(pathToShapes('')).toEqual([])
  })

  it('caches: the same d returns shape data equal to a fresh parse', () => {
    const a = pathToShapes(SQUARE_WITH_HOLE)
    const b = pathToShapes(SQUARE_WITH_HOLE)
    expect(area(b[0]!)).toBeCloseTo(area(a[0]!), 5)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-svg-path.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/scene3d/svgPath`.

- [ ] **Step 3: Implement**

Create `frontend/app/lib/scene3d/svgPath.ts`:

```ts
// frontend/app/lib/scene3d/svgPath.ts
// Turns a stored SVG path `d` into the THREE.Shape[] the extruder wants.
//
// The stored `d` is a FAITHFUL SVG path — transforms baked, but still in SVG
// convention where Y points DOWN. The flip to scene space happens HERE, in one
// place, for two reasons: the stored string stays debuggable and re-exportable,
// and this module needs only DOMParser (no WebGL), so the flip is unit-testable.
// A missed flip renders plausibly on a symmetric logo and upside-down on
// everything else, which is exactly the kind of bug that ships.
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'

const loader = new SVGLoader()
const cache = new Map<string, THREE.Shape[]>()
/** Bounded so a long editing session can't grow this without limit; imports are
 *  small and repeated, so a modest cap keeps every live object's path resident. */
const CACHE_MAX = 256

/** Parse one `d` into shapes, Y-flipped into scene space. Returns [] on anything
 *  unparseable rather than throwing — a bad path must degrade to "no geometry",
 *  which the caller renders as the placeholder, not to a broken studio. */
export function pathToShapes(d: string): THREE.Shape[] {
  if (!d) return []
  const hit = cache.get(d)
  if (hit) return hit
  let shapes: THREE.Shape[] = []
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d.replace(/"/g, "'")}"/></svg>`
    const parsed = loader.parse(svg)
    shapes = parsed.paths.flatMap((p) => SVGLoader.createShapes(p))
    // SVG Y-down -> three Y-up. Scaling by -1 on Y also reverses winding, which
    // is what keeps holes reading as holes after the flip.
    const flip = new THREE.Matrix3().scale(1, -1)
    for (const s of shapes) {
      applyMatrix3(s, flip)
      for (const h of s.holes) applyMatrix3(h, flip)
    }
  } catch {
    shapes = []
  }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(d, shapes)
  return shapes
}

/** THREE.Path has no transform of its own — walk the curves and move their
 *  control points. Covers the curve types SVGLoader emits from a `d`. */
function applyMatrix3(path: THREE.Path, m: THREE.Matrix3): void {
  const v = new THREE.Vector2()
  const move = (p: THREE.Vector2 | undefined) => {
    if (!p) return
    v.set(p.x, p.y).applyMatrix3(m)
    p.set(v.x, v.y)
  }
  for (const c of path.curves) {
    const anyC = c as unknown as Record<string, THREE.Vector2 | undefined>
    move(anyC.v0); move(anyC.v1); move(anyC.v2); move(anyC.v3)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-svg-path.unit.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the Y-flip test can fail (mandatory)**

Temporarily comment out the flip loop in `pathToShapes` (the `for (const s of shapes)` block). Re-run.

Expected: FAIL on "flips Y", with max y at 10 and min at 0 — the unflipped values. **If it still passes, the assertion is not testing the flip; fix the test before restoring.** Then restore and confirm PASS. Report both outputs.

- [ ] **Step 6: Wire the engine**

In `frontend/app/lib/scene3d/engine.ts`, import at the top:

```ts
import { pathToShapes } from './svgPath'
```

In `geometryFor`, add a case beside `'shape'`:

```ts
    case 'svgPath': {
      const shapes = pathToShapes(content?.path ?? '')
      if (!shapes.length) return extrudePlaceholderGeometry()
      return extrudeShapes(shapes, p('depth'), p('bevel'), p('bevelSegments'), p('curveSegments'))
    }
```

In `geoKeyFor`, use the digest instead of the multi-KB path:

```ts
export function geoKeyFor(obj: PrimitiveObject, variant: 'smooth' | 'facet'): string {
  const vals = PRIMITIVE_PARAMS[obj.primitive].map((s) => paramValue(obj.primitive, obj.params, s.key))
  const mods = MODIFIER_SPECS.map((s) => modifierValue(obj.modifiers, s.key))
  // An svgPath's `d` runs to several KB and this key is rebuilt on EVERY sync
  // for EVERY object — stringifying it would put tens of KB of string work on
  // the drag path. `pathKey` is the digest standing in for it.
  const c = obj.content
  const content = c
    ? JSON.stringify(c.pathKey ? { ...c, path: undefined } : c)
    : ''
  return `${obj.primitive}|${vals.join(',')}|${mods.join(',')}|${variant}|${content}`
}
```

- [ ] **Step 7: Verify**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "scene3d|svgPath" | head`
Expected: no output.

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run 2>&1 | tail -8`
Expected: the known 16-failure baseline in 8 unrelated files; no scene3d failure.

- [ ] **Step 8: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
export GIT_INDEX_FILE=/private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/eb1b3416-c889-4c34-b77e-bba637d024d2/scratchpad/svg-idx-t3
git read-tree HEAD
git add frontend/app/lib/scene3d/svgPath.ts frontend/tests/unit/scene3d-svg-path.unit.spec.ts frontend/app/lib/scene3d/engine.ts
git commit -m "feat(scene3d): extrude an SVG path d, flipping Y in one testable place"
unset GIT_INDEX_FILE
```

---

### Task 4: Stroke outlining

**Files:**
- Modify: `frontend/app/composables/useVectorSvg.ts`

**Interfaces:**
- Consumes: `SvgLeafPath` (Task 1).
- Produces: `outlineStrokes(paths: SvgLeafPath[]): Promise<SvgLeafPath[]>` — every stroke-only path replaced by a filled outline; already-filled paths pass through untouched.

**Why this exists:** a path with `fill: 'none'` has an open outline and nothing to extrude. Lucide (this repo's own icon set), Feather and Heroicons-outline are entirely stroke-only, so without this the most likely paste imports as nothing at all.

**Method:** paper.js boolean ops. For each subpath, unite one rectangle per segment with one circle at every join and cap. For round caps and joins this is exact — and round is what those icon sets specify. Miter and bevel are approximated as round.

- [ ] **Step 1: Implement**

Add to `frontend/app/composables/useVectorSvg.ts`:

```ts
/**
 * Replace every stroke-only path (fill 'none', non-zero strokeWidth) with a
 * FILLED outline of its stroke, so it has area to extrude. Filled paths pass
 * through untouched; a path with neither fill nor stroke is dropped.
 *
 * Built from paper's boolean ops rather than SVGLoader's pointsToStroke, which
 * returns a BufferGeometry of triangles and cannot feed ExtrudeGeometry.
 *
 * EXACT for round joins and caps — which is what Lucide/Feather/Heroicons all
 * specify — because a round-joined stroke's outline IS the union of a rectangle
 * per segment and a disc at every vertex. Miter and bevel joins are
 * approximated as round, so a sharp-cornered stroked logo loses its points;
 * accepted v1 limitation. Dasharray is ignored: a dashed stroke outlines solid.
 */
export async function outlineStrokes(paths: SvgLeafPath[]): Promise<SvgLeafPath[]> {
  const sc = await paperScope()
  const out: SvgLeafPath[] = []
  for (const p of paths) {
    const hasFill = p.fill !== 'none'
    const hasStroke = p.stroke !== 'none' && p.strokeWidth > 0
    if (hasFill) { out.push(p); continue }
    if (!hasStroke) continue // nothing to draw and nothing to extrude

    let united: Paper.PathItem | null = null
    try {
      const src = new sc.CompoundPath(p.d)
      const r = p.strokeWidth / 2
      const children = (src.children?.length ? src.children : [src]) as Paper.Path[]
      for (const child of children) {
        const pts = child.segments.map((s) => s.point)
        if (child.closed && pts.length) pts.push(pts[0]!)
        for (let i = 0; i < pts.length; i++) {
          // A disc at every vertex — this is the join/cap, and it is why round
          // joins come out exact.
          const dot = new sc.Path.Circle(pts[i]!, r)
          united = united ? (united.unite(dot) as Paper.PathItem) : dot
          if (i + 1 >= pts.length) continue
          // A rectangle spanning this segment, rotated onto it.
          const a = pts[i]!, b = pts[i + 1]!
          const len = a.getDistance(b)
          if (len < 1e-9) continue
          const rect = new sc.Path.Rectangle(new sc.Rectangle(0, -r, len, r * 2))
          rect.rotate((b.subtract(a)).angle, new sc.Point(0, 0))
          rect.translate(a)
          united = united.unite(rect) as Paper.PathItem
        }
      }
      src.remove()
    } catch {
      united = null
    }
    if (!united) continue
    out.push({
      d: united.getPathData(undefined, 4),
      fill: p.stroke,          // the stroke's colour becomes the solid's colour
      stroke: 'none',
      strokeWidth: 0,
      fillRule: 'nonzero',
    })
    united.remove()
  }
  sc.project.clear()
  return out
}
```

Note `child.segments` gives anchor points only; a curved stroke is approximated by its anchors. If a curved stroke visibly under-samples in Task 7's E2E, flatten each child with `child.flatten(tolerance)` on a clone before reading segments, and say so in the report.

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit 2>&1 | grep -E "useVectorSvg" | head`
Expected: no output.

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run 2>&1 | tail -8`
Expected: the known 16-failure baseline; nothing new.

**There is no unit test for this task** — paper.js touches browser globals and does not run under vitest's node environment. Task 7's E2E covers it, with a real Lucide icon as the fixture. If you find paper *does* initialize under `// @vitest-environment happy-dom`, add a unit test asserting a stroked line outlines to non-zero area and say so in your report; do not spend long finding out.

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
export GIT_INDEX_FILE=/private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/eb1b3416-c889-4c34-b77e-bba637d024d2/scratchpad/svg-idx-t4
git read-tree HEAD
git add frontend/app/composables/useVectorSvg.ts
git commit -m "feat(vector): outline stroke-only paths into fills so they can extrude"
unset GIT_INDEX_FILE
```

---

### Task 5: Turning leaf paths into scene objects

**Files:**
- Create: `frontend/app/lib/scene3d/svgImport.ts`
- Create: `frontend/tests/unit/scene3d-svg-import.unit.spec.ts`

**Interfaces:**
- Consumes: `SvgLeafPath` (Task 1), `createSvgPathObject` / `createGroup` (Task 2 and existing).
- Produces: `SVG_SPLIT_THRESHOLD`, `buildSvgObjects(paths, existing, opts)`. Task 6 calls it.

**Pure by construction:** it takes already-parsed leaf paths and returns doc objects, so no paper, no DOM, no WebGL — it unit-tests under the default node environment. This is the same move that made `hierarchy.ts` catch four real bugs.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/scene3d-svg-import.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSvgObjects, SVG_SPLIT_THRESHOLD } from '~/lib/scene3d/svgImport'
import type { SvgLeafPath } from '~/composables/useVectorSvg'
import type { PrimitiveObject } from '~/lib/scene3d/config'

function leaf(d: string, fill = '#ff0000'): SvgLeafPath {
  return { d, fill, stroke: 'none', strokeWidth: 0, fillRule: 'nonzero' }
}

describe('scene3d svg import', () => {
  it('returns a group followed by one svgPath per path', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z'), leaf('M2 0 L3 0 Z')], [], { name: 'Logo' })
    expect(objs).toHaveLength(3)
    const group = objs.find((o) => o.kind === 'group')!
    expect(group.name).toBe('Logo')
    const kids = objs.filter((o) => o.id !== group.id)
    expect(kids).toHaveLength(2)
    for (const k of kids) {
      expect(k.parentId).toBe(group.id)
      expect((k as PrimitiveObject).primitive).toBe('svgPath')
    }
  })

  it('seeds each object colour from its fill', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z', '#00ff00')], [], { name: 'X' })
    const kid = objs.find((o) => o.kind === 'primitive') as PrimitiveObject
    expect(kid.material.color).toBe('#00ff00')
  })

  it('leaves the default colour alone when a path has no fill', () => {
    const p: SvgLeafPath = { d: 'M0 0 L1 0 Z', fill: 'none', stroke: 'none', strokeWidth: 0, fillRule: 'nonzero' }
    const objs = buildSvgObjects([p], [], { name: 'X' })
    const kid = objs.find((o) => o.kind === 'primitive') as PrimitiveObject
    expect(kid.material.color).toBeTruthy()
  })

  it('merged mode yields exactly one object whose d holds every subpath', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z'), leaf('M2 0 L3 0 Z')], [], { name: 'X', merged: true })
    const kids = objs.filter((o) => o.kind === 'primitive') as PrimitiveObject[]
    expect(kids).toHaveLength(1)
    expect(kids[0]!.content?.path).toContain('M0 0 L1 0 Z')
    expect(kids[0]!.content?.path).toContain('M2 0 L3 0 Z')
  })

  it('merged mode still produces a group, so the import is one movable unit', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z')], [], { name: 'X', merged: true })
    expect(objs.some((o) => o.kind === 'group')).toBe(true)
  })

  it('parents the group under an existing parent when asked', () => {
    const objs = buildSvgObjects([leaf('M0 0 L1 0 Z')], [], { name: 'X', parentId: 'outer' })
    expect(objs.find((o) => o.kind === 'group')!.parentId).toBe('outer')
  })

  it('names children uniquely against the existing scene', () => {
    const first = buildSvgObjects([leaf('M0 0 L1 0 Z')], [], { name: 'Logo' })
    const second = buildSvgObjects([leaf('M0 0 L1 0 Z')], first, { name: 'Logo' })
    const names = [...first, ...second].map((o) => o.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('exports a split threshold', () => {
    expect(SVG_SPLIT_THRESHOLD).toBe(40)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-svg-import.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/scene3d/svgImport`.

- [ ] **Step 3: Implement**

Create `frontend/app/lib/scene3d/svgImport.ts`:

```ts
// frontend/app/lib/scene3d/svgImport.ts
// Turns already-parsed SVG leaf paths into scene objects. Deliberately pure —
// no paper, no DOM, no WebGL — so the object-shaping rules (grouping, colour
// seeding, merge) are unit-testable. Parsing lives in useVectorSvg.ts and
// geometry lives in svgPath.ts; this module only decides what lands in the doc.
import { createGroup, createSvgPathObject, type SceneObject } from './config'
import type { SvgLeafPath } from '~/composables/useVectorSvg'

/** Above this many paths, import ASKS whether to split or merge rather than
 *  silently creating hundreds of meshes and hundreds of object rows. A starting
 *  value, not a measured one — it lives here alone so moving it is one line. */
export const SVG_SPLIT_THRESHOLD = 40

export interface BuildOpts {
  /** Group name — the file's basename, or 'SVG' for a paste. */
  name: string
  /** Concatenate every path into ONE object. Same primitive, same extruder:
   *  createShapes still resolves holes across the whole set, which is what makes
   *  a merged import read as one solid rather than overlapping pieces. */
  merged?: boolean
  /** Parent for the new group, so importing inside a group nests. */
  parentId?: string
}

/** Returns the group FIRST, then its children. The caller appends the whole
 *  array to doc.objects; the engine sorts with orderParentsFirst anyway, but
 *  returning them in order keeps the object list reading top-down. */
export function buildSvgObjects(
  paths: readonly SvgLeafPath[],
  existing: readonly SceneObject[],
  opts: BuildOpts,
): SceneObject[] {
  const scope = [...existing]
  const group = createGroup(scope)
  group.name = opts.name
  if (opts.parentId) group.parentId = opts.parentId
  scope.push(group)

  const usable = paths.filter((p) => p.d)
  if (!usable.length) return [group]

  const make = (d: string, fill: string): SceneObject => {
    // A merged object can only carry one material, so it takes the first real
    // fill; 'none' leaves DEFAULT_MATERIAL's colour rather than writing 'none'.
    const o = createSvgPathObject(d, scope, {
      name: 'Path',
      ...(fill && fill !== 'none' ? { color: fill } : {}),
    })
    o.parentId = group.id
    scope.push(o)
    return o
  }

  if (opts.merged) {
    const d = usable.map((p) => p.d).join(' ')
    const fill = usable.find((p) => p.fill && p.fill !== 'none')?.fill ?? 'none'
    return [group, make(d, fill)]
  }
  return [group, ...usable.map((p) => make(p.d, p.fill))]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-svg-import.unit.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the naming test can fail**

Temporarily change `make` to pass `existing` instead of the accumulating `scope`. Re-run.

Expected: FAIL on "names children uniquely against the existing scene" — two objects share a name, the same batch-numbering bug the grouping build hit in `duplicateObject`. Restore and confirm PASS. Report both outputs.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
export GIT_INDEX_FILE=/private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/eb1b3416-c889-4c34-b77e-bba637d024d2/scratchpad/svg-idx-t5
git read-tree HEAD
git add frontend/app/lib/scene3d/svgImport.ts frontend/tests/unit/scene3d-svg-import.unit.spec.ts
git commit -m "feat(scene3d): build a group of svgPath objects from parsed leaf paths"
unset GIT_INDEX_FILE
```

---

### Task 6: The import UI

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: `svgToLeafPaths` + `outlineStrokes` (Tasks 1, 4), `buildSvgObjects` + `SVG_SPLIT_THRESHOLD` (Task 5).
- Produces: the user-facing import. Task 7 drives it.

Both entry points sit in the Objects aside beside the existing GLB upload, which is where file imports already live. Model the markup and the hidden-input pattern on `glbFileInput` / `onGlbFilePicked` in that file.

- [ ] **Step 1: Add the import function and state**

Beside the other object operations:

```ts
// ── SVG import ────────────────────────────────────────────────────────────────
const svgFileInput = ref<HTMLInputElement | null>(null)
const svgPasteOpen = ref(false)
const svgPasteText = ref('')
const svgError = ref<string | null>(null)
/** Set when a source exceeds SVG_SPLIT_THRESHOLD: the user picks split or merged
 *  before anything is added, so a 247-path map can never silently flood the
 *  scene AND we never silently truncate their artwork. */
const svgPending = ref<{ paths: SvgLeafPath[]; name: string } | null>(null)

async function importSvgSource(source: string, name: string) {
  svgError.value = null
  let paths: SvgLeafPath[]
  try {
    const res = await svgToLeafPaths(source, { targetWidth: 1.5 })
    paths = await outlineStrokes(res.paths)
  } catch {
    svgError.value = 'Could not read that SVG.'
    return
  }
  if (!paths.length) {
    svgError.value = 'That SVG had nothing to extrude — no filled or stroked paths.'
    return
  }
  if (paths.length > SVG_SPLIT_THRESHOLD) { svgPending.value = { paths, name }; return }
  commitSvg(paths, name, false)
}

function commitSvg(paths: SvgLeafPath[], name: string, merged: boolean) {
  const objs = buildSvgObjects(paths, doc.objects, {
    name, merged, ...(selected.value?.parentId ? { parentId: selected.value.parentId } : {}),
  })
  doc.objects.push(...objs)
  selectedIds.value = [objs[0]!.id] // the group
  svgPending.value = null
  svgPasteOpen.value = false
  svgPasteText.value = ''
}

async function onSvgFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const base = file.name.replace(/\.svg$/i, '') || 'SVG'
  await importSvgSource(await file.text(), base)
}
```

Add the imports:

```ts
import { svgToLeafPaths, outlineStrokes, type SvgLeafPath } from '~/composables/useVectorSvg'
import { buildSvgObjects, SVG_SPLIT_THRESHOLD } from '~/lib/scene3d/svgImport'
```

- [ ] **Step 2: Add the markup**

In the Objects aside, beside the existing GLB input:

```html
<div class="shrink-0 space-y-1 border-t border-white/[0.08] p-2">
  <StudioButton @click="svgFileInput?.click()">
    <span class="flex items-center gap-1.5"><Upload class="h-3.5 w-3.5" /> Import SVG</span>
  </StudioButton>
  <StudioButton @click="svgPasteOpen = !svgPasteOpen">
    <span class="flex items-center gap-1.5"><ClipboardPaste class="h-3.5 w-3.5" /> Paste SVG</span>
  </StudioButton>
  <div v-if="svgPasteOpen" class="space-y-1">
    <textarea v-model="svgPasteText" rows="4" placeholder="Paste <svg>…</svg>"
      class="w-full rounded bg-black/30 p-2 text-[11px] text-white/80" @pointerdown.stop />
    <StudioButton :disabled="!svgPasteText.trim()" @click="importSvgSource(svgPasteText, 'SVG')">Add</StudioButton>
  </div>
  <p v-if="svgError" class="text-[11px] text-red-400">{{ svgError }}</p>
  <div v-if="svgPending" class="space-y-1 rounded border border-white/15 p-2 text-[11px]">
    <p class="text-white/70">This SVG has {{ svgPending.paths.length }} paths.</p>
    <div class="flex gap-1">
      <StudioButton @click="commitSvg(svgPending.paths, svgPending.name, false)">Separate objects</StudioButton>
      <StudioButton @click="commitSvg(svgPending.paths, svgPending.name, true)">One merged object</StudioButton>
    </div>
  </div>
  <input ref="svgFileInput" type="file" accept=".svg,image/svg+xml" class="hidden" @change="onSvgFilePicked" />
</div>
```

Add `Upload` and `ClipboardPaste` to the existing `lucide-vue-next` import. Follow the file's existing `StudioButton` usage; do not invent button styling, and do not introduce any accent colour other than action blue.

- [ ] **Step 3: Verify**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit 2>&1 | grep -E "Scene3DStudioSurface" | head`
Expected: no output.

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run 2>&1 | tail -8`
Expected: the known 16-failure baseline; nothing new.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
export GIT_INDEX_FILE=/private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/eb1b3416-c889-4c34-b77e-bba637d024d2/scratchpad/svg-idx-t6
git read-tree HEAD
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): import SVG by file or paste, with a split/merge choice"
unset GIT_INDEX_FILE
```

---

### Task 7: End-to-end coverage

**Files:**
- Create: `frontend/tests/scene3d-svg-import.spec.ts`

**Interfaces:**
- Consumes: the whole feature.
- Produces: the only proof the paper.js half works, since it cannot unit-test.

Model the harness on `frontend/tests/scene3d-grouping.spec.ts` — in particular its local `openBlankWorkflow` that does NOT wait for `networkidle` (the app polls `/system_stats` continuously, so it never fires). Open the studio by dispatching `new CustomEvent('sailor:openScene3DStudio', { detail: { nodeId } })` after `dropNode(page, 'Scene3DStudio')`.

Selectors established by the grouping work: object rows are `[data-testid="object-row"]` with `[data-object-id]` / `[data-object-name]`, group child counts are `[data-testid="object-row-children"]`.

- [ ] **Step 1: Write the spec**

Four tests:

1. **Two filled paths** — paste `<svg viewBox="0 0 20 10"><path d="M0 0 H10 V10 H0 Z" fill="#ff0000"/><path d="M12 0 H20 V10 H12 Z" fill="#00ff00"/></svg>`, click Add. Assert a group row appears with `[data-testid="object-row-children"]` reading `2`, and two child rows.
2. **A Lucide icon** — paste a real stroke-only icon (`fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`, e.g. the `box` glyph's paths). Assert a group with at least one child, and that the child's **Size** row reads non-zero on X and Y — this proves the stroke actually outlined into extrudable area. **This is the test the whole stroke branch exists for; without it that branch is unverified.**
3. **Merged choice** — paste an SVG with more than 40 paths (generate them in the test string), assert the choice panel appears, click "One merged object", assert exactly one child.
4. **Nothing to extrude** — paste `<svg><path d="M0 0 L10 0"/></svg>` with no fill and no stroke width, assert the error message appears and no group is added.

- [ ] **Step 2: Run it**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && PW_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/scene3d-svg-import.spec.ts --reporter=line`
Expected: PASS.

- [ ] **Step 3: Prove test 2 can fail**

Temporarily make `outlineStrokes` return `paths` unchanged (skip the outlining entirely). Re-run.

Expected: test 2 FAILS — the stroke-only icon yields no extrudable area. Restore and confirm PASS. **If test 2 still passes without outlining, it is not testing the stroke branch; fix it before restoring.** Report both outputs.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
export GIT_INDEX_FILE=/private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/eb1b3416-c889-4c34-b77e-bba637d024d2/scratchpad/svg-idx-t7
git read-tree HEAD
git add frontend/tests/scene3d-svg-import.spec.ts
git commit -m "test(scene3d): E2E SVG import, including the stroke-only icon case"
unset GIT_INDEX_FILE
```

---

## Self-Review

**Spec coverage.** Object model (`svgPath` primitive, `content.path`, `pathKey`) → Task 2. Cache-key hazard → Task 3 Step 6. Import pipeline reuse / `svgToLeafPaths` extraction → Task 1. Stroke outlining → Task 4. Y flip at geometry build → Task 3, with a mandatory broken control. `PRIM_GROUPS` collision → Task 2, via `NOT_PLACEABLE_KINDS`. Grouping, colour seeding, merged mode, threshold → Task 5. Entry points and the choice dialog → Task 6. Error handling → Task 6 (`svgError`) and Task 7 test 4. Testing → Tasks 2, 3, 5, 7.

**Known gap, stated deliberately.** The spec's `notes` channel (surfacing unimplemented fill rules and approximated joins) is **not implemented**. Task 6 carries a single `svgError` string for hard failures only. Adding a per-import notes list is a small follow-up; it is called out here rather than silently dropped, and should be logged as a Minor at the final review.

**Placeholder scan.** No TBDs. Task 7's tests are described rather than written out verbatim — the four cases, their fixtures, and their assertions are each specified concretely, but the harness boilerplate is delegated to the existing grouping spec rather than duplicated. Task 4 has no unit test **by design**, with the reason and the fallback stated.

**Type consistency.** `SvgLeafPath` has the same five fields in Tasks 1, 4, 5 and 6. `svgToLeafPaths` returns `{ paths, bbox }` in Task 1 and is destructured that way in Task 6. `buildSvgObjects(paths, existing, opts)` returns `SceneObject[]` with the group first in Task 5 and is consumed that way in Task 6. `pathToShapes(d)` takes one string in Task 3 and is called that way from the engine. `SVG_SPLIT_THRESHOLD` is 40 in Tasks 5 and 6.

**Risk carried into execution.** Task 4 is the only task with no automated gate of its own until Task 7 runs, and it is also the largest new surface. If it is wrong, the failure appears as "the icon imported but looks blobby" rather than as an error — so Task 7 test 2 should assert non-zero area, not just that an object exists.
