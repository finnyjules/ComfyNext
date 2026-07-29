# Scene3D Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give 3D Studio object hierarchy — a `group` scene object plus a `parentId` on every object — so several objects move, rotate, scale and animate as one unit.

**Architecture:** `doc.objects` stays a **flat array**; hierarchy is a `parentId` reference. The engine turns that reference into a real three.js parent/child edge, and three's scene graph composes the transforms — no matrix maths on the render path. All hierarchy logic (ordering, cycle-breaking, group/ungroup rebasing) lives in a new pure module, `lib/scene3d/hierarchy.ts`, so it is unit-testable with no WebGL context.

**Tech Stack:** Vue 3 + TypeScript (Nuxt 4), three.js 0.171, vitest (unit), Playwright (E2E).

## Global Constraints

- `doc.objects` **stays flat**. Never introduce a nested `children` array — seven of the eight modules that iterate it depend on flatness, and `objects.<id>.motion.*` agent paths assume a flat id space.
- `SceneDoc.version` stays `1`. `parentId` and the `group` kind are optional additions; every existing doc must load unchanged with all objects at root.
- Two parser invariants are non-negotiable: a `parentId` resolving to no object is **dropped** (orphans surface at root), and cycles are **broken** at parse time (never hang the ancestor walk).
- `disposeTree` must **never** walk into a child object's root. Children are independent doc objects with their own lifecycle; disposing them frees GPU resources still referenced by `objectRoots`.
- Transform rebasing uses **world-matrix decomposition, never subtraction**. Subtraction looks correct until an ancestor is rotated or non-uniformly scaled.
- `hierarchy.ts` stays **pure** — no engine imports, no WebGL. It may import `THREE` (Matrix4/Quaternion are plain JS) and `import type` from `config.ts` only.
- Unit tests: `cd frontend && npx vitest run <path>`. E2E: `cd frontend && npx playwright test <path>`.
- Follow the house comment style in `lib/scene3d/`: explain *why*, name the failure mode a rule prevents.

---

### Task 1: Pure hierarchy helpers

**Files:**
- Create: `frontend/app/lib/scene3d/hierarchy.ts`
- Create: `frontend/tests/unit/scene3d-hierarchy.unit.spec.ts`

**Interfaces:**
- Consumes: `SceneObject` (type only) from `~/lib/scene3d/config`.
- Produces: `rootObjects(objects)`, `childrenOf(objects, id)`, `descendantIds(objects, id)`, `orderParentsFirst(objects)`, `sanitizeHierarchy(objects)`. Tasks 2 and 4 depend on `sanitizeHierarchy` and `orderParentsFirst`; Tasks 8 and 9 depend on `childrenOf` and `descendantIds`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/scene3d-hierarchy.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  rootObjects, childrenOf, descendantIds, orderParentsFirst, sanitizeHierarchy,
} from '~/lib/scene3d/hierarchy'
import type { SceneObject } from '~/lib/scene3d/config'

/** Minimal stand-in — hierarchy.ts only ever reads `id` and `parentId`. */
function obj(id: string, parentId?: string): SceneObject {
  return {
    kind: 'primitive', primitive: 'box', id, name: id, visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { type: 'standard' } as SceneObject['material'],
    ...(parentId ? { parentId } : {}),
  } as SceneObject
}

describe('scene3d hierarchy', () => {
  it('lists roots and direct children', () => {
    const objects = [obj('g'), obj('a', 'g'), obj('b', 'g'), obj('c')]
    expect(rootObjects(objects).map(o => o.id)).toEqual(['g', 'c'])
    expect(childrenOf(objects, 'g').map(o => o.id)).toEqual(['a', 'b'])
    expect(childrenOf(objects, 'c')).toEqual([])
  })

  it('collects descendants depth-first, excluding the object itself', () => {
    const objects = [obj('g'), obj('inner', 'g'), obj('leaf', 'inner'), obj('other')]
    expect(descendantIds(objects, 'g').sort()).toEqual(['inner', 'leaf'])
    expect(descendantIds(objects, 'leaf')).toEqual([])
  })

  it('orders parents before children regardless of array order', () => {
    const objects = [obj('leaf', 'inner'), obj('inner', 'g'), obj('g')]
    const ids = orderParentsFirst(objects).map(o => o.id)
    expect(ids.indexOf('g')).toBeLessThan(ids.indexOf('inner'))
    expect(ids.indexOf('inner')).toBeLessThan(ids.indexOf('leaf'))
  })

  it('preserves every object when ordering', () => {
    const objects = [obj('leaf', 'inner'), obj('inner', 'g'), obj('g'), obj('lone')]
    expect(orderParentsFirst(objects)).toHaveLength(4)
  })

  it('drops a parentId that resolves to no object', () => {
    const objects = [obj('a', 'ghost')]
    sanitizeHierarchy(objects)
    expect(objects[0]!.parentId).toBeUndefined()
  })

  it('breaks a two-object cycle', () => {
    const objects = [obj('a', 'b'), obj('b', 'a')]
    sanitizeHierarchy(objects)
    // Exactly one edge is cut, so the pair becomes a chain rather than a loop.
    const withParent = objects.filter(o => o.parentId)
    expect(withParent).toHaveLength(1)
    expect(() => orderParentsFirst(objects)).not.toThrow()
  })

  it('breaks a three-object cycle', () => {
    const objects = [obj('a', 'c'), obj('b', 'a'), obj('c', 'b')]
    sanitizeHierarchy(objects)
    expect(objects.filter(o => o.parentId)).toHaveLength(2)
    expect(orderParentsFirst(objects)).toHaveLength(3)
  })

  it('rejects an object parented to itself', () => {
    const objects = [obj('a', 'a')]
    sanitizeHierarchy(objects)
    expect(objects[0]!.parentId).toBeUndefined()
  })

  it('leaves a valid hierarchy untouched', () => {
    const objects = [obj('g'), obj('a', 'g')]
    sanitizeHierarchy(objects)
    expect(objects[1]!.parentId).toBe('g')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-hierarchy.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/scene3d/hierarchy`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/scene3d/hierarchy.ts`:

```ts
// frontend/app/lib/scene3d/hierarchy.ts
// Object hierarchy for Scene3D, expressed as `parentId` references over a FLAT
// `doc.objects` array. Nesting the array instead would force every one of the
// eight modules that iterate doc.objects to recurse, and would break the flat
// `objects.<id>.motion.*` agent path space — see the grouping design spec.
//
// Deliberately pure: no engine import, no WebGL. THREE appears here only for
// Matrix4/Quaternion (plain JS maths, no renderer), which is what lets the
// group/ungroup transform invariants be unit-tested without a GPU context.
import type { SceneObject } from './config'

/** Objects with no resolvable parent — the top level of the tree. Call after
 *  `sanitizeHierarchy`, which is what guarantees "absent" and "unresolvable"
 *  are the same thing. */
export function rootObjects(objects: readonly SceneObject[]): SceneObject[] {
  return objects.filter((o) => !o.parentId)
}

/** Direct children of `id`, in array order — the ordering the object list
 *  renders within each level. */
export function childrenOf(objects: readonly SceneObject[], id: string): SceneObject[] {
  return objects.filter((o) => o.parentId === id)
}

/** Every descendant id of `id`, excluding `id` itself. Used by delete and
 *  duplicate, both of which act on a whole subtree. Iterative rather than
 *  recursive, and guarded by a seen-set, so a cycle that slipped past
 *  `sanitizeHierarchy` degrades to a finite walk instead of a stack overflow. */
export function descendantIds(objects: readonly SceneObject[], id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    const current = queue.shift()!
    for (const child of childrenOf(objects, current)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child.id)
      queue.push(child.id)
    }
  }
  return out
}

/** `objects` reordered so every parent precedes its children. The engine syncs
 *  in this order because a child's three-root cannot be added to a parent root
 *  that does not exist yet.
 *
 *  Depth-sorted rather than a full topological sort: simpler, stable, and the
 *  cycle invariant guarantees the depth walk terminates. An object whose
 *  ancestor chain is broken anyway (defensive — `sanitizeHierarchy` should have
 *  cut it) is treated as depth 0 rather than dropped, so nothing vanishes. */
export function orderParentsFirst(objects: readonly SceneObject[]): SceneObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const depthOf = (o: SceneObject): number => {
    let depth = 0
    const seen = new Set<string>([o.id])
    let current = o
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent || seen.has(parent.id)) break
      seen.add(parent.id)
      current = parent
      depth++
    }
    return depth
  }
  // Decorate-sort-undecorate on the index keeps the sort stable across engines.
  return objects
    .map((o, i) => ({ o, i, d: depthOf(o) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.o)
}

/** In-place repair of the two ways a `parentId` graph can be invalid. MUTATES
 *  `objects` — it runs inside `parseDoc`, on freshly-built objects nobody else
 *  holds yet.
 *
 *  1. A `parentId` naming no object in the doc is dropped, so the object
 *     surfaces at the root. This is what saves a document that has been through
 *     an OLDER build: `parseDoc`'s flatMap silently drops unknown kinds, so a
 *     group vanishes while its children keep pointing at its id.
 *  2. Cycles are broken by cutting the edge that closes the loop. A doc can be
 *     hand-edited, agent-written, or round-tripped through anything; an
 *     infinite ancestor walk must not be reachable from parsed input. */
export function sanitizeHierarchy(objects: SceneObject[]): void {
  const byId = new Map(objects.map((o) => [o.id, o]))
  for (const o of objects) {
    if (o.parentId && !byId.has(o.parentId)) delete o.parentId
  }
  for (const o of objects) {
    const seen = new Set<string>([o.id])
    let current = o
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent) break
      if (seen.has(parent.id)) { delete current.parentId; break }
      seen.add(parent.id)
      current = parent
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-hierarchy.unit.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/hierarchy.ts frontend/tests/unit/scene3d-hierarchy.unit.spec.ts
git commit -m "feat(scene3d): pure parentId hierarchy helpers"
```

---

### Task 2: `GroupObject`, `parentId`, and parser invariants

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` (`SceneObjectBase`, `SceneObject` union, `sceneHasShaderFill`, `createGroup`, `parseDoc`)
- Modify: `frontend/tests/unit/scene3d-config.unit.spec.ts`

**Interfaces:**
- Consumes: `sanitizeHierarchy` from Task 1.
- Produces: `GroupObject` interface, `createGroup(existing: SceneObject[]): GroupObject`, `parentId?: string` on `SceneObjectBase`. Tasks 3–9 all depend on these.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('scene3d config', ...)` block in `frontend/tests/unit/scene3d-config.unit.spec.ts`:

```ts
  it('round-trips a group and its child through serialize/parse', () => {
    const doc = defaultDoc()
    const group = createGroup(doc.objects)
    const child = createPrimitive('box', doc.objects)
    child.parentId = group.id
    doc.objects = [group, child]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects).toHaveLength(2)
    expect(back.objects[0]!.kind).toBe('group')
    expect(back.objects[1]!.parentId).toBe(group.id)
  })

  it('drops a parentId pointing at an object an older build deleted', () => {
    const doc = defaultDoc()
    const child = createPrimitive('box', doc.objects)
    child.parentId = 'a-group-that-is-gone'
    doc.objects = [child]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects).toHaveLength(1)
    expect(back.objects[0]!.parentId).toBeUndefined()
  })

  it('breaks a parentId cycle rather than preserving it', () => {
    const doc = defaultDoc()
    const a = createPrimitive('box', doc.objects)
    const b = createPrimitive('sphere', doc.objects)
    a.parentId = b.id
    b.parentId = a.id
    doc.objects = [a, b]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects.filter((o) => o.parentId)).toHaveLength(1)
  })

  it('a scene of groups never switches on the shader-field refresh', () => {
    const doc = defaultDoc()
    doc.objects = [createGroup(doc.objects)]
    expect(sceneHasShaderFill(doc)).toBe(false)
  })
```

Extend the import at the top of that file to include `createGroup` and `sceneHasShaderFill`:

```ts
  createLight, LIGHT_KINDS, LIGHT_DEFAULTS, lightIntensityDefault, lightIntensityMax,
  createGroup, sceneHasShaderFill,
  DEFAULT_FONT_URL,
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: FAIL — `createGroup` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/app/lib/scene3d/config.ts`, add `parentId` to `SceneObjectBase` (after `motion?`):

```ts
  motion?: ObjectMotion
  /** Parent object id; absent = top-level. Hierarchy is a REFERENCE over the
   *  flat `objects` array, never a nested children list — see hierarchy.ts.
   *  The engine turns this into a real three parent/child edge, so a parent's
   *  transform composes into this object's without any maths of our own. */
  parentId?: string
```

Add the group interface next to `LightObject` and widen the union:

```ts
/** A transform container with no geometry and no material of its own. Carries
 *  `material` from the base for type uniformity exactly as `LightObject` does —
 *  it is a dummy `DEFAULT_MATERIAL` that is never fed to a real THREE material,
 *  which is why `sceneHasShaderFill` skips groups alongside lights. */
export interface GroupObject extends SceneObjectBase {
  kind: 'group'
}

export type SceneObject = PrimitiveObject | GlbObject | LightObject | GroupObject
```

In `sceneHasShaderFill`, extend the light skip:

```ts
    if (o.kind === 'light' || o.kind === 'group') return false
```

Add the factory next to `createLight`:

```ts
export function createGroup(existing: SceneObject[]): GroupObject {
  return {
    id: newId(), name: numberedName('Group', existing), kind: 'group',
    visible: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL }, // dummy, never rendered — see GroupObject's doc
  }
}
```

Import the sanitizer at the top of `config.ts`:

```ts
import { sanitizeHierarchy } from './hierarchy'
```

In `parseDoc`, carry `parentId` through `common` (add after `material`):

```ts
          material: parseMaterial(o.material),
          ...(typeof o.parentId === 'string' ? { parentId: o.parentId } : {}),
```

Add the group branch inside the `flatMap`, before the final `return []`:

```ts
        if (o.kind === 'group') {
          return [{ ...common, kind: 'group' as const }]
        }
```

Immediately after the `objects` array is built (before `const doc: SceneDoc = {`), repair the graph:

```ts
    // Runs on the fully-parsed set so both invariants see every surviving
    // object: a group dropped by an older build leaves children pointing at a
    // dead id, and any input at all could carry a cycle.
    sanitizeHierarchy(objects)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: PASS, including the four new tests and every pre-existing one.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/config.ts frontend/tests/unit/scene3d-config.unit.spec.ts
git commit -m "feat(scene3d): GroupObject kind and parentId, with parser repair"
```

---

### Task 3: Group / ungroup transform maths

**Files:**
- Modify: `frontend/app/lib/scene3d/hierarchy.ts`
- Modify: `frontend/tests/unit/scene3d-hierarchy.unit.spec.ts`

**Interfaces:**
- Consumes: `SceneObject`, `GroupObject`, `Vec3` (types) from `config`; `descendantIds` from Task 1.
- Produces: `worldMatrixOf(objects, id): THREE.Matrix4`, `groupObjects(objects, ids, group): SceneObject[]`, `ungroupObject(objects, groupId): SceneObject[]`. Task 7 wires these to the UI.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/unit/scene3d-hierarchy.unit.spec.ts`:

```ts
import * as THREE from 'three'
import { worldMatrixOf, groupObjects, ungroupObject } from '~/lib/scene3d/hierarchy'
import { createGroup } from '~/lib/scene3d/config'

/** World-space position of `id`, derived independently of the code under test. */
function worldPos(objects: SceneObject[], id: string): [number, number, number] {
  const v = new THREE.Vector3().setFromMatrixPosition(worldMatrixOf(objects, id))
  return [v.x, v.y, v.z]
}

function expectClose(a: readonly number[], b: readonly number[]) {
  a.forEach((n, i) => expect(n).toBeCloseTo(b[i]!, 5))
}

describe('scene3d group/ungroup transforms', () => {
  it('composes a parent transform into a child world matrix', () => {
    const parent = obj('p'); parent.position = [1, 0, 0]
    const child = obj('c', 'p'); child.position = [0, 2, 0]
    expectClose(worldPos([parent, child], 'c'), [1, 2, 0])
  })

  it('preserves world position when grouping', () => {
    const a = obj('a'); a.position = [1, 0, 0]
    const b = obj('b'); b.position = [3, 0, 0]
    const before = [worldPos([a, b], 'a'), worldPos([a, b], 'b')]
    const group = createGroup([a, b])
    const after = groupObjects([a, b], ['a', 'b'], group)
    expect(after.find(o => o.id === 'a')!.parentId).toBe(group.id)
    expectClose(worldPos(after, 'a'), before[0]!)
    expectClose(worldPos(after, 'b'), before[1]!)
  })

  it('places the group at the selection bounds centre', () => {
    const a = obj('a'); a.position = [1, 0, 0]
    const b = obj('b'); b.position = [3, 0, 0]
    const group = createGroup([a, b])
    const after = groupObjects([a, b], ['a', 'b'], group)
    expectClose(after.find(o => o.id === group.id)!.position, [2, 0, 0])
  })

  // THE test this feature lives or dies on. Rebasing by subtraction passes every
  // assertion above and fails this one: a rotated parent means the child's local
  // offset is no longer its world offset.
  it('preserves world position when grouping under a ROTATED, SCALED ancestor', () => {
    const outer = obj('outer')
    outer.position = [5, 1, -2]
    outer.rotation = [0, Math.PI / 3, Math.PI / 7]
    outer.scale = [2, 0.5, 1.5]
    const a = obj('a', 'outer'); a.position = [1, 0, 0]
    const b = obj('b', 'outer'); b.position = [0, 3, 1]
    const objects = [outer, a, b]
    const before = [worldPos(objects, 'a'), worldPos(objects, 'b')]

    const group = createGroup(objects)
    group.parentId = 'outer'
    const after = groupObjects(objects, ['a', 'b'], group)

    expectClose(worldPos(after, 'a'), before[0]!)
    expectClose(worldPos(after, 'b'), before[1]!)
  })

  it('preserves world position when ungrouping under a rotated ancestor', () => {
    const outer = obj('outer')
    outer.position = [0, 2, 0]
    outer.rotation = [Math.PI / 5, Math.PI / 3, 0]
    outer.scale = [1.5, 1.5, 1.5]
    const group = createGroup([outer]) as SceneObject
    group.parentId = 'outer'
    group.position = [1, 0, 2]
    group.rotation = [0, Math.PI / 4, 0]
    const a = obj('a', group.id); a.position = [2, 0, 0]
    const objects = [outer, group, a]
    const before = worldPos(objects, 'a')

    const after = ungroupObject(objects, group.id)
    expect(after.find(o => o.id === group.id)).toBeUndefined()
    expect(after.find(o => o.id === 'a')!.parentId).toBe('outer')
    expectClose(worldPos(after, 'a'), before)
  })

  it('group then ungroup is an identity on world transforms', () => {
    const a = obj('a'); a.position = [1, 2, 3]; a.rotation = [0.3, 0.4, 0.5]; a.scale = [1, 2, 3]
    const b = obj('b'); b.position = [-4, 0, 1]
    const before = [worldPos([a, b], 'a'), worldPos([a, b], 'b')]
    const group = createGroup([a, b])
    const grouped = groupObjects([a, b], ['a', 'b'], group)
    const back = ungroupObject(grouped, group.id)
    expectClose(worldPos(back, 'a'), before[0]!)
    expectClose(worldPos(back, 'b'), before[1]!)
  })

  it('refuses to group an object into its own descendant', () => {
    const g = createGroup([]) as SceneObject
    const child = obj('child', g.id)
    const inner = createGroup([g, child])
    inner.parentId = 'child'
    const after = groupObjects([g, child, inner], [g.id], inner)
    // The illegal reparent is skipped, leaving the graph acyclic.
    expect(after.find(o => o.id === g.id)!.parentId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-hierarchy.unit.spec.ts`
Expected: FAIL — `worldMatrixOf` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/app/lib/scene3d/hierarchy.ts`:

```ts
import * as THREE from 'three'
import type { GroupObject, Vec3 } from './config'

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/** Local TRS of one object as a matrix. Euler order matches SceneObjectBase's
 *  documented XYZ. */
function localMatrixOf(o: SceneObject): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...o.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.rotation, 'XYZ')),
    new THREE.Vector3(...o.scale),
  )
}

/** World matrix of `id`, composed by walking the parentId chain from the root
 *  down. Derived from the DOC rather than the engine's live roots so that
 *  grouping stays a pure function of data — which is what makes the
 *  world-transform invariants testable without a WebGL context.
 *  An unknown id, or a chain broken by a missing parent, yields identity. */
export function worldMatrixOf(objects: readonly SceneObject[], id: string): THREE.Matrix4 {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const chain: SceneObject[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  const out = new THREE.Matrix4()
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(localMatrixOf(chain[i]!))
  return out
}

/** Decompose a world matrix into the local TRS that reproduces it under
 *  `parentWorld`. This — not subtraction — is what keeps a child in place when
 *  the new parent is rotated or non-uniformly scaled. */
function rebase(childWorld: THREE.Matrix4, parentWorld: THREE.Matrix4): {
  position: Vec3; rotation: Vec3; scale: Vec3
} {
  _m.copy(parentWorld).invert().multiply(childWorld)
  _m.decompose(_p, _q, _s)
  _e.setFromQuaternion(_q, 'XYZ')
  return {
    position: [_p.x, _p.y, _p.z],
    rotation: [_e.x, _e.y, _e.z],
    scale: [_s.x, _s.y, _s.z],
  }
}

/** True when `candidateParentId` is `id` itself or sits inside `id`'s subtree —
 *  the reparent that would create a cycle. */
function wouldCycle(objects: readonly SceneObject[], id: string, candidateParentId?: string): boolean {
  if (!candidateParentId) return false
  if (candidateParentId === id) return true
  return descendantIds(objects, id).includes(candidateParentId)
}

/** Reparent `ids` under `group`, preserving every world transform, and return a
 *  NEW objects array with `group` inserted. `group.parentId` (set by the caller,
 *  normally to the primary selection's parent) decides where the group itself
 *  lands, so grouping inside an existing group nests rather than escaping.
 *
 *  The group is positioned at the world bounds centre of the selection —
 *  measured from object ORIGINS, not geometry bounds, since this module has no
 *  access to meshes. That is the pivot the gizmo will sit on.
 *
 *  An id whose reparent would create a cycle is skipped rather than applied. */
export function groupObjects(
  objects: readonly SceneObject[],
  ids: readonly string[],
  group: GroupObject,
): SceneObject[] {
  const members = ids.filter((id) => objects.some((o) => o.id === id) && !wouldCycle(objects, id, group.parentId))
  if (!members.length) return [...objects]

  // Bounds centre of the members' world origins.
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (const id of members) {
    _p.setFromMatrixPosition(worldMatrixOf(objects, id))
    min.min(_p); max.max(_p)
  }
  const centre = min.clone().add(max).multiplyScalar(0.5)

  // The group's own LOCAL transform: identity rotation/scale at `centre`,
  // expressed under whatever parent it is being placed in.
  const groupParentWorld = group.parentId ? worldMatrixOf(objects, group.parentId) : new THREE.Matrix4()
  const groupWorld = new THREE.Matrix4().setPosition(centre)
  const placed: GroupObject = { ...group, ...rebase(groupWorld, groupParentWorld) }

  // Children rebased against the group's WORLD matrix (not its local one).
  const memberSet = new Set(members)
  const next = objects.map((o) => {
    if (!memberSet.has(o.id)) return o
    const world = worldMatrixOf(objects, o.id)
    return { ...o, parentId: placed.id, ...rebase(world, groupWorld) }
  })
  return [...next, placed]
}

/** Dissolve `groupId`: its children move to the group's own parent with world
 *  transforms preserved, and the group object is removed. A non-group id, or an
 *  unknown one, returns the array unchanged. */
export function ungroupObject(objects: readonly SceneObject[], groupId: string): SceneObject[] {
  const group = objects.find((o) => o.id === groupId)
  if (!group || group.kind !== 'group') return [...objects]
  const newParentId = group.parentId
  const newParentWorld = newParentId ? worldMatrixOf(objects, newParentId) : new THREE.Matrix4()
  const childIds = new Set(childrenOf(objects, groupId).map((o) => o.id))
  return objects
    .filter((o) => o.id !== groupId)
    .map((o) => {
      if (!childIds.has(o.id)) return o
      const world = worldMatrixOf(objects, o.id)
      const rebased = { ...o, ...rebase(world, newParentWorld) }
      if (newParentId) rebased.parentId = newParentId
      else delete rebased.parentId
      return rebased
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-hierarchy.unit.spec.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Prove the test can fail (the broken control)**

Temporarily replace the body of `rebase` with naive subtraction:

```ts
  _p.setFromMatrixPosition(childWorld)
  const pp = new THREE.Vector3().setFromMatrixPosition(parentWorld)
  _p.sub(pp)
  return { position: [_p.x, _p.y, _p.z], rotation: [0, 0, 0], scale: [1, 1, 1] }
```

Run: `cd frontend && npx vitest run tests/unit/scene3d-hierarchy.unit.spec.ts`
Expected: FAIL on "preserves world position when grouping under a ROTATED, SCALED ancestor" and on the ungroup-under-rotation test, while the axis-aligned tests still pass. **If those tests pass with subtraction, they are not testing what they claim — fix them before restoring.** Then restore the real `rebase`, re-run, and confirm PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/hierarchy.ts frontend/tests/unit/scene3d-hierarchy.unit.spec.ts
git commit -m "feat(scene3d): group/ungroup with world-transform-preserving rebase"
```

---

### Task 4: Engine hierarchy

**Files:**
- Modify: `frontend/app/lib/scene3d/engine.ts` (`syncFromDoc`, `syncObject`, `baseSizeOf`, `dispose`)

**Interfaces:**
- Consumes: `orderParentsFirst` from Task 1, `GroupObject` from Task 2.
- Produces: engine renders `parentId` as a real three parent/child edge. No new exports.

- [ ] **Step 1: Add the import and the parents-first sync order**

At the top of `engine.ts`, add:

```ts
import { orderParentsFirst } from './hierarchy'
```

In `syncFromDoc`, replace:

```ts
    for (const obj of doc.objects) this.syncObject(obj)
```

with:

```ts
    // Parents first: a child's root cannot be added to a parent root that has
    // not been created yet. orderParentsFirst is stable, so same-level ordering
    // is untouched.
    for (const obj of orderParentsFirst(doc.objects)) this.syncObject(obj)
```

- [ ] **Step 2: Make teardown safe for hierarchies**

In `syncFromDoc`, replace the removal loop:

```ts
    const live = new Set(doc.objects.map((o) => o.id))
    for (const [id, root] of this.objectRoots) {
      if (!live.has(id)) {
        this.scene.remove(root)
        disposeTree(root)
        this.objectRoots.delete(id)
        this.glbTokens.delete(id)
        this.fontTokens.delete(id)
      }
    }
```

with:

```ts
    const live = new Set(doc.objects.map((o) => o.id))
    for (const [id, root] of this.objectRoots) {
      if (live.has(id)) continue
      // A dead GROUP root may still contain the roots of children that are very
      // much alive (ungroup removes the group and reparents in one doc edit).
      // disposeTree traverses, so letting it run here would free geometry and
      // textures still referenced by objectRoots — a blank viewport with no
      // error. Detach every surviving child first; the sync pass below
      // re-parents each one wherever its new parentId says it belongs.
      for (const child of [...root.children]) {
        const cid = child.userData.sceneId as string | undefined
        if (cid && live.has(cid)) this.scene.add(child)
      }
      root.removeFromParent() // NOT scene.remove — the root may be parented to another root
      disposeTree(root)
      this.objectRoots.delete(id)
      this.glbTokens.delete(id)
      this.fontTokens.delete(id)
    }
```

- [ ] **Step 3: Parent-aware attach, every sync**

In `syncObject`, extend the `sourceKey` computation to cover groups:

```ts
    const sourceKey = obj.kind === 'primitive' ? `primitive:${obj.primitive}`
      : obj.kind === 'glb' ? `glb:${obj.url}`
      : obj.kind === 'group' ? 'group'
      : `light:${obj.light}`
```

In the `if (!root) { ... }` construction chain, add a group branch before the light `else` (a group is an empty transform node — no geometry, no light, no marker):

```ts
      } else if (obj.kind === 'group') {
        root = new THREE.Group()
      } else {
```

Replace the creation-time `this.scene.add(root)` with just the bookkeeping:

```ts
      root.userData.sceneId = obj.id
      root.userData.sourceKey = sourceKey
      this.objectRoots.set(obj.id, root)
    }
    // Re-parent on EVERY sync, not just creation: group/ungroup changes
    // parentId without changing sourceKey, so a creation-only attach would
    // leave the root under its old parent. Object3D.add removes from the
    // previous parent, so this is a no-op when nothing moved.
    const parentRoot = obj.parentId ? this.objectRoots.get(obj.parentId) : undefined
    const desiredParent = parentRoot ?? this.scene
    if (root.parent !== desiredParent) desiredParent.add(root)
```

- [ ] **Step 4: Fix `baseSizeOf` for nested objects**

In `baseSizeOf`, replace the local-scale divisor with the world one — `Box3.setFromObject` measures in WORLD space, so a nested object was previously divided by only part of its scale chain:

```ts
  baseSizeOf(id: string): [number, number, number] | null {
    const root = this.objectRoots.get(id)
    if (!root) return null
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) return null
    // setFromObject measures in WORLD space, so the divisor must be the world
    // scale too. These were identical while every object was top-level; a
    // nested object's ancestors contribute scale the local vector does not see.
    const s = root.getWorldScale(new THREE.Vector3())
    return [
      (box.max.x - box.min.x) / (s.x || 1),
      (box.max.y - box.min.y) / (s.y || 1),
      (box.max.z - box.min.z) / (s.z || 1),
    ]
  }
```

- [ ] **Step 5: Flatten before whole-engine disposal**

In `dispose()`, replace:

```ts
    for (const root of this.objectRoots.values()) disposeTree(root)
```

with:

```ts
    // Flatten first: nested roots would otherwise be disposed twice — once via
    // their parent's traverse, once directly.
    for (const root of this.objectRoots.values()) this.scene.add(root)
    for (const root of this.objectRoots.values()) disposeTree(root)
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | tail -5`
Expected: the project's known baseline error count (~328 per the repo's standing baseline), with **no new errors naming `engine.ts`, `hierarchy.ts`, or `config.ts`**. Compare against `git stash`-free baseline by grepping: `npx vue-tsc --noEmit 2>&1 | grep -c "scene3d"` should be 0.

- [ ] **Step 7: Run the full unit suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — no regression in the pre-existing scene3d specs.

- [ ] **Step 8: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/engine.ts
git commit -m "feat(scene3d): engine renders parentId as a real scene-graph edge"
```

---

### Task 5: Multi-select state

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: nothing new.
- Produces: `selectedIds: Ref<string[]>` and a `selectedId` computed (get = last entry, set = replace selection). Tasks 6, 7 and 9 read `selectedIds`.

- [ ] **Step 1: Replace the selection ref**

Replace line 78's `const selectedId = ref<string | null>(null)` with:

```ts
// Selection is an ORDERED list; the LAST entry is the primary (the anchor the
// properties panel titles itself after, and the object a single-selection gizmo
// attaches to). `selectedId` stays available as a computed so the dozen
// existing single-selection readers keep working unchanged — but note it is
// WRITABLE, and writing it REPLACES the selection. Any code that needs to add
// to the selection must go through `toggleSelected`.
const selectedIds = ref<string[]>([])
const selectedId = computed<string | null>({
  get: () => selectedIds.value[selectedIds.value.length - 1] ?? null,
  set: (id) => { selectedIds.value = id ? [id] : [] },
})
const selectedObjects = computed<SceneObject[]>(() =>
  selectedIds.value
    .map((id) => doc.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o))

function toggleSelected(id: string, additive: boolean): void {
  if (!additive) { selectedIds.value = [id]; return }
  const i = selectedIds.value.indexOf(id)
  // Re-selecting an already-selected object promotes it to primary rather than
  // deselecting it when it is the only member — deselecting the last object via
  // a modifier-click is a dead end the user has to undo with another click.
  if (i < 0) selectedIds.value = [...selectedIds.value, id]
  else if (selectedIds.value.length > 1) selectedIds.value = selectedIds.value.filter((x) => x !== id)
}
```

Ensure `SceneObject` is in the `~/lib/scene3d/config` type import at the top of the file if it is not already.

- [ ] **Step 2: Prune dead ids from the selection**

Find the existing prune at line ~1232 (`if (selectedId.value && !doc.objects.some(...)) selectedId.value = null`) and replace it with:

```ts
  selectedIds.value = selectedIds.value.filter((id) => doc.objects.some((o) => o.id === id))
```

- [ ] **Step 3: Make viewport clicks additive-aware**

In `onMounted`, replace the `onSelect` callback:

```ts
    onSelect: (id, additive) => {
      if (!id) { selectedIds.value = []; return }
      toggleSelected(id, additive)
    },
```

- [ ] **Step 4: Make list clicks additive-aware**

In the object-list `v-for` row, replace `@click="selectedId = o.id"` with:

```
@click="toggleSelected(o.id, $event.shiftKey || $event.metaKey || $event.ctrlKey)"
```

and replace the row's selected class test `o.id === selectedId` with:

```
selectedIds.includes(o.id) ? 'bg-white/15' : 'hover:bg-white/5'
```

- [ ] **Step 5: Typecheck and run the app**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep "Scene3DStudioSurface" | head`
Expected: no new errors. `onSelect`'s second parameter lands in Task 6 — if the callback type still declares one argument, this step's typecheck will flag it; add the optional parameter to the `SceneInteraction` callback type now:

```ts
  onSelect: (id: string | null, additive: boolean) => void
```

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/app/lib/scene3d/interaction.ts
git commit -m "feat(scene3d): ordered multi-selection state"
```

---

### Task 6: Multi-select gizmo

**Files:**
- Modify: `frontend/app/lib/scene3d/interaction.ts`
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: `selectedIds` from Task 5.
- Produces: `SceneInteraction.selectMany(ids: string[], isLight?: boolean)`, and an `onTransformMany(entries)` callback so the surface can write several objects from one drag.

- [ ] **Step 1: Emit the modifier from the raycast click**

In `interaction.ts`'s `onUp`, replace the final two lines:

```ts
    this.select(id)
    this.callbacks.onSelect(id)
```

with:

```ts
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    this.callbacks.onSelect(id, additive)
```

(The surface now owns selection state and calls back into `selectMany`, so `select` is no longer driven from here — this removes a double source of truth.)

- [ ] **Step 2: Add the pivot and multi-attach**

Add fields to `SceneInteraction`:

```ts
  private selectedIds: string[] = []
  /** Transient parent used to drive a MULTI-selection with a single gizmo.
   *  TransformControls attaches to exactly one Object3D, so a multi-drag
   *  re-parents every selected root under this pivot for the duration of the
   *  drag. Object3D.attach preserves world transform on the way in AND out,
   *  which is why no delta maths is needed. Never added to doc.objects. */
  private pivot: THREE.Object3D | null = null
```

Add the multi-selection entry point:

```ts
  /** Attach the gizmo to `ids`. One id behaves exactly as before. Several ids
   *  build a pivot at the bounds centre of their roots and attach that. */
  selectMany(ids: string[], isLight = false): void {
    this.selectedIds = [...ids]
    this.teardownPivot()
    if (ids.length <= 1) { this.select(ids[0] ?? null, isLight); return }
    const roots = ids
      .map((id) => this.engine.objectRoots.get(id))
      .filter((r): r is THREE.Object3D => !!r)
    if (roots.length < 2) { this.select(ids[0] ?? null, isLight); return }
    const box = new THREE.Box3()
    for (const r of roots) box.expandByPoint(r.getWorldPosition(new THREE.Vector3()))
    const pivot = new THREE.Object3D()
    pivot.position.copy(box.getCenter(new THREE.Vector3()))
    pivot.userData.isGizmoHelper = true // keep it out of every baked pass
    this.engine.scene.add(pivot)
    pivot.updateMatrixWorld(true)
    // attach (not add) preserves each root's world transform under the pivot.
    for (const r of roots) pivot.attach(r)
    this.pivot = pivot
    for (const tc of this.gizmos) tc.attach(pivot)
  }

  /** Return pivot children to the scene (world transforms preserved) and drop
   *  it. The engine's next syncFromDoc re-parents each root to its real parent.
   *  Called before any re-attach and on dispose — a leaked pivot would keep
   *  owning roots the engine believes it parents itself. */
  private teardownPivot(): void {
    const pivot = this.pivot
    if (!pivot) return
    for (const child of [...pivot.children]) this.engine.scene.attach(child)
    pivot.removeFromParent()
    this.pivot = null
  }
```

Call `this.teardownPivot()` at the top of `dispose()`.

- [ ] **Step 3: Emit transforms for every member**

Add the callback to the callbacks interface:

```ts
  /** Fired instead of onTransform when a multi-selection drag moves several
   *  objects at once. Each entry is the object's new LOCAL transform. */
  onTransformMany?: (entries: { id: string; t: TransformSnapshot }[]) => void
```

Replace `emitTransform`:

```ts
  private emitTransform(): void {
    if (this.pivot) {
      // Local transforms under the pivot are meaningless to the doc; read each
      // root's WORLD transform and let the surface rebase it. Decompose rather
      // than reading .position/.rotation directly — those are pivot-relative
      // while the drag is live.
      const entries: { id: string; t: TransformSnapshot }[] = []
      for (const id of this.selectedIds) {
        const root = this.engine.objectRoots.get(id)
        if (!root) continue
        root.updateMatrixWorld(true)
        const p = new THREE.Vector3()
        const q = new THREE.Quaternion()
        const s = new THREE.Vector3()
        root.matrixWorld.decompose(p, q, s)
        const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
        entries.push({
          id,
          t: { position: [p.x, p.y, p.z], rotation: [e.x, e.y, e.z], scale: [s.x, s.y, s.z] },
        })
      }
      this.callbacks.onTransformMany?.(entries)
      return
    }
    if (!this.selectedIds.length) return
    const id = this.selectedIds[this.selectedIds.length - 1]!
    const root = this.engine.objectRoots.get(id)
    if (!root) return
    this.callbacks.onTransform(id, {
      position: root.position.toArray() as Vec3,
      rotation: [root.rotation.x, root.rotation.y, root.rotation.z],
      scale: root.scale.toArray() as Vec3,
    })
  }
```

Keep `select()` as-is but have it also set `this.selectedIds = id ? [id] : []`.

- [ ] **Step 4: Wire the surface**

Replace the surface's `watch(selectedId, ...)` gizmo attach (line ~1183) with a watch on `selectedIds`:

```ts
watch(selectedIds, (ids) => {
  const primary = ids.length === 1 ? doc.objects.find((o) => o.id === ids[0]) : null
  interaction?.selectMany([...ids], primary?.kind === 'light')
  engine?.setSelected(ids[ids.length - 1] ?? null)
}, { deep: true })
```

Add the multi-transform handler beside `onTransform` in `onMounted`:

```ts
    onTransformMany: (entries) => {
      // Entries are WORLD transforms; rebase each into its own parent's frame
      // before writing, since the doc stores local TRS.
      for (const { id, t } of entries) {
        const o = doc.objects.find((x) => x.id === id)
        if (!o) continue
        if (!o.parentId) { o.position = t.position; o.rotation = t.rotation; o.scale = t.scale; continue }
        const parentWorld = worldMatrixOf(doc.objects, o.parentId)
        const world = new THREE.Matrix4().compose(
          new THREE.Vector3(...t.position),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation, 'XYZ')),
          new THREE.Vector3(...t.scale),
        )
        const local = new THREE.Matrix4().copy(parentWorld).invert().multiply(world)
        const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3()
        local.decompose(p, q, s)
        const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
        o.position = [p.x, p.y, p.z]
        o.rotation = [e.x, e.y, e.z]
        o.scale = [s.x, s.y, s.z]
      }
    },
```

Add the imports the surface now needs:

```ts
import * as THREE from 'three'
import { worldMatrixOf } from '~/lib/scene3d/hierarchy'
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "interaction.ts|Scene3DStudioSurface" | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/interaction.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): pivot-based gizmo for multi-selection drags"
```

---

### Task 7: Group and ungroup actions

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: `groupObjects`, `ungroupObject` (Task 3), `createGroup` (Task 2), `selectedIds` (Task 5).
- Produces: `groupSelection()`, `ungroupSelection()` bound to Cmd/Ctrl+G and Cmd/Ctrl+Shift+G.

- [ ] **Step 1: Add the actions**

Beside the other object operations (near `addPrimitive`):

```ts
// ── Grouping ──────────────────────────────────────────────────────────────────
/** Wrap the selection in a new group. The group is parented wherever the
 *  PRIMARY selection lives, so grouping inside an existing group nests rather
 *  than escaping to the root. */
function groupSelection() {
  const ids = selectedIds.value
  if (ids.length < 2) return
  const primary = doc.objects.find((o) => o.id === ids[ids.length - 1]!)
  const group = createGroup(doc.objects)
  if (primary?.parentId) group.parentId = primary.parentId
  doc.objects = groupObjects(doc.objects, ids, group)
  selectedIds.value = [group.id]
}

/** Dissolve every selected group, freeing its children in place. */
function ungroupSelection() {
  const groupIds = selectedObjects.value.filter((o) => o.kind === 'group').map((o) => o.id)
  if (!groupIds.length) return
  const freed: string[] = []
  for (const id of groupIds) {
    freed.push(...childrenOf(doc.objects, id).map((o) => o.id))
    doc.objects = ungroupObject(doc.objects, id)
  }
  selectedIds.value = freed
}
```

Add the imports:

```ts
import { createGroup, /* ...existing config imports */ } from '~/lib/scene3d/config'
import { groupObjects, ungroupObject, childrenOf, descendantIds, worldMatrixOf } from '~/lib/scene3d/hierarchy'
```

- [ ] **Step 2: Bind the shortcuts**

In the keydown handler, before the `Escape` branch:

```ts
  if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.shiftKey) ungroupSelection()
    else groupSelection()
    return
  }
```

- [ ] **Step 3: Add toolbar buttons**

In the Objects aside, above the object list, add a row that appears only when an action is available:

```html
<div v-if="canGroup || canUngroup" class="flex shrink-0 gap-1 px-2 pb-2">
  <StudioButton v-if="canGroup" @click="groupSelection">
    <span class="flex items-center gap-1.5"><Group class="h-3.5 w-3.5" /> Group</span>
  </StudioButton>
  <StudioButton v-if="canUngroup" @click="ungroupSelection">
    <span class="flex items-center gap-1.5"><Ungroup class="h-3.5 w-3.5" /> Ungroup</span>
  </StudioButton>
</div>
```

with the computeds and lucide imports:

```ts
const canGroup = computed(() => selectedIds.value.length >= 2)
const canUngroup = computed(() => selectedObjects.value.some((o) => o.kind === 'group'))
```

```ts
import { Group, Ungroup } from 'lucide-vue-next'
```

- [ ] **Step 4: Verify in the running app**

Start the dev server per the repo's launcher (`./dev.sh` from the repo root — it reaps orphaned servers and takes over ports 3000 + 8188), open a 3D Studio node, add two primitives, shift-click both in the object list, press Cmd+G. Expected: one "Group" row appears, both primitives keep their on-screen positions, and dragging the gizmo moves both.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): group and ungroup actions with Cmd+G shortcuts"
```

---

### Task 8: Object list tree

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/Scene3DObjectRow.vue`
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: `childrenOf` (Task 1), `selectedIds`, `toggleSelected` (Task 5).
- Produces: a recursive row component. Extracted rather than inlined because the existing row markup is already eight lines inside a 2565-line file, and recursion needs a named component anyway.

- [ ] **Step 1: Create the recursive row**

```vue
<script setup lang="ts">
// One object-list row plus its subtree. Recursive (`Scene3DObjectRow` refers to
// itself by name), which is why this is a real component rather than more
// markup inside the surface.
import { computed, ref } from 'vue'
import { Box, Lightbulb, Folder, ChevronRight, ChevronDown, Eye, EyeOff, Copy, Trash2, RotateCcw } from 'lucide-vue-next'
import type { SceneObject } from '~/lib/scene3d/config'
import { childrenOf } from '~/lib/scene3d/hierarchy'

const props = defineProps<{
  object: SceneObject
  objects: SceneObject[]
  selectedIds: string[]
  glbError: Record<string, boolean>
  depth: number
}>()
const emit = defineEmits<{
  select: [id: string, additive: boolean]
  remove: [id: string]
  duplicate: [id: string]
  retry: [id: string]
  toggleVisible: [id: string]
}>()

const children = computed(() => childrenOf(props.objects, props.object.id))
// Expand state is LOCAL UI state on purpose: persisting it would dirty the
// document on a disclosure click and sync a cosmetic toggle across windows.
const expanded = ref(true)
const icon = computed(() =>
  props.object.kind === 'light' ? Lightbulb : props.object.kind === 'group' ? Folder : Box)
</script>

<template>
  <div>
    <div class="group flex items-center gap-2 rounded px-2 py-1 text-xs"
      :class="selectedIds.includes(object.id) ? 'bg-white/15' : 'hover:bg-white/5'"
      :style="{ paddingLeft: `${8 + depth * 12}px` }"
      @click="emit('select', object.id, $event.shiftKey || $event.metaKey || $event.ctrlKey)">
      <button v-if="children.length" type="button" class="-ml-1 shrink-0 opacity-60 hover:opacity-100"
        @click.stop="expanded = !expanded">
        <component :is="expanded ? ChevronDown : ChevronRight" class="h-3 w-3" />
      </button>
      <span v-else class="w-2 shrink-0" />
      <component :is="icon" class="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span class="flex-1 truncate" :class="glbError[object.id] ? 'text-red-400' : ''">{{ object.name }}</span>
      <span v-if="children.length" class="shrink-0 text-[10px] tabular-nums opacity-40">{{ children.length }}</span>
      <button v-if="glbError[object.id]" type="button" class="text-red-400 opacity-90 hover:opacity-100"
        title="Load failed — retry" @click.stop="emit('retry', object.id)"><RotateCcw class="h-3.5 w-3.5" /></button>
      <button type="button" class="opacity-0 group-hover:opacity-70" @click.stop="emit('toggleVisible', object.id)">
        <component :is="object.visible ? Eye : EyeOff" class="h-3.5 w-3.5" />
      </button>
      <button type="button" class="opacity-0 group-hover:opacity-70" @click.stop="emit('duplicate', object.id)"><Copy class="h-3.5 w-3.5" /></button>
      <button type="button" class="opacity-0 group-hover:opacity-70" @click.stop="emit('remove', object.id)"><Trash2 class="h-3.5 w-3.5" /></button>
    </div>
    <template v-if="expanded">
      <Scene3DObjectRow v-for="c in children" :key="c.id"
        :object="c" :objects="objects" :selected-ids="selectedIds" :glb-error="glbError" :depth="depth + 1"
        @select="(id, additive) => emit('select', id, additive)"
        @remove="(id) => emit('remove', id)"
        @duplicate="(id) => emit('duplicate', id)"
        @retry="(id) => emit('retry', id)"
        @toggle-visible="(id) => emit('toggleVisible', id)" />
    </template>
  </div>
</template>
```

- [ ] **Step 2: Use it from the surface**

Replace the object-list `v-for` block with:

```html
<Scene3DObjectRow v-for="o in rootObjectList" :key="o.id"
  :object="o" :objects="doc.objects" :selected-ids="selectedIds" :glb-error="glbError" :depth="0"
  @select="toggleSelected"
  @remove="removeObject"
  @duplicate="duplicateObject"
  @retry="retryGlb"
  @toggle-visible="(id) => { const o = doc.objects.find(x => x.id === id); if (o) o.visible = !o.visible }" />
```

with:

```ts
import Scene3DObjectRow from './studio/Scene3DObjectRow.vue'
import { rootObjects } from '~/lib/scene3d/hierarchy'
const rootObjectList = computed(() => rootObjects(doc.objects))
```

- [ ] **Step 3: Verify in the running app**

Group two primitives, confirm the list shows a "Group" row with a chevron, a child count of 2, and both children indented beneath it. Collapse and expand. Confirm the group's eye toggle hides both children.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/studio/Scene3DObjectRow.vue frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): recursive object list tree"
```

---

### Task 9: Subtree cascades and Escape step-up

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: `descendantIds` (Task 1), `selectedIds` (Task 5).
- Produces: no new exports; corrects delete, duplicate, Backspace and Escape for hierarchies.

- [ ] **Step 1: Delete the subtree**

Replace `removeObject`:

```ts
function removeObject(id: string) {
  // A group's children are independent doc objects; deleting only the group
  // would leave them orphaned at the root — visually "escaping" the delete.
  const doomed = new Set([id, ...descendantIds(doc.objects, id)])
  doc.objects = doc.objects.filter((o) => !doomed.has(o.id))
  selectedIds.value = selectedIds.value.filter((x) => !doomed.has(x))
  for (const gone of doomed) delete glbError[gone]
}
```

- [ ] **Step 2: Backspace deletes every selected object**

Replace the Backspace branch in the keydown handler:

```ts
  else if (e.key === 'Backspace' && selectedIds.value.length) {
    for (const id of [...selectedIds.value]) removeObject(id)
  }
```

- [ ] **Step 3: Duplicate the subtree**

Extend `duplicateObject` so a group copies its descendants and re-points the copies' `parentId` at the copied ancestors. Add, after the existing single-object clone produces `copy`:

```ts
  // A group with no children copied is an empty box; copy the whole subtree and
  // rewrite parent links so the copy is self-contained rather than pointing
  // back into the original's children.
  const kids = descendantIds(doc.objects, id)
  if (kids.length) {
    const idMap = new Map<string, string>([[id, copy.id]])
    const clones: SceneObject[] = []
    for (const kid of kids) {
      const src = doc.objects.find((o) => o.id === kid)
      if (!src) continue
      const clone = cloneObject(src) // the same deep-clone helper duplicateObject already uses
      idMap.set(kid, clone.id)
      clones.push(clone)
    }
    for (const clone of clones) {
      const mapped = clone.parentId ? idMap.get(clone.parentId) : undefined
      if (mapped) clone.parentId = mapped
    }
    doc.objects.push(...clones)
  }
```

If `duplicateObject` does not already factor its deep-clone into a reusable `cloneObject(src)` helper, extract one first — the existing body already deep-clones `material`, `params` and `modifiers`, and that logic must not be duplicated (note the shallow-copy bug the existing comment at line ~1324 documents: `material.relief` and `material.shader` are nested and need real copies).

- [ ] **Step 4: Escape steps up to the parent**

In the Escape branch, before the existing deselect:

```ts
    const primary = selectedId.value ? doc.objects.find((o) => o.id === selectedId.value) : null
    if (primary?.parentId) {
      // Step up to the containing group rather than clearing — the only
      // traversal in the model, and the way a group gets selected from the
      // viewport (clicking always picks the child).
      e.preventDefault()
      e.stopImmediatePropagation()
      selectedIds.value = [primary.parentId]
      return
    }
```

- [ ] **Step 5: Apply material edits across the selection**

Find where the material panel writes to `selected.value.material` and route those writes through a helper that fans out:

```ts
/** Material edits apply to EVERY selected object — this is what makes "select
 *  the logo's paths, pick gold" one action instead of twelve. Each object keeps
 *  its own material afterward, so a single path can still be tweaked alone. */
function applyMaterial(mutate: (m: SceneMaterial) => void) {
  for (const o of selectedObjects.value) {
    if (o.kind === 'light' || o.kind === 'group') continue
    mutate(o.material)
  }
}
```

Wire the existing material controls' setters through `applyMaterial` rather than writing `selected.value.material` directly.

- [ ] **Step 6: Verify in the running app**

Group two primitives, duplicate the group, confirm the copy has its own two children and moving the copy leaves the original alone. Select a child, press Escape, confirm the group becomes selected. Select both children, change the material colour, confirm both change.

- [ ] **Step 7: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): subtree delete/duplicate, Escape step-up, multi-object material edits"
```

---

### Task 10: End-to-end coverage

**Files:**
- Create: `frontend/tests/scene3d-grouping.spec.ts`

**Interfaces:**
- Consumes: the whole feature.
- Produces: browser proof that grouping survives a real render loop.

- [ ] **Step 1: Write the test**

Model the setup on `frontend/tests/shader-fill.spec.ts` — in particular its local `openBlankWorkflow`, which deliberately does **not** wait for `networkidle` (the app polls `/system_stats` continuously against the live backend, so `networkidle` never fires).

```ts
import { test, expect } from '@playwright/test'

/**
 * Grouping — end-to-end.
 *
 * The assertion that matters is the world-transform invariant: group, move the
 * group, ungroup, and every child must be exactly where the screen showed it.
 * A viewport that merely LOOKS right is not evidence — grouping fails silently
 * in exactly the way a screenshot cannot catch, so this reads doc state.
 */
test('group, transform, and ungroup preserve world positions', async ({ page }) => {
  // ...open a blank workflow and a 3D Studio node (see shader-fill.spec.ts)

  // Add two primitives, select both, group them.
  // Read each child's world position from the doc via the studio's own state.
  // Move the group by a known delta.
  // Ungroup.
  // Assert each child's world position equals its pre-ungroup world position.
})
```

Fill in the body using the studio's exposed test hooks; if none exist, drive the UI directly (add-menu clicks, shift-click in the object list, `Meta+g`) and read state through `page.evaluate` against the doc the surface holds.

- [ ] **Step 2: Run it**

Run: `cd frontend && npx playwright test tests/scene3d-grouping.spec.ts --reporter=line`
Expected: PASS.

- [ ] **Step 3: Prove it can fail**

Temporarily make `ungroupObject` skip its rebase (return children with `parentId` cleared but transforms untouched). Re-run. Expected: FAIL on the world-position assertion. Restore and re-run to PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/tests/scene3d-grouping.spec.ts
git commit -m "test(scene3d): E2E world-transform invariant for grouping"
```

---

## Self-Review

**Spec coverage.** Data model → Task 2. Parser invariants → Tasks 1–2. Engine parent edge, sync order, teardown, `sourceKey`, `sceneHasShaderFill` → Tasks 2 and 4. Size measurement → Task 4 (`getWorldScale` fix; the spec's corrected note says no other work is needed). Selection outlines → no task, deliberately: the spec's correction establishes there is no selection-outline system. Multi-select → Task 5. Gizmo pivot → Task 6. Group/ungroup + rebasing → Tasks 3 and 7. Object list tree → Task 8. Cascades and Escape → Task 9. Testing → Tasks 1, 2, 3, 9, 10.

**Known gap, deliberate.** The spec says a group's visibility toggle and delete "cascade for free". Visibility genuinely does (three hides subtrees); delete does not, and Task 9 Step 1 implements it. The plan is correct and the spec's phrasing was loose.

**Type consistency.** `selectedIds` is `string[]` throughout. `toggleSelected(id, additive)` has the same signature in Tasks 5, 8 and 9. `onSelect(id, additive)` matches between `interaction.ts` and the surface. `groupObjects(objects, ids, group)` and `ungroupObject(objects, groupId)` return `SceneObject[]` and are called that way in Task 7. `childrenOf`/`descendantIds`/`rootObjects`/`orderParentsFirst`/`sanitizeHierarchy` keep one signature each across Tasks 1, 4, 7, 8, 9.

**Risk carried into execution.** Task 6 is the only task whose correctness cannot be settled by a unit test — the pivot attach/detach interacts with `TransformControls` internals and three's matrix bookkeeping. Verify it by hand in the running app before moving on, and watch specifically for a first-frame pop on drag start.
