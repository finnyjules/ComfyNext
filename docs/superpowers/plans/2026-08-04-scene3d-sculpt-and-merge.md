# Scene3D Sculpt and Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the 3D Studio mold a shape by hand like clay, and merge shapes into one.

**Architecture:** One new `PrimitiveKind` — `'mesh'` — carries stored vertices in `PrimitiveContent`, so both features share a single insertion point in `geometryFor` and inherit modifiers, materials, motion, passes, rebake and export unchanged. A voxel module (mesh → signed distance grid → surface nets) powers Remesh, Merge, and brush ray-picking. A sculpt session owns a mutable working buffer that only writes back to the doc on commit.

**Tech Stack:** TypeScript, Vue 3 / Nuxt 4, three@0.171, vitest (node env). **No new npm dependencies.**

**Spec:** [docs/superpowers/specs/2026-08-04-scene3d-sculpt-and-merge-design.md](../specs/2026-08-04-scene3d-sculpt-and-merge-design.md)

## Global Constraints

- **No new npm dependencies.** Everything here is hand-rolled against `three@0.171` and platform APIs.
- **Frontend only.** Scene3D has no server-side renderer — bakes are three client-side passes. No Python changes anywhere in this plan.
- `MESH_VERTEX_CAP = 40_000`, `MESH_DEFAULT_TARGET = 20_000`.
- **The mesh codec MUST delta-encode before deflating.** Quantise-and-deflate alone measures 917KB of base64 for a 52k-vertex sphere; delta + zigzag varint + deflate measures 186KB for the same mesh. This is a requirement, not an optimisation.
- **Nothing may write `orbit.enabled` directly.** `lib/scene3d/interaction.ts` recomputes it through `updateOrbitEnabled` from private per-concern fields. Sculpt adds a third field; it does not assign `orbit.enabled`, and never from a render loop.
- **A brush stroke must never write `scene_state`.** Strokes mutate the session's working buffer only. Encoding back into the doc happens on commit.
- Tests live at `frontend/tests/unit/<name>.unit.spec.ts` and run with `npm run test:unit` from `frontend/`. Environment is `node`; add `// @vitest-environment happy-dom` only where DOM APIs are genuinely needed (none of these tasks need it).
- `PRIMITIVE_KINDS` and every `ParamSpec.options` array are **append-only** — stored indices are a persistence contract.
- Run all commands from `frontend/`.

**The numeric expectations in Tasks 6–8 and 16 are measured, not guessed.** The
`triGrid` → `sdf` → `surfaceNets` → `merge` chain in this plan was run against
`three@0.171` before the plan was written, and these are the values it produced:

| Check | Measured | Test bound |
|---|---:|---|
| Sphere remesh volume ÷ analytic | 0.995 | 0.92–1.08 |
| Sphere remesh `bbox.max.x` | 0.4994 | 0.45–0.56 |
| Box remesh volume ÷ analytic | 0.996 | — |
| Sphere verts at res 24 / res 64 | 2,624 / 19,088 | hi > 2× lo |
| Plane / open cylinder / ring — interior÷band | 0.000 | open, < 0.25 |
| Torus (thin but **closed**) — interior÷band | 1.275 | not open, > 0.25 |
| Union of two overlapping spheres | 1 component, vol 0.874 | 1 component, 0.576–1.047 |
| Subtract / intersect volume | 0.356 / 0.160 | < 0.497 / < 0.393 |
| Union blend 0 → 0.15 | 0.928 → 0.982 | filleted > sharp |

If an implementation lands outside these, it is the implementation that is
wrong, not the bound. The two most likely culprits are `surfaceNets`' `flip`
argument (wrong winding still yields a plausible-looking mesh) and the
`OPEN_INTERIOR_RATIO` comparison being made against volume instead of the band.

---

# Phase 1 — The `mesh` primitive

## Task 1: Mesh codec

**Files:**
- Create: `frontend/app/lib/scene3d/mesh.ts`
- Modify: `frontend/app/lib/scene3d/config.ts:478` (rename `svgPathKey` → `contentDigest`, update its 3 call sites)
- Test: `frontend/tests/unit/scene3d-mesh-codec.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MESH_VERTEX_CAP: 40_000`, `MESH_DEFAULT_TARGET: 20_000`
  - `interface MeshData { positions: Float32Array; indices: Uint32Array }`
  - `encodeMesh(data: MeshData): Promise<string>`
  - `decodeMesh(encoded: string): Promise<MeshData>`
  - `meshDataFromGeometry(geo: THREE.BufferGeometry): MeshData`
  - `geometryFromMeshData(data: MeshData): THREE.BufferGeometry`
  - `contentDigest(s: string): string` (re-exported from `config.ts`)

- [ ] **Step 1: Rename the digest helper so mesh can share it**

`svgPathKey` is a generic FNV-1a string digest; `meshKey` needs exactly the same
thing. Rename rather than duplicate.

In `frontend/app/lib/scene3d/config.ts:476-485`, change the name and doc:

```ts
/** Cheap 32-bit string digest (FNV-1a), prefixed with length so two different
 *  payloads must collide in BOTH to alias. Only ever used as a cache key —
 *  stands in for `content.path` (svgPath) and `content.mesh` (mesh) inside
 *  `geoKeyFor`, both of which are far too large to stringify per sync. */
export function contentDigest(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${s.length}:${(h >>> 0).toString(36)}`
}
```

Update the two remaining call sites in the same file (`config.ts:506` and
`config.ts:758`) from `svgPathKey(...)` to `contentDigest(...)`.

- [ ] **Step 2: Confirm no other call sites exist**

Run: `grep -rn "svgPathKey" frontend/app frontend/tests`
Expected: no output.

- [ ] **Step 3: Write the failing codec test**

Create `frontend/tests/unit/scene3d-mesh-codec.unit.spec.ts`:

```ts
// Codec round-trip + size budget. Pure data, no WebGL — runs in the node env.
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  encodeMesh, decodeMesh, meshDataFromGeometry, geometryFromMeshData,
  MESH_VERTEX_CAP, MESH_DEFAULT_TARGET,
} from '~/lib/scene3d/mesh'

describe('mesh codec', () => {
  it('round-trips positions within the quantisation bound', async () => {
    const geo = new THREE.SphereGeometry(0.5, 32, 24)
    const src = meshDataFromGeometry(geo)
    const back = await decodeMesh(await encodeMesh(src))

    expect(back.positions.length).toBe(src.positions.length)
    expect(Array.from(back.indices)).toEqual(Array.from(src.indices))

    // uint16 over a bbox of extent 1.0 → worst-case error 1/65535 per axis.
    // Allow 2x that for float32 rounding on the way back out.
    let worst = 0
    for (let i = 0; i < src.positions.length; i++) {
      worst = Math.max(worst, Math.abs(back.positions[i]! - src.positions[i]!))
    }
    expect(worst).toBeLessThan(2 / 65535)
  })

  it('round-trips through a THREE geometry with normals recomputed', async () => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const data = meshDataFromGeometry(geo)
    const rebuilt = geometryFromMeshData(data)
    expect(rebuilt.getAttribute('position').count).toBe(data.positions.length / 3)
    expect(rebuilt.getAttribute('normal')).toBeTruthy()
    expect(rebuilt.index).toBeTruthy()
  })

  it('delta-encodes: a 26k-vertex sphere stays under 120KB of base64', async () => {
    // The load-bearing assertion. Plain uint16+deflate measures ~450KB here;
    // if someone drops the delta+varint stage this test is what catches it.
    const geo = new THREE.SphereGeometry(0.5, 196, 130)
    const encoded = await encodeMesh(meshDataFromGeometry(geo))
    expect(encoded.length).toBeLessThan(120 * 1024)
  })

  it('rejects a mesh over the vertex cap', async () => {
    const positions = new Float32Array((MESH_VERTEX_CAP + 1) * 3)
    await expect(encodeMesh({ positions, indices: new Uint32Array(0) }))
      .rejects.toThrow(/vertex cap/i)
  })

  it('exposes a default target below the cap', () => {
    expect(MESH_DEFAULT_TARGET).toBeLessThan(MESH_VERTEX_CAP)
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-mesh-codec`
Expected: FAIL — `Failed to resolve import "~/lib/scene3d/mesh"`.

- [ ] **Step 5: Implement the codec**

Create `frontend/app/lib/scene3d/mesh.ts`:

```ts
// Vertex-buffer codec for the `mesh` primitive: the geometry a sculpt or a
// merge produces, small enough to live inline in the scene document.
//
// The delta+varint stage before deflate is LOAD-BEARING, not an optimisation.
// Measured on SphereGeometry (three@0.171, deflate level 9, base64 length):
//
//   verts    uint16+deflate    delta+zigzag varint+deflate
//    6.3k         106KB                    15KB
//     13k         226KB                    42KB
//     26k         450KB                    91KB
//     52k         917KB                   186KB
//
// Naive quantise-and-deflate puts one sculpt near a megabyte of base64 in the
// scene_state widget. Index buffers dominate the raw size and are also what
// delta-encodes best, because surface-nets output is grid-scan ordered.
//
// Normals are never stored — recomputing them on decode is cheaper than the
// bytes they would cost.
import * as THREE from 'three'
import { contentDigest } from '~/lib/scene3d/config'

export { contentDigest }

/** Hard ceiling, enforced at encode time — the only place vertex count grows
 *  is a remesh, and it clamps to this. ~190KB encoded. */
export const MESH_VERTEX_CAP = 40_000
/** What the Remesh control aims for by default. ~70KB encoded. */
export const MESH_DEFAULT_TARGET = 20_000

export interface MeshData {
  /** xyz triples, length = 3 * vertexCount. */
  positions: Float32Array
  indices: Uint32Array
}

const MAGIC = 0x534d3031 // 'SM01'
const HEADER_BYTES = 4 + 4 + 4 + 24 // magic, vertexCount, indexCount, bbox(6 f32)

// --- varint + zigzag ---------------------------------------------------------

const zigzag = (n: number): number => ((n << 1) ^ (n >> 31)) >>> 0
const unzigzag = (n: number): number => (n >>> 1) ^ -(n & 1)

/** Growable byte sink. Sized generously up front — every caller knows an upper
 *  bound (5 bytes is the max varint width for a uint32). */
class ByteWriter {
  private buf: Uint8Array
  private len = 0
  constructor(capacity: number) { this.buf = new Uint8Array(capacity) }
  varint(v: number): void {
    let x = v >>> 0
    while (x > 127) { this.buf[this.len++] = (x & 127) | 128; x >>>= 7 }
    this.buf[this.len++] = x
  }
  bytes(): Uint8Array { return this.buf.subarray(0, this.len) }
}

class ByteReader {
  private at = 0
  constructor(private buf: Uint8Array) {}
  varint(): number {
    let x = 0, shift = 0, b = 0
    do { b = this.buf[this.at++]!; x |= (b & 127) << shift; shift += 7 } while (b & 128)
    return x >>> 0
  }
}

// --- base64 (works in both the browser and vitest's node env) ----------------

function toBase64(bytes: Uint8Array): string {
  let s = ''
  // Chunked: String.fromCharCode(...huge) blows the argument limit.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// --- deflate (async: the platform offers no synchronous form) ----------------

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// --- three <-> MeshData ------------------------------------------------------

/** Pull an indexed triangle mesh out of a geometry. Non-indexed input is
 *  indexed trivially (0..n-1) rather than welded — welding is the remesh's job,
 *  and doing it here would silently change a caller's topology. */
export function meshDataFromGeometry(geo: THREE.BufferGeometry): MeshData {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const positions = new Float32Array(pos.array.length)
  positions.set(pos.array as ArrayLike<number>)
  let indices: Uint32Array
  if (geo.index) {
    indices = new Uint32Array(geo.index.count)
    for (let i = 0; i < geo.index.count; i++) indices[i] = geo.index.getX(i)
  } else {
    indices = new Uint32Array(pos.count)
    for (let i = 0; i < pos.count; i++) indices[i] = i
  }
  return { positions, indices }
}

export function geometryFromMeshData(data: MeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions.slice(), 3))
  geo.setIndex(new THREE.BufferAttribute(data.indices.slice(), 1))
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

// --- encode / decode ---------------------------------------------------------

export async function encodeMesh(data: MeshData): Promise<string> {
  const vertexCount = data.positions.length / 3
  if (vertexCount > MESH_VERTEX_CAP) {
    throw new Error(`[scene3d-mesh] ${vertexCount} vertices exceeds the vertex cap of ${MESH_VERTEX_CAP}`)
  }

  // Bounding box, guarded against a zero-extent axis (a flat mesh).
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < data.positions.length; i++) {
    const a = i % 3
    const v = data.positions[i]!
    if (v < min[a]!) min[a] = v
    if (v > max[a]!) max[a] = v
  }
  const size = [0, 1, 2].map((a) => {
    const s = max[a]! - min[a]!
    return s > 1e-9 ? s : 1
  })

  // Positions: quantise → delta vs the previous vertex, per component → zigzag → varint.
  const posW = new ByteWriter(vertexCount * 3 * 5 + 16)
  const prev = [0, 0, 0]
  for (let i = 0; i < vertexCount; i++) {
    for (let a = 0; a < 3; a++) {
      const t = (data.positions[i * 3 + a]! - min[a]!) / size[a]!
      const q = Math.round(Math.min(1, Math.max(0, t)) * 65535)
      posW.varint(zigzag(q - prev[a]!))
      prev[a] = q
    }
  }

  // Indices: delta vs the previous index → zigzag → varint.
  const idxW = new ByteWriter(data.indices.length * 5 + 16)
  let p = 0
  for (let i = 0; i < data.indices.length; i++) {
    const v = data.indices[i]!
    idxW.varint(zigzag(v - p))
    p = v
  }

  const posBytes = posW.bytes()
  const idxBytes = idxW.bytes()
  const out = new Uint8Array(HEADER_BYTES + posBytes.length + idxBytes.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, vertexCount, true)
  view.setUint32(8, data.indices.length, true)
  for (let a = 0; a < 3; a++) {
    view.setFloat32(12 + a * 4, min[a]!, true)
    view.setFloat32(24 + a * 4, size[a]!, true)
  }
  out.set(posBytes, HEADER_BYTES)
  out.set(idxBytes, HEADER_BYTES + posBytes.length)

  return toBase64(await deflate(out))
}

export async function decodeMesh(encoded: string): Promise<MeshData> {
  const bytes = await inflate(fromBase64(encoded))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== MAGIC) throw new Error('[scene3d-mesh] bad magic')
  const vertexCount = view.getUint32(4, true)
  const indexCount = view.getUint32(8, true)
  const min = [0, 1, 2].map((a) => view.getFloat32(12 + a * 4, true))
  const size = [0, 1, 2].map((a) => view.getFloat32(24 + a * 4, true))

  const reader = new ByteReader(bytes.subarray(HEADER_BYTES))
  const positions = new Float32Array(vertexCount * 3)
  const prev = [0, 0, 0]
  for (let i = 0; i < vertexCount; i++) {
    for (let a = 0; a < 3; a++) {
      const q = prev[a]! + unzigzag(reader.varint())
      prev[a] = q
      positions[i * 3 + a] = min[a]! + (q / 65535) * size[a]!
    }
  }
  const indices = new Uint32Array(indexCount)
  let p = 0
  for (let i = 0; i < indexCount; i++) {
    p += unzigzag(reader.varint())
    indices[i] = p
  }
  return { positions, indices }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-mesh-codec`
Expected: PASS, 5 tests.

- [ ] **Step 7: Confirm the rename broke nothing**

Run: `npm run test:unit -- scene3d`
Expected: PASS. All pre-existing scene3d unit suites still green.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/scene3d/mesh.ts frontend/app/lib/scene3d/config.ts frontend/tests/unit/scene3d-mesh-codec.unit.spec.ts
git commit -m "feat(scene3d): delta+varint vertex-buffer codec for the mesh primitive"
```

---

## Task 2: `mesh` primitive kind in the document model

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` (type, `PrimitiveContent`, `PRIMITIVE_KINDS`, `NOT_PLACEABLE_KINDS`, `parseContent`)
- Modify: `frontend/app/lib/scene3d/primParams.ts` (`PRIMITIVE_PARAMS.mesh`)
- Test: `frontend/tests/unit/scene3d-mesh-doc.unit.spec.ts`

**Interfaces:**
- Consumes: `contentDigest` from Task 1.
- Produces: `PrimitiveKind` includes `'mesh'`; `PrimitiveContent.mesh?: string` and `.meshKey?: string`; `PRIMITIVE_PARAMS.mesh === []`.

- [ ] **Step 1: Write the failing document test**

Create `frontend/tests/unit/scene3d-mesh-doc.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  PRIMITIVE_KINDS, NOT_PLACEABLE_KINDS, serializeDoc, parseDoc, createDoc, contentDigest,
  type PrimitiveObject,
} from '~/lib/scene3d/config'
import { PRIMITIVE_PARAMS } from '~/lib/scene3d/primParams'

const withMesh = (encoded: string) => {
  const doc = createDoc()
  const obj: PrimitiveObject = {
    id: 'm1', name: 'Mesh', visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: createDoc().objects[0]?.material ?? ({} as any),
    kind: 'primitive', primitive: 'mesh',
    content: { mesh: encoded, meshKey: contentDigest(encoded) },
  }
  doc.objects = [obj]
  return doc
}

describe('mesh primitive in the document', () => {
  it('is a known kind but is not placeable from the add menu', () => {
    expect(PRIMITIVE_KINDS).toContain('mesh')
    expect(NOT_PLACEABLE_KINDS).toContain('mesh')
  })

  it('is appended last, never reordered — stored indices are a contract', () => {
    expect(PRIMITIVE_KINDS[PRIMITIVE_KINDS.length - 1]).toBe('mesh')
  })

  it('declares no geometry parameters', () => {
    expect(PRIMITIVE_PARAMS.mesh).toEqual([])
  })

  it('survives a serialize/parse round-trip', () => {
    const doc = withMesh('AAAAtestpayload')
    const back = parseDoc(serializeDoc(doc))
    const o = back.objects[0] as PrimitiveObject
    expect(o.primitive).toBe('mesh')
    expect(o.content?.mesh).toBe('AAAAtestpayload')
  })

  it('re-derives meshKey and ignores a tampered stored digest', () => {
    const doc = withMesh('AAAAtestpayload')
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].content.meshKey = 'liar'
    const back = parseDoc(JSON.stringify(raw))
    const o = back.objects[0] as PrimitiveObject
    expect(o.content?.meshKey).toBe(contentDigest('AAAAtestpayload'))
  })

  it('drops a non-string mesh field rather than trusting it', () => {
    const doc = withMesh('AAAAtestpayload')
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].content.mesh = { evil: true }
    const back = parseDoc(JSON.stringify(raw))
    const o = back.objects[0] as PrimitiveObject
    expect(o.content?.mesh).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-mesh-doc`
Expected: FAIL — `PRIMITIVE_KINDS` does not contain `'mesh'`.

- [ ] **Step 3: Add the kind and the content fields**

In `frontend/app/lib/scene3d/config.ts:23-28`:

```ts
export type PrimitiveKind =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
  | 'capsule' | 'pyramid' | 'prism'
  | 'icosahedron' | 'octahedron' | 'dodecahedron'
  | 'torusKnot' | 'ring'
  | 'text' | 'shape' | 'svgPath'
  | 'mesh'
```

In `PrimitiveContent` (`config.ts:174-197`), append:

```ts
  /** `mesh` only — the encoded vertex buffer (see lib/scene3d/mesh.ts). Runs to
   *  tens of KB, so `geoKeyFor` must key on `meshKey` instead, exactly as it
   *  does for `path`/`pathKey`. */
  mesh?: string
  /** Digest of `mesh`, its `geoKeyFor` stand-in. Derived at parse time, NEVER
   *  trusted from the document: a stored digest disagreeing with its payload
   *  would make the engine serve cached geometry for a shape the object no
   *  longer has — silently, and persistently, since the bad pair round-trips
   *  through every save. Same rule as `pathKey`. */
  meshKey?: string
```

In `PRIMITIVE_KINDS` (`config.ts:293`), append `'mesh'` to the final line:

```ts
  'text', 'shape', 'svgPath', 'mesh',
```

In `NOT_PLACEABLE_KINDS` (`config.ts:305`):

```ts
// `svgPath` and `mesh` both have no blank form to place — they only ever arrive
// carrying data (an SVG import; a sculpt, remesh or merge result).
export const NOT_PLACEABLE_KINDS: PrimitiveKind[] = ['svgPath', 'mesh']
```

In `parseContent` (`config.ts:747`), after the `path` block:

```ts
    if (typeof raw.mesh === 'string') {
      c.mesh = raw.mesh
      // Derived, never trusted — see PrimitiveContent.meshKey.
      c.meshKey = contentDigest(raw.mesh)
    }
```

- [ ] **Step 4: Add the empty param table**

In `frontend/app/lib/scene3d/primParams.ts`, add to `PRIMITIVE_PARAMS`:

```ts
  // A stored vertex buffer has nothing parametric left to expose — sculpting or
  // merging is what produced it. The Geometry panel renders empty.
  mesh: [],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-mesh-doc`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verify the add-menu drift test still passes**

`scene3d-config.unit.spec.ts` asserts `PRIM_GROUPS` covers every *placeable*
kind exactly. `mesh` is in `NOT_PLACEABLE_KINDS`, so `PRIM_GROUPS` needs no
change — this step proves that.

Run: `npm run test:unit -- scene3d-config`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/scene3d/config.ts frontend/app/lib/scene3d/primParams.ts frontend/tests/unit/scene3d-mesh-doc.unit.spec.ts
git commit -m "feat(scene3d): add the mesh primitive kind to the scene document"
```

---

## Task 3: Async mesh cache and the `geometryFor` case

**Files:**
- Create: `frontend/app/lib/scene3d/meshCache.ts`
- Modify: `frontend/app/lib/scene3d/engine.ts` (`geometryFor` case, `geoKeyFor`, `geometryForObject`)
- Test: `frontend/tests/unit/scene3d-mesh-cache.unit.spec.ts`

**Interfaces:**
- Consumes: `decodeMesh`, `geometryFromMeshData`, `MeshData` from Task 1; `PrimitiveContent.mesh`/`.meshKey` from Task 2.
- Produces:
  - `meshCacheGet(meshKey: string | undefined): MeshData | null`
  - `loadMesh(encoded: string, meshKey: string): Promise<MeshData>`
  - `meshCacheClear(): void` (tests only)

**Why async:** `DecompressionStream` has no synchronous form and `geometryFor`
is synchronous, called on every engine sync. This mirrors the `text`
primitive's font dependency exactly — `geometryForObject` at `engine.ts:558`
peeks a sync cache, draws a placeholder on a miss, kicks off the async load, and
clears `root.userData.geoKey` on resolution so the next sync rebuilds.

- [ ] **Step 1: Write the failing cache test**

Create `frontend/tests/unit/scene3d-mesh-cache.unit.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { encodeMesh, meshDataFromGeometry, contentDigest } from '~/lib/scene3d/mesh'
import { meshCacheGet, loadMesh, meshCacheClear } from '~/lib/scene3d/meshCache'
import { geometryFor, geoKeyFor } from '~/lib/scene3d/engine'
import type { PrimitiveObject } from '~/lib/scene3d/config'

const objWith = (mesh: string): PrimitiveObject => ({
  id: 'm', name: 'M', visible: true,
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  material: {} as any, kind: 'primitive', primitive: 'mesh',
  content: { mesh, meshKey: contentDigest(mesh) },
})

describe('mesh cache', () => {
  beforeEach(() => { meshCacheClear() })

  it('misses before load and hits after', async () => {
    const encoded = await encodeMesh(meshDataFromGeometry(new THREE.BoxGeometry(1, 1, 1)))
    const key = contentDigest(encoded)
    expect(meshCacheGet(key)).toBeNull()
    await loadMesh(encoded, key)
    expect(meshCacheGet(key)).not.toBeNull()
  })

  it('geometryFor returns a placeholder on a cache miss, real geometry on a hit', async () => {
    const encoded = await encodeMesh(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 32, 24)))
    const key = contentDigest(encoded)

    const placeholder = geometryFor('mesh', undefined, { mesh: encoded, meshKey: key })
    expect(placeholder.getAttribute('position').count).toBeLessThan(50) // the placeholder box

    await loadMesh(encoded, key)
    const real = geometryFor('mesh', undefined, { mesh: encoded, meshKey: key })
    expect(real.getAttribute('position').count).toBeGreaterThan(500)
  })

  it('geoKeyFor keys on meshKey, never on the payload', async () => {
    // A multi-KB payload must not reach the key — it is rebuilt on every sync
    // for every object, and stringifying it would put tens of KB of string work
    // on the drag path.
    const encoded = await encodeMesh(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48)))
    const key = geoKeyFor(objWith(encoded), 'smooth')
    expect(key).toContain(contentDigest(encoded))
    expect(key).not.toContain(encoded.slice(0, 64))
    expect(key.length).toBeLessThan(400)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-mesh-cache`
Expected: FAIL — `Failed to resolve import "~/lib/scene3d/meshCache"`.

- [ ] **Step 3: Implement the cache**

Create `frontend/app/lib/scene3d/meshCache.ts`:

```ts
// Decoded-mesh cache. `decodeMesh` is async (DecompressionStream has no
// synchronous form) but `geometryFor` is synchronous and runs on every engine
// sync, so decode cannot happen inline. Same shape as the font cache in
// outlines.ts: a synchronous peek for the render path, an async loader that
// triggers a re-sync when it lands.
//
// This also fixes a cost that would otherwise land on every slider tick:
// `baseSizeFor` and `baseVertexCountFor` (engine.ts) call `buildGeometry` on
// each tick to report object size and clone cost. Without this cache that
// would inflate and decode tens of KB per tick.
import { decodeMesh, type MeshData } from '~/lib/scene3d/mesh'

const cache = new Map<string, MeshData>()
const inFlight = new Map<string, Promise<MeshData>>()

/** Synchronous peek for the render path. Null means "not decoded yet" — the
 *  caller draws a placeholder and calls `loadMesh`. */
export function meshCacheGet(meshKey: string | undefined): MeshData | null {
  if (!meshKey) return null
  return cache.get(meshKey) ?? null
}

/** Decode into the cache. Concurrent calls for the same key share one decode —
 *  a scene with the same mesh cloned across several objects must not inflate it
 *  once per object. */
export function loadMesh(encoded: string, meshKey: string): Promise<MeshData> {
  const hit = cache.get(meshKey)
  if (hit) return Promise.resolve(hit)
  const running = inFlight.get(meshKey)
  if (running) return running
  const p = decodeMesh(encoded).then((data) => {
    cache.set(meshKey, data)
    inFlight.delete(meshKey)
    return data
  }).catch((err) => {
    inFlight.delete(meshKey)
    throw err
  })
  inFlight.set(meshKey, p)
  return p
}

/** Tests only. */
export function meshCacheClear(): void {
  cache.clear()
  inFlight.clear()
}
```

- [ ] **Step 4: Add the `geometryFor` case**

In `frontend/app/lib/scene3d/engine.ts`, import at the top alongside the other
scene3d imports:

```ts
import { meshCacheGet, loadMesh } from '~/lib/scene3d/meshCache'
import { geometryFromMeshData } from '~/lib/scene3d/mesh'
```

Add a case to `geometryFor`'s switch (`engine.ts:87`), next to the other
content-driven kinds:

```ts
    case 'mesh': {
      // Cache miss → the same 0.3 placeholder the `text` primitive draws while
      // its font loads. geometryForObject kicks off the decode and forces a
      // re-sync, so the placeholder is transient.
      const data = meshCacheGet(content?.meshKey)
      return data ? geometryFromMeshData(data) : new THREE.BoxGeometry(0.3, 0.3, 0.3)
    }
```

- [ ] **Step 5: Make `geoKeyFor` key on the digest**

`geoKeyFor` (`engine.ts:252`) already strips `path` in favour of `pathKey`.
Widen the same exclusion to `mesh` — at `engine.ts:258-261`:

```ts
  // Neither an svgPath's `d` (several KB) nor a mesh's vertex buffer (tens of
  // KB) may reach this key: it is rebuilt on EVERY sync for EVERY object, and
  // stringifying either would put tens of KB of string work on the drag path.
  // `pathKey`/`meshKey` are the digests standing in for them.
  const c = obj.content
  const content = c
    ? JSON.stringify({ ...c, ...(c.pathKey ? { path: undefined } : {}), ...(c.meshKey ? { mesh: undefined } : {}) })
    : ''
```

- [ ] **Step 6: Kick off the decode and re-sync from `geometryForObject`**

In `geometryForObject` (`engine.ts:558`), after the existing `text` block and
before the `return buildGeometry(...)`, add the mesh branch. It follows the
font path's token contract exactly — stale loads dropped, `geoKey` cleared so
the next sync rebuilds despite unchanged doc fields:

```ts
    if (obj.primitive === 'mesh') {
      const encoded = obj.content?.mesh
      const key = obj.content?.meshKey
      if (encoded && key && !meshCacheGet(key)) {
        const tok = ++this.token
        this.meshTokens.set(obj.id, tok)
        loadMesh(encoded, key).then(() => {
          if (this.meshTokens.get(obj.id) !== tok) return // stale
          const root = this.objectRoots.get(obj.id)
          if (!root) return // removed while decoding
          const latest = (root.userData.primObj as PrimitiveObject | undefined) ?? obj
          root.userData.geoKey = undefined
          this.syncObject(latest)
        }).catch(() => { /* keep the placeholder; a corrupt buffer stays visible as one */ })
      } else if (key) {
        this.meshTokens.delete(obj.id)
      }
    }
```

Declare the token map next to `fontTokens` in the class body:

```ts
  private meshTokens = new Map<string, number>()
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-mesh-cache`
Expected: PASS, 3 tests.

- [ ] **Step 8: Run the full scene3d suite**

Run: `npm run test:unit -- scene3d`
Expected: PASS. No regression in geometry, hierarchy, svg-path or config suites.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/lib/scene3d/meshCache.ts frontend/app/lib/scene3d/engine.ts frontend/tests/unit/scene3d-mesh-cache.unit.spec.ts
git commit -m "feat(scene3d): decode mesh buffers through an async cache with a placeholder"
```

---

## Task 4: Clamp the cloner against the vertex budget

**Files:**
- Modify: `frontend/app/lib/scene3d/modifiers.ts` (`totalClones`, `applyModifiers`)
- Test: `frontend/tests/unit/scene3d-clone-budget.unit.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `clampedClones(modifiers, baseVertexCount): { count: number; clamped: boolean }`, exported for the surface's clone-cost warning.

**Why:** `VERTEX_BUDGET` (300k) currently throttles *subdivision* only —
`cloneCount` is deliberately never reduced because it is user-visible
(`modifiers.ts:14-16`). That was safe when every base geometry was a few
thousand vertices. The real caps are cloneCount 12 (linear) and 5x5x5 = 125 copies
(grid): a 40k-vertex mesh hits 480k vertices linear and 5M in grid mode. The clamp must be **surfaced**, not silent.

- [ ] **Step 1: Write the failing budget test**

Create `frontend/tests/unit/scene3d-clone-budget.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { clampedClones, applyModifiers, totalClones } from '~/lib/scene3d/modifiers'

describe('clone budget', () => {
  it('leaves a small base geometry unclamped', () => {
    const r = clampedClones({ cloneCount: 50 }, 500) // 25k vertices
    expect(r).toEqual({ count: 50, clamped: false })
  })

  it('clamps a heavy base geometry and reports it', () => {
    const r = clampedClones({ cloneCount: 12 }, 40_000) // 12 is the cap: 480k vertices
    expect(r.clamped).toBe(true)
    expect(r.count).toBeGreaterThanOrEqual(1)
    expect(r.count * 40_000).toBeLessThanOrEqual(300_000)
  })

  it('never clamps below a single copy', () => {
    const r = clampedClones({ cloneCount: 12 }, 10_000_000)
    expect(r.count).toBe(1)
  })

  it('applyModifiers honours the clamp', () => {
    // 20k-vertex base at the cloneCount cap of 12 would be 240k; grid mode's
    // 5x5x5 = 125 copies would be 2.5M. The budget caps it.
    const base = new THREE.SphereGeometry(0.5, 180, 110)
    const n = base.getAttribute('position').count
    expect(n).toBeGreaterThan(15_000)
    const out = applyModifiers(base, { cloneCount: 12, cloneOffsetX: 2 })
    expect(out.getAttribute('position').count).toBeLessThanOrEqual(300_000)
  })

  it('totalClones still reports the user-set figure, unclamped', () => {
    // The clamp is a render-time guard; the doc's value is what the user chose.
    expect(totalClones({ cloneCount: 12 })).toBe(12)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-clone-budget`
Expected: FAIL — `clampedClones is not a function`.

- [ ] **Step 3: Implement the clamp**

In `frontend/app/lib/scene3d/modifiers.ts`, after `totalClones` (line 26):

```ts
/** The clone count actually rendered, and whether the budget reduced it.
 *
 *  `totalClones` reports what the USER set and stays unclamped — the doc's
 *  value is the user's choice and the panel shows it back. This is the
 *  render-time guard on top: subdivision already yields to VERTEX_BUDGET, but
 *  the cloner never did, which was safe only while every base geometry was a
 *  few thousand vertices. The caps are `cloneCount` 12 (linear) and 5x5x5 = 125
 *  copies (grid), so a 40k-vertex `mesh` primitive reaches 480k vertices linear
 *  and 5M in grid mode — the latter hangs the tab.
 *
 *  Callers MUST surface `clamped` — the surface's clone-cost warning does. A
 *  silent reduction reads as a rendering bug. */
export function clampedClones(
  modifiers: Record<string, number> | undefined,
  baseVertexCount: number,
): { count: number; clamped: boolean } {
  const requested = totalClones(modifiers)
  if (baseVertexCount <= 0) return { count: requested, clamped: false }
  const affordable = Math.max(1, Math.floor(VERTEX_BUDGET / baseVertexCount))
  return affordable >= requested
    ? { count: requested, clamped: false }
    : { count: affordable, clamped: true }
}
```

In `applyModifiers` (line 281), replace `const count = totalClones(modifiers)`
with a clamp taken against the *shaped* geometry, since subdivision runs first:

```ts
  const requested = totalClones(modifiers)
  const deforms = taper !== 0 || twist !== 0 || bend !== 0 || noise !== 0 || jitter !== 0
```

then after the subdivision loop and the deform stages, replace
`if (count > 1) {` with:

```ts
  const { count } = clampedClones(modifiers, out.getAttribute('position').count)
  if (count > 1) {
```

and in the subdivision ceiling above, use `requested` where `count` was used:

```ts
    const ceiling = VERTEX_BUDGET / Math.max(1, requested)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-clone-budget`
Expected: PASS, 5 tests.

- [ ] **Step 5: Surface the clamp in the panel**

In `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`, find the
existing clone-cost warning (search for `baseVertexCountFor`). Extend its
computed to call `clampedClones(obj.modifiers, baseVertexCountFor(...))` and,
when `clamped` is true, render the additional line:

```
Clone count reduced to {{ cloneClamp.count }} to stay inside the vertex budget.
```

styled with the same muted warning classes the existing cost line uses.

- [ ] **Step 6: Verify the full modifier suite**

Run: `npm run test:unit -- scene3d`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/scene3d/modifiers.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/tests/unit/scene3d-clone-budget.unit.spec.ts
git commit -m "fix(scene3d): clamp the cloner against the vertex budget and show it"
```

---

## Task 5: Convert to mesh

**Files:**
- Create: `frontend/app/lib/scene3d/toMesh.ts`
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (action + button)
- Test: `frontend/tests/unit/scene3d-to-mesh.unit.spec.ts`

**Interfaces:**
- Consumes: `encodeMesh`, `meshDataFromGeometry`, `contentDigest`, `MESH_VERTEX_CAP` (Task 1); the `mesh` kind (Task 2).
- Produces: `convertToMesh(obj: PrimitiveObject, geo: THREE.BufferGeometry): Promise<PrimitiveObject>`

**Behaviour:** freezes the object's *current built geometry* — with modifiers
already applied — into a `mesh` primitive. Phase 1 does no remeshing; that
arrives in Task 9. Name, transform, material, motion and `parentId` are
preserved; `params` and `modifiers` are dropped, because they are already baked
into the frozen vertices and re-applying them would double up.

- [ ] **Step 1: Write the failing conversion test**

Create `frontend/tests/unit/scene3d-to-mesh.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { convertToMesh } from '~/lib/scene3d/toMesh'
import { buildGeometry } from '~/lib/scene3d/engine'
import { contentDigest, type PrimitiveObject } from '~/lib/scene3d/config'
import { loadMesh, meshCacheGet } from '~/lib/scene3d/meshCache'

const sphere = (): PrimitiveObject => ({
  id: 's1', name: 'My sphere', visible: true,
  position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [2, 2, 2],
  material: { type: 'standard', color: '#ff0000', roughness: 0.5, metalness: 0 } as any,
  kind: 'primitive', primitive: 'sphere',
  params: { detail: 32 }, modifiers: { twist: 45 },
  parentId: 'g1',
})

describe('convert to mesh', () => {
  it('produces a mesh primitive carrying an encoded buffer', async () => {
    const src = sphere()
    const geo = buildGeometry('sphere', src.params, src.modifiers, 'smooth')
    const out = await convertToMesh(src, geo)
    expect(out.primitive).toBe('mesh')
    expect(typeof out.content?.mesh).toBe('string')
    expect(out.content?.meshKey).toBe(contentDigest(out.content!.mesh!))
  })

  it('preserves identity, transform, material, motion and parent', async () => {
    const src = sphere()
    const geo = buildGeometry('sphere', src.params, src.modifiers, 'smooth')
    const out = await convertToMesh(src, geo)
    expect(out.id).toBe(src.id)
    expect(out.name).toBe('My sphere')
    expect(out.position).toEqual([1, 2, 3])
    expect(out.rotation).toEqual([0.1, 0.2, 0.3])
    expect(out.scale).toEqual([2, 2, 2])
    expect(out.material).toEqual(src.material)
    expect(out.parentId).toBe('g1')
  })

  it('drops params and modifiers — they are baked into the vertices', async () => {
    const src = sphere()
    const geo = buildGeometry('sphere', src.params, src.modifiers, 'smooth')
    const out = await convertToMesh(src, geo)
    expect(out.params).toBeUndefined()
    expect(out.modifiers).toBeUndefined()
  })

  it('the frozen buffer decodes to the same vertex count as the source', async () => {
    const src = sphere()
    const geo = buildGeometry('sphere', src.params, src.modifiers, 'smooth')
    const expected = geo.getAttribute('position').count
    const out = await convertToMesh(src, geo)
    await loadMesh(out.content!.mesh!, out.content!.meshKey!)
    expect(meshCacheGet(out.content!.meshKey!)!.positions.length / 3).toBe(expected)
  })

  it('refuses a geometry over the vertex cap with a readable message', async () => {
    const src = sphere()
    const huge = new THREE.SphereGeometry(0.5, 400, 260)
    expect(huge.getAttribute('position').count).toBeGreaterThan(40_000)
    await expect(convertToMesh(src, huge)).rejects.toThrow(/vertex cap/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-to-mesh`
Expected: FAIL — `Failed to resolve import "~/lib/scene3d/toMesh"`.

- [ ] **Step 3: Implement the conversion**

Create `frontend/app/lib/scene3d/toMesh.ts`:

```ts
// Freeze a primitive's built geometry into a `mesh` primitive.
//
// The input is the geometry the engine ALREADY built for this object, so
// modifiers are baked in. That is exactly why `params` and `modifiers` are
// dropped from the result: leaving them would re-apply a twist that is already
// in the vertices.
import type * as THREE from 'three'
import { encodeMesh, meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { contentDigest, type PrimitiveObject } from '~/lib/scene3d/config'

export async function convertToMesh(
  obj: PrimitiveObject,
  geo: THREE.BufferGeometry,
): Promise<PrimitiveObject> {
  const encoded = await encodeMesh(meshDataFromGeometry(geo))
  return {
    id: obj.id,
    name: obj.name,
    visible: obj.visible,
    position: [...obj.position] as PrimitiveObject['position'],
    rotation: [...obj.rotation] as PrimitiveObject['rotation'],
    scale: [...obj.scale] as PrimitiveObject['scale'],
    material: obj.material,
    ...(obj.motion ? { motion: obj.motion } : {}),
    ...(obj.parentId ? { parentId: obj.parentId } : {}),
    kind: 'primitive',
    primitive: 'mesh',
    content: { mesh: encoded, meshKey: contentDigest(encoded) },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-to-mesh`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the action into the surface**

In `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`:

Add near the other object operations (around `function addPrimitive`, line 1477):

```ts
// ── Convert to mesh ───────────────────────────────────────────────────────────
/** Freeze the selection's CURRENT geometry (modifiers included) into a `mesh`
 *  primitive. Irreversible in the object itself — the studio's doc-level undo is
 *  the way back — so it is gated behind a confirm. */
const converting = ref(false)
const canConvertToMesh = computed(() =>
  selectedObjects.value.length === 1
  && selectedObjects.value[0]!.kind === 'primitive'
  && (selectedObjects.value[0] as PrimitiveObject).primitive !== 'mesh')

async function convertSelectionToMesh() {
  const src = selectedObjects.value[0] as PrimitiveObject | undefined
  if (!src || converting.value) return
  converting.value = true
  try {
    const font = src.primitive === 'text' ? fontCacheGet(src.content?.font ?? DEFAULT_FONT_URL) : null
    const geo = buildGeometry(src.primitive, src.params, src.modifiers, 'smooth', src.content, font)
    const next = await convertToMesh(src, geo)
    geo.dispose()
    const i = doc.objects.findIndex((o) => o.id === src.id)
    if (i >= 0) doc.objects[i] = next
  } catch (err) {
    console.warn('[scene3d-studio] convert to mesh failed', err)
  } finally {
    converting.value = false
  }
}
```

Add the button to the object-panel action row (`Scene3DStudioSurface.vue:2091`),
extending the `v-if` on the wrapping `div` to
`canGroup || canUngroup || canConvertToMesh`:

```vue
          <StudioButton v-if="canConvertToMesh" :disabled="converting" @click="convertSelectionToMesh">
            <span class="flex items-center gap-1.5"><Boxes class="h-3.5 w-3.5" /> To mesh</span>
          </StudioButton>
```

Import `convertToMesh` from `~/lib/scene3d/toMesh` and `buildGeometry` from
`~/lib/scene3d/engine` at the top of the script block if not already present.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: the error count matches the pre-task baseline. **If any error names
`mesh`, `MeshData`, `convertToMesh`, `contentDigest` or `clampedClones`, it is
yours — fix it. Do not classify it as pre-existing.**

- [ ] **Step 7: Live check in the browser**

Start the dev server (`preview_start`, or `./dev.sh`), open a 3D Studio node,
add a sphere, set Twist to 45, click **To mesh**. Confirm:
1. The shape does not change when it converts (the twist stays, once).
2. The Geometry panel goes empty; Material, Transform and Motion still work.
3. Reload the page — the mesh is still there and still looks the same.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/scene3d/toMesh.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/tests/unit/scene3d-to-mesh.unit.spec.ts
git commit -m "feat(scene3d): convert a primitive to a mesh, freezing its modifiers"
```

**Phase 1 is complete and shippable here.** A mesh object round-trips through
save, takes every modifier and material, animates, and exports.

---

# Phase 2 — The voxel module

## Task 6: Triangle grid, closest point, unsigned distance

**Files:**
- Create: `frontend/app/lib/scene3d/voxel/bounds.ts`
- Create: `frontend/app/lib/scene3d/voxel/triGrid.ts`
- Test: `frontend/tests/unit/scene3d-tri-grid.unit.spec.ts`

**Interfaces:**
- Consumes: `MeshData` (Task 1).
- Produces:
  - `boundsOf(data: MeshData): { lo: [number,number,number]; hi: [number,number,number] }`
  - `cellFor(data: MeshData, resolution: number): number`
  - `interface TriGrid { cell: number; min: [number,number,number]; dims: [number,number,number]; bins: Int32Array[]; data: MeshData }`
  - `buildTriGrid(data: MeshData, cell: number): TriGrid`
  - `closestDistance(grid: TriGrid, x: number, y: number, z: number, maxRadius: number): number`
  - `raycastGrid(grid: TriGrid, origin: [number,number,number], dir: [number,number,number]): { t: number; tri: number } | null`

- [ ] **Step 1: Write the failing grid test**

Create `frontend/tests/unit/scene3d-tri-grid.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { buildTriGrid, closestDistance, raycastGrid } from '~/lib/scene3d/voxel/triGrid'

const sphereGrid = (cell = 0.05) =>
  buildTriGrid(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48)), cell)

describe('triangle grid', () => {
  it('measures distance to a unit sphere surface analytically', () => {
    const g = sphereGrid()
    // A point on the +X axis at r=0.8 is 0.3 from a sphere of radius 0.5.
    expect(closestDistance(g, 0.8, 0, 0, 2)).toBeCloseTo(0.3, 2)
    // Dead centre is 0.5 from the surface.
    expect(closestDistance(g, 0, 0, 0, 2)).toBeCloseTo(0.5, 2)
  })

  it('returns the search radius when nothing is within it', () => {
    const g = sphereGrid()
    expect(closestDistance(g, 50, 50, 50, 1)).toBe(1)
  })

  it('raycasts onto the surface at the analytic distance', () => {
    const g = sphereGrid()
    const hit = raycastGrid(g, [3, 0, 0], [-1, 0, 0])
    expect(hit).not.toBeNull()
    expect(hit!.t).toBeCloseTo(2.5, 2) // 3 - 0.5
  })

  it('misses cleanly when the ray passes by', () => {
    const g = sphereGrid()
    expect(raycastGrid(g, [3, 5, 0], [-1, 0, 0])).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-tri-grid`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the shared bounds helper**

Every consumer in this module needs a mesh's bounding box, and three of them
(`sdf.ts`, `voxel/index.ts`, `merge.ts`) would otherwise each carry their own
copy of the same loop. One home for it:

Create `frontend/app/lib/scene3d/voxel/bounds.ts`:

```ts
// The bounding box of a MeshData, and the cell size derived from it. Every
// other file in this module needs one or both; keeping them here is what stops
// the same six-line loop appearing in sdf.ts, index.ts and merge.ts.
import type { MeshData } from '~/lib/scene3d/mesh'

export function boundsOf(data: MeshData): {
  lo: [number, number, number]
  hi: [number, number, number]
} {
  const p = data.positions
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i++) {
    const a = i % 3
    const v = p[i]!
    if (v < lo[a]!) lo[a] = v
    if (v > hi[a]!) hi[a] = v
  }
  // An empty mesh collapses to a degenerate box rather than propagating
  // Infinity into every lattice size downstream.
  if (!Number.isFinite(lo[0])) return { lo: [0, 0, 0], hi: [0, 0, 0] }
  return { lo, hi }
}

/** Cell size putting `resolution` cells along the mesh's longest axis. */
export function cellFor(data: MeshData, resolution: number): number {
  const { lo, hi } = boundsOf(data)
  return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6) / resolution
}
```

- [ ] **Step 4: Implement the grid**

Create `frontend/app/lib/scene3d/voxel/triGrid.ts`:

```ts
// A uniform spatial grid binning triangle indices, and the two queries built on
// it: nearest-surface distance and ray picking.
//
// ONE structure, THREE consumers — the SDF sample loop (sdf.ts), the sculpt
// brush's ray pick (sculpt/session.ts) and the merge (merge.ts). It is built
// once and passed around rather than rebuilt per use, which is most of why the
// voxel module earns its keep.
//
// Bins are CSR-style (`start` offsets into a flat `items`), not an array of
// arrays: a 40k-triangle mesh at 64^3 produces a few hundred thousand bin
// entries, and that many little JS arrays costs more in allocation and GC than
// the whole distance query.
import type { MeshData } from '~/lib/scene3d/mesh'
import { boundsOf } from './bounds'

export interface TriGrid {
  cell: number
  min: [number, number, number]
  dims: [number, number, number]
  /** Bin `c` owns items[start[c] .. start[c + 1]). Length dims.x*y*z + 1. */
  start: Int32Array
  items: Int32Array
  data: MeshData
  triCount: number
}

/** Cells of empty margin around the mesh, so a query just outside the surface
 *  still has cells to walk and the DDA has somewhere to enter from. */
const PAD = 1

export function buildTriGrid(data: MeshData, cell: number): TriGrid {
  const p = data.positions
  const ix = data.indices
  const triCount = (ix.length / 3) | 0

  // bLo/bHi, not lo/hi — those two names are taken below by the per-triangle
  // cell range, which is reused across both binning passes.
  const { lo: bLo, hi: bHi } = boundsOf(data)

  const min: [number, number, number] = [bLo[0] - cell * PAD, bLo[1] - cell * PAD, bLo[2] - cell * PAD]
  const dims: [number, number, number] = [
    Math.max(1, Math.ceil((bHi[0] - bLo[0]) / cell) + 2 * PAD + 1),
    Math.max(1, Math.ceil((bHi[1] - bLo[1]) / cell) + 2 * PAD + 1),
    Math.max(1, Math.ceil((bHi[2] - bLo[2]) / cell) + 2 * PAD + 1),
  ]
  const cellCount = dims[0] * dims[1] * dims[2]

  // Cell range a triangle overlaps, clamped into the grid.
  const lo = [0, 0, 0]
  const hi = [0, 0, 0]
  const triCells = (t: number): void => {
    for (let a = 0; a < 3; a++) {
      let mn = Infinity, mx = -Infinity
      for (let v = 0; v < 3; v++) {
        const c = p[ix[t * 3 + v]! * 3 + a]!
        if (c < mn) mn = c
        if (c > mx) mx = c
      }
      lo[a] = Math.max(0, Math.floor((mn - min[a]!) / cell))
      hi[a] = Math.min(dims[a]! - 1, Math.floor((mx - min[a]!) / cell))
    }
  }

  // Counting pass, then prefix sum, then fill pass.
  const counts = new Int32Array(cellCount + 1)
  for (let t = 0; t < triCount; t++) {
    triCells(t)
    for (let k = lo[2]!; k <= hi[2]!; k++)
      for (let j = lo[1]!; j <= hi[1]!; j++)
        for (let i = lo[0]!; i <= hi[0]!; i++)
          counts[(k * dims[1]! + j) * dims[0]! + i + 1]!++
  }
  const start = new Int32Array(cellCount + 1)
  for (let c = 0; c < cellCount; c++) start[c + 1] = start[c]! + counts[c + 1]!
  const items = new Int32Array(start[cellCount]!)
  const cursor = new Int32Array(cellCount)
  for (let t = 0; t < triCount; t++) {
    triCells(t)
    for (let k = lo[2]!; k <= hi[2]!; k++)
      for (let j = lo[1]!; j <= hi[1]!; j++)
        for (let i = lo[0]!; i <= hi[0]!; i++) {
          const c = (k * dims[1]! + j) * dims[0]! + i
          items[start[c]! + cursor[c]!++] = t
        }
  }

  return { cell, min, dims, start, items, data, triCount }
}

// --- closest point on a triangle (Ericson, Real-Time Collision Detection) ----
// Returns the SQUARED distance, so the hot loop never calls sqrt.

function pointTriDistSq(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const sq = (x: number, y: number, z: number) => x * x + y * y + z * z
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz)                      // vertex A

  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz)                     // vertex B

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {                                  // edge AB
    const v = d1 / (d1 - d3)
    return sq(apx - abx * v, apy - aby * v, apz - abz * v)
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz)                     // vertex C

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {                                  // edge AC
    const w = d2 / (d2 - d6)
    return sq(apx - acx * w, apy - acy * w, apz - acz * w)
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {                        // edge BC
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    return sq(bpx - (cx - bx) * w, bpy - (cy - by) * w, bpz - (cz - bz) * w)
  }

  const denom = 1 / (va + vb + vc)                                      // face interior
  const v = vb * denom, w = vc * denom
  return sq(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w)
}

/** Distance from a point to the nearest triangle, capped at `maxRadius`.
 *
 *  Walks cells outward in Chebyshev shells and stops as soon as the nearest
 *  possible point in the next shell is further than the best hit so far — that
 *  early-out is what keeps this near-constant-time instead of scanning the
 *  whole grid. Returns `maxRadius` when nothing is inside it, which callers
 *  read as "far away"; the SDF only needs exact values in the narrow band. */
export function closestDistance(
  g: TriGrid, x: number, y: number, z: number, maxRadius: number,
): number {
  const p = g.data.positions
  const ix = g.data.indices
  const ci = Math.floor((x - g.min[0]) / g.cell)
  const cj = Math.floor((y - g.min[1]) / g.cell)
  const ck = Math.floor((z - g.min[2]) / g.cell)
  let bestSq = maxRadius * maxRadius
  const maxShell = Math.ceil(maxRadius / g.cell) + 1

  for (let s = 0; s <= maxShell; s++) {
    // The closest any triangle in shell s can be is (s-1)*cell away.
    const floor = Math.max(0, (s - 1) * g.cell)
    if (floor * floor > bestSq) break
    for (let k = ck - s; k <= ck + s; k++) {
      if (k < 0 || k >= g.dims[2]) continue
      for (let j = cj - s; j <= cj + s; j++) {
        if (j < 0 || j >= g.dims[1]) continue
        for (let i = ci - s; i <= ci + s; i++) {
          if (i < 0 || i >= g.dims[0]) continue
          // Shell surface only — the interior was covered by a previous s.
          const cheb = Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck))
          if (cheb !== s) continue
          const c = (k * g.dims[1] + j) * g.dims[0] + i
          for (let e = g.start[c]!; e < g.start[c + 1]!; e++) {
            const t = g.items[e]!
            const a = ix[t * 3]! * 3, b = ix[t * 3 + 1]! * 3, cc = ix[t * 3 + 2]! * 3
            const d = pointTriDistSq(
              x, y, z,
              p[a]!, p[a + 1]!, p[a + 2]!,
              p[b]!, p[b + 1]!, p[b + 2]!,
              p[cc]!, p[cc + 1]!, p[cc + 2]!,
            )
            if (d < bestSq) bestSq = d
          }
        }
      }
    }
  }
  return Math.sqrt(bestSq)
}

// --- ray picking -------------------------------------------------------------

/** Möller–Trumbore. Returns the ray parameter, or -1 on a miss. Double-sided:
 *  a sculpt brush must still pick a surface the user is looking at from inside
 *  a concavity. */
function rayTri(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < 1e-12) return -1
  const inv = 1 / det
  const tx = ox - ax, ty = oy - ay, tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * inv
  if (u < 0 || u > 1) return -1
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < 0 || u + v > 1) return -1
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  return t > 1e-7 ? t : -1
}

/** Nearest triangle hit along a ray, via a 3D DDA over the grid.
 *
 *  This is the brush's picking path and the reason the grid exists at all: a
 *  brute-force THREE.Raycaster over 80k triangles costs 5–15ms plus garbage per
 *  pointermove, which cannot hold 60Hz. The DDA visits a handful of cells. */
export function raycastGrid(
  g: TriGrid,
  origin: [number, number, number],
  dir: [number, number, number],
): { t: number; tri: number } | null {
  const p = g.data.positions
  const ix = g.data.indices
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
  const d = [dir[0] / len, dir[1] / len, dir[2] / len]

  // Clip the ray to the grid box (slab test) so the walk starts inside.
  let tMin = 0
  let tMax = Infinity
  for (let a = 0; a < 3; a++) {
    const lo = g.min[a]!
    const hi = lo + g.dims[a]! * g.cell
    if (Math.abs(d[a]!) < 1e-12) {
      if (origin[a]! < lo || origin[a]! > hi) return null
      continue
    }
    let t0 = (lo - origin[a]!) / d[a]!
    let t1 = (hi - origin[a]!) / d[a]!
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s }
    if (t0 > tMin) tMin = t0
    if (t1 < tMax) tMax = t1
    if (tMin > tMax) return null
  }

  const at = (a: number) => origin[a]! + d[a]! * (tMin + 1e-6)
  const cellIdx = [0, 0, 0]
  const step = [0, 0, 0]
  const tNext = [0, 0, 0]
  const tDelta = [0, 0, 0]
  for (let a = 0; a < 3; a++) {
    cellIdx[a] = Math.min(g.dims[a]! - 1, Math.max(0, Math.floor((at(a) - g.min[a]!) / g.cell)))
    if (d[a]! > 0) {
      step[a] = 1
      tNext[a] = tMin + ((g.min[a]! + (cellIdx[a]! + 1) * g.cell) - at(a)) / d[a]!
      tDelta[a] = g.cell / d[a]!
    } else if (d[a]! < 0) {
      step[a] = -1
      tNext[a] = tMin + ((g.min[a]! + cellIdx[a]! * g.cell) - at(a)) / d[a]!
      tDelta[a] = -g.cell / d[a]!
    } else {
      step[a] = 0
      tNext[a] = Infinity
      tDelta[a] = Infinity
    }
  }

  let best = Infinity
  let bestTri = -1
  for (;;) {
    const c = (cellIdx[2]! * g.dims[1]! + cellIdx[1]!) * g.dims[0]! + cellIdx[0]!
    for (let e = g.start[c]!; e < g.start[c + 1]!; e++) {
      const t = g.items[e]!
      const a = ix[t * 3]! * 3, b = ix[t * 3 + 1]! * 3, cc = ix[t * 3 + 2]! * 3
      const hit = rayTri(
        origin[0], origin[1], origin[2], d[0]!, d[1]!, d[2]!,
        p[a]!, p[a + 1]!, p[a + 2]!,
        p[b]!, p[b + 1]!, p[b + 2]!,
        p[cc]!, p[cc + 1]!, p[cc + 2]!,
      )
      if (hit >= 0 && hit < best) { best = hit; bestTri = t }
    }
    // A hit inside the current cell is final — no later cell can beat it.
    const advance = Math.min(tNext[0]!, tNext[1]!, tNext[2]!)
    if (bestTri >= 0 && best <= advance) break
    if (advance > tMax) break
    const axis = tNext[0]! <= tNext[1]! && tNext[0]! <= tNext[2]! ? 0 : tNext[1]! <= tNext[2]! ? 1 : 2
    cellIdx[axis] += step[axis]!
    if (cellIdx[axis]! < 0 || cellIdx[axis]! >= g.dims[axis]!) break
    tNext[axis] += tDelta[axis]!
  }

  return bestTri >= 0 ? { t: best, tri: bestTri } : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-tri-grid`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/voxel/triGrid.ts frontend/tests/unit/scene3d-tri-grid.unit.spec.ts
git commit -m "feat(scene3d): triangle bin grid with closest-point and DDA raycast"
```

---

## Task 7: Signed distance field and open-surface detection

**Files:**
- Create: `frontend/app/lib/scene3d/voxel/sdf.ts`
- Test: `frontend/tests/unit/scene3d-sdf.unit.spec.ts`

**Interfaces:**
- Consumes: `TriGrid`, `closestDistance` (Task 6).
- Produces:
  - `interface Lattice { min: [number,number,number]; dims: [number,number,number]; cell: number }`
  - `interface Sdf extends Lattice { values: Float32Array }`
  - `latticeFor(grid: TriGrid, resolution: number): Lattice`
  - `unionLattice(grids: TriGrid[], resolution: number): Lattice`
  - `buildSdf(grid: TriGrid, lattice: Lattice): { sdf: Sdf; open: boolean }`
  - `OPEN_INTERIOR_RATIO = 0.25`

**Why the lattice is a separate argument:** Task 16 has to sample several meshes
onto **one shared lattice** so their fields can be combined cell-by-cell. A
`buildSdf` that derived its own lattice per input would force a resampling step
between them and blur every merge. Splitting it out now costs nothing and saves
that later.

**Signing:** flood-fill the exterior inward from the lattice boundary; nodes the
fill never reaches are interior. No generalised winding numbers.

**Open detection:** compare the interior node count against the **surface band**
node count, not against total volume. For a genuinely open surface the fill
leaks inside and interior collapses to ~0 while the band stays large. Comparing
against total volume instead would misclassify a thin closed shell — exactly
what `solidify` produces — as open.

- [ ] **Step 1: Write the failing SDF test**

Create `frontend/tests/unit/scene3d-sdf.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { buildTriGrid } from '~/lib/scene3d/voxel/triGrid'
import { buildSdf, latticeFor } from '~/lib/scene3d/voxel/sdf'

const sdfOf = (geo: THREE.BufferGeometry, res = 48) => {
  const grid = buildTriGrid(meshDataFromGeometry(geo), 2 / res)
  return buildSdf(grid, latticeFor(grid, res))
}

const sample = (sdf: any, x: number, y: number, z: number) => {
  const i = Math.round((x - sdf.min[0]) / sdf.cell)
  const j = Math.round((y - sdf.min[1]) / sdf.cell)
  const k = Math.round((z - sdf.min[2]) / sdf.cell)
  return sdf.values[(k * sdf.dims[1] + j) * sdf.dims[0] + i]
}

describe('signed distance field', () => {
  it('signs a closed sphere: negative inside, positive outside', () => {
    const { sdf, open } = sdfOf(new THREE.SphereGeometry(0.5, 64, 48))
    expect(open).toBe(false)
    expect(sample(sdf, 0, 0, 0)).toBeLessThan(0)
    expect(sample(sdf, 0.9, 0, 0)).toBeGreaterThan(0)
  })

  it('signs a closed box', () => {
    const { sdf, open } = sdfOf(new THREE.BoxGeometry(1, 1, 1))
    expect(open).toBe(false)
    expect(sample(sdf, 0, 0, 0)).toBeLessThan(0)
  })

  it('detects an open plane rather than producing garbage', () => {
    const { open } = sdfOf(new THREE.PlaneGeometry(1, 1))
    expect(open).toBe(true)
  })

  it('detects an open-ended cylinder', () => {
    const { open } = sdfOf(new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1, true))
    expect(open).toBe(true)
  })

  it('detects a ring', () => {
    const { open } = sdfOf(new THREE.RingGeometry(0.22, 0.5, 48))
    expect(open).toBe(true)
  })

  it('does NOT call a thin closed shape open', () => {
    // A torus is closed but its interior is a small fraction of its bounding
    // box. An open test that compared interior against total VOLUME would call
    // this open; comparing against the surface band is what gets it right.
    // Same shape of case as a solidified plane (Task 9).
    const { open } = sdfOf(new THREE.TorusGeometry(0.4, 0.08, 24, 64), 64)
    expect(open).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-sdf`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildSdf`**

Create `frontend/app/lib/scene3d/voxel/sdf.ts`:

```ts
// Sample a mesh into a signed distance field on a lattice.
//
// Signing is by EXTERIOR FLOOD FILL, not by winding number: seed a queue with
// every boundary node, expand through 6-neighbours, and refuse to cross the
// surface band. Whatever the fill never reaches is inside. That is robust to
// the slightly-degenerate triangles real meshes carry, and needs no per-node
// ray casting.
import { closestDistance, type TriGrid } from './triGrid'
import { boundsOf } from './bounds'

export interface Lattice {
  min: [number, number, number]
  dims: [number, number, number]
  cell: number
}

export interface Sdf extends Lattice {
  /** Node (i,j,k) at (k * dims.y + j) * dims.x + i. Negative inside. */
  values: Float32Array
}

/** Interior nodes as a fraction of surface-band nodes, below which the input is
 *  treated as an open surface.
 *
 *  The comparison is against the BAND, not against total volume, and that
 *  choice is load-bearing. For a genuinely open surface the fill leaks inside
 *  and the interior count collapses to ~0 while the band stays large. Compared
 *  against total volume instead, a thin CLOSED shell — exactly what `solidify`
 *  produces, and what a torus already is — has a tiny interior too, and would
 *  be misclassified as open. */
export const OPEN_INTERIOR_RATIO = 0.25

/** Nodes of empty margin outside the mesh. Two, so the exterior fill always has
 *  a seed ring that no surface band can block, and surface nets has a cell of
 *  room beyond the outermost crossing. */
const PAD = 2

function latticeFrom(
  lo: [number, number, number], hi: [number, number, number], resolution: number,
): Lattice {
  const longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6)
  const cell = longest / resolution
  return {
    cell,
    min: [lo[0] - cell * PAD, lo[1] - cell * PAD, lo[2] - cell * PAD],
    dims: [
      Math.max(2, Math.ceil((hi[0] - lo[0]) / cell) + 2 * PAD + 1),
      Math.max(2, Math.ceil((hi[1] - lo[1]) / cell) + 2 * PAD + 1),
      Math.max(2, Math.ceil((hi[2] - lo[2]) / cell) + 2 * PAD + 1),
    ],
  }
}

export function latticeFor(grid: TriGrid, resolution: number): Lattice {
  const { lo, hi } = boundsOf(grid.data)
  return latticeFrom(lo, hi, resolution)
}

/** One lattice covering every input — what a merge samples all its meshes onto
 *  so their fields can be combined node-by-node with no resampling. */
export function unionLattice(grids: TriGrid[], resolution: number): Lattice {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const g of grids) {
    const b = boundsOf(g.data)
    for (let a = 0; a < 3; a++) {
      if (b.lo[a]! < lo[a]!) lo[a] = b.lo[a]!
      if (b.hi[a]! > hi[a]!) hi[a] = b.hi[a]!
    }
  }
  if (!Number.isFinite(lo[0])) return latticeFrom([0, 0, 0], [0, 0, 0], resolution)
  return latticeFrom(lo, hi, resolution)
}

const EXTERIOR = 1
const BAND = 2

export function buildSdf(grid: TriGrid, lattice: Lattice): { sdf: Sdf; open: boolean } {
  const { min, dims, cell } = lattice
  const [nx, ny, nz] = dims
  const total = nx * ny * nz
  const values = new Float32Array(total)
  const flags = new Uint8Array(total)

  // 1. Unsigned distance, exact only inside a narrow band. Surface nets never
  //    reads further than one cell from a crossing, so paying for exact
  //    distances across the whole volume would be pure waste.
  const FAR = cell * 3
  const bandCut = cell * 0.75
  let bandCount = 0
  for (let k = 0, idx = 0; k < nz; k++) {
    const z = min[2] + k * cell
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * cell
      for (let i = 0; i < nx; i++, idx++) {
        const d = closestDistance(grid, min[0] + i * cell, y, z, FAR)
        values[idx] = d
        if (d < bandCut) { flags[idx] = BAND; bandCount++ }
      }
    }
  }

  // 2. Exterior flood fill from the lattice boundary, blocked by the band.
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  const push = (idx: number): void => {
    if (flags[idx]! !== 0) return
    flags[idx] = EXTERIOR
    queue[tail++] = idx
  }
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) {
          push((k * ny + j) * nx + i)
        }
  while (head < tail) {
    const idx = queue[head++]!
    const i = idx % nx
    const j = ((idx / nx) | 0) % ny
    const k = (idx / (nx * ny)) | 0
    if (i > 0) push(idx - 1)
    if (i < nx - 1) push(idx + 1)
    if (j > 0) push(idx - nx)
    if (j < ny - 1) push(idx + nx)
    if (k > 0) push(idx - nx * ny)
    if (k < nz - 1) push(idx + nx * ny)
  }

  // 3. Open detection — see OPEN_INTERIOR_RATIO.
  let interior = 0
  for (let idx = 0; idx < total; idx++) if (flags[idx] === 0) interior++
  const open = bandCount === 0 || interior < OPEN_INTERIOR_RATIO * bandCount

  // 4. Sign. Band nodes were never reached by the fill and have no side of
  //    their own, so each takes the sign of its neighbours: exterior if any
  //    6-neighbour is exterior, interior otherwise. The band is ~1 node thick
  //    at a 0.75-cell cut, so one pass settles it — and because a band node's
  //    distance is near zero either way, a mis-signed one moves the
  //    interpolated surface by well under a cell.
  for (let idx = 0; idx < total; idx++) {
    if (flags[idx] === EXTERIOR) { values[idx] = values[idx]!; continue }
    if (flags[idx] === 0) { values[idx] = -values[idx]!; continue }
    const i = idx % nx
    const j = ((idx / nx) | 0) % ny
    const k = (idx / (nx * ny)) | 0
    const outside =
      (i > 0 && flags[idx - 1] === EXTERIOR)
      || (i < nx - 1 && flags[idx + 1] === EXTERIOR)
      || (j > 0 && flags[idx - nx] === EXTERIOR)
      || (j < ny - 1 && flags[idx + nx] === EXTERIOR)
      || (k > 0 && flags[idx - nx * ny] === EXTERIOR)
      || (k < nz - 1 && flags[idx + nx * ny] === EXTERIOR)
    values[idx] = outside ? values[idx]! : -values[idx]!
  }

  return { sdf: { values, min, dims, cell }, open }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-sdf`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/voxel/sdf.ts frontend/tests/unit/scene3d-sdf.unit.spec.ts
git commit -m "feat(scene3d): sign an SDF by exterior flood fill, detecting open surfaces"
```

---

## Task 8: Surface nets

**Files:**
- Create: `frontend/app/lib/scene3d/voxel/surfaceNets.ts`
- Modify: `frontend/app/lib/scene3d/voxel/index.ts` (create — the module's public face)
- Test: `frontend/tests/unit/scene3d-surface-nets.unit.spec.ts`

**Interfaces:**
- Consumes: `Sdf` (Task 7).
- Produces:
  - `surfaceNets(sdf: Sdf): MeshData`
  - from `voxel/index.ts`: `remesh(data: MeshData, resolution: number): { data: MeshData; open: boolean }`

**Why surface nets and not marching cubes:** naive surface nets places one
vertex per sign-changing cell and joins them into quads across the three axis
directions. There is no 256-case table, it produces well-conditioned uniform
triangles rather than marching cubes' slivers, and uniform triangles are exactly
what a sculpt brush needs.

- [ ] **Step 1: Write the failing meshing test**

Create `frontend/tests/unit/scene3d-surface-nets.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry, geometryFromMeshData } from '~/lib/scene3d/mesh'
import { remesh } from '~/lib/scene3d/voxel'

const volumeOf = (data: any) => {
  // Signed volume via the divergence theorem over the triangle soup.
  let v = 0
  const p = data.positions, ix = data.indices
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3
    v += (
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
    ) / 6
  }
  return Math.abs(v)
}

describe('remesh', () => {
  it('preserves a sphere\'s volume within grid tolerance', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    const { data, open } = remesh(src, 64)
    expect(open).toBe(false)
    const expected = (4 / 3) * Math.PI * 0.5 ** 3
    expect(volumeOf(data)).toBeGreaterThan(expected * 0.92)
    expect(volumeOf(data)).toBeLessThan(expected * 1.08)
  })

  it('preserves the bounding box within one cell', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    const { data } = remesh(src, 64)
    const geo = geometryFromMeshData(data)
    geo.computeBoundingBox()
    const b = geo.boundingBox!
    expect(b.max.x).toBeGreaterThan(0.45)
    expect(b.max.x).toBeLessThan(0.56)
  })

  it('produces a closed, indexed mesh', () => {
    const src = meshDataFromGeometry(new THREE.BoxGeometry(1, 1, 1))
    const { data } = remesh(src, 48)
    expect(data.indices.length % 3).toBe(0)
    expect(data.indices.length).toBeGreaterThan(0)
    // Every index addresses a real vertex.
    const n = data.positions.length / 3
    for (let i = 0; i < data.indices.length; i++) expect(data.indices[i]!).toBeLessThan(n)
  })

  it('refuses an open surface instead of meshing garbage', () => {
    const src = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1))
    expect(remesh(src, 48).open).toBe(true)
  })

  it('scales vertex count with resolution', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    const lo = remesh(src, 24).data.positions.length
    const hi = remesh(src, 64).data.positions.length
    expect(hi).toBeGreaterThan(lo * 2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-surface-nets`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement surface nets**

Create `frontend/app/lib/scene3d/voxel/surfaceNets.ts`:

```ts
// Naive surface nets: one vertex per sign-changing cell, quads across every
// sign-changing lattice edge.
//
// Chosen over marching cubes deliberately. There is no 256-case table to carry,
// and — the reason that actually matters here — it produces well-conditioned,
// roughly uniform triangles instead of marching cubes' slivers. Uniform
// triangles are exactly what a sculpt brush needs: a sliver stretches into
// garbage the moment you push on it.
import type { MeshData } from '~/lib/scene3d/mesh'
import type { Sdf } from './sdf'

/** The 12 cell edges as pairs of corner indices, corner c being
 *  (c & 1, (c >> 1) & 1, (c >> 2) & 1) offset from the cell's minimum node. */
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
]

export function surfaceNets(sdf: Sdf): MeshData {
  const { values, dims, cell, min } = sdf
  const [nx, ny, nz] = dims
  const cx = nx - 1, cy = ny - 1, cz = nz - 1
  if (cx < 1 || cy < 1 || cz < 1) return { positions: new Float32Array(0), indices: new Uint32Array(0) }

  const nodeAt = (i: number, j: number, k: number): number => (k * ny + j) * nx + i
  const cellAt = (i: number, j: number, k: number): number => (k * cy + j) * cx + i

  // --- pass 1: one vertex per sign-changing cell ------------------------------
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1)
  const positions: number[] = []
  const corner = new Float64Array(8)

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const v = values[nodeAt(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]!
          corner[c] = v
          if (v < 0) mask |= 1 << c
        }
        if (mask === 0 || mask === 0xff) continue // no crossing

        // Average the zero crossings on every edge that changes sign.
        let sx = 0, sy = 0, sz = 0, n = 0
        for (const [a, b] of EDGES) {
          const va = corner[a]!, vb = corner[b]!
          if ((va < 0) === (vb < 0)) continue
          const t = va / (va - vb) // where along a->b the field hits zero
          const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1
          const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1
          sx += ax + (bx - ax) * t
          sy += ay + (by - ay) * t
          sz += az + (bz - az) * t
          n++
        }
        if (n === 0) continue

        cellVertex[cellAt(i, j, k)] = positions.length / 3
        positions.push(
          min[0] + (i + sx / n) * cell,
          min[1] + (j + sy / n) * cell,
          min[2] + (k + sz / n) * cell,
        )
      }
    }
  }

  // --- pass 2: a quad per sign-changing lattice edge ---------------------------
  // Each interior lattice edge is shared by exactly 4 cells. Walking them in a
  // consistent loop around the edge's axis gives counter-clockwise winding seen
  // from the axis's positive direction; when the field goes negative->positive
  // along the edge the outward normal points that way too, so the loop is
  // already front-facing. Otherwise it is reversed.
  const indices: number[] = []
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) indices.push(a, c, b, a, d, c)
    else indices.push(a, b, c, a, c, d)
  }

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const here = values[nodeAt(i, j, k)]!
        const inside = here < 0

        // edge along +x — the 4 cells sharing it vary in y and z
        if (i < nx - 1 && j > 0 && k > 0) {
          const there = values[nodeAt(i + 1, j, k)]!
          if (inside !== (there < 0)) {
            quad(
              cellVertex[cellAt(i, j - 1, k - 1)]!,
              cellVertex[cellAt(i, j, k - 1)]!,
              cellVertex[cellAt(i, j, k)]!,
              cellVertex[cellAt(i, j - 1, k)]!,
              !inside,
            )
          }
        }
        // edge along +y — cells vary in z and x
        if (j < ny - 1 && i > 0 && k > 0) {
          const there = values[nodeAt(i, j + 1, k)]!
          if (inside !== (there < 0)) {
            quad(
              cellVertex[cellAt(i - 1, j, k - 1)]!,
              cellVertex[cellAt(i - 1, j, k)]!,
              cellVertex[cellAt(i, j, k)]!,
              cellVertex[cellAt(i, j, k - 1)]!,
              !inside,
            )
          }
        }
        // edge along +z — cells vary in x and y
        if (k < nz - 1 && i > 0 && j > 0) {
          const there = values[nodeAt(i, j, k + 1)]!
          if (inside !== (there < 0)) {
            quad(
              cellVertex[cellAt(i - 1, j - 1, k)]!,
              cellVertex[cellAt(i, j - 1, k)]!,
              cellVertex[cellAt(i, j, k)]!,
              cellVertex[cellAt(i - 1, j, k)]!,
              !inside,
            )
          }
        }
      }
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}
```

**CORRECTION (found in review, 2026-08-04):** the quad blocks above lower-bound
the two off-axis coordinates (`j > 0 && k > 0`) but must ALSO upper-bound them
(`j < ny - 1 && k < nz - 1`, and the analogous pair per axis). Without it
`cellAt` reads out of range; a typed-array OOB read returns `undefined`, and
`undefined < 0` is `false`, so `quad()`'s `-1` sentinel does NOT catch it — the
`undefined` coerces to `0` and emits degenerate triangles pinned to vertex 0.
`PAD = 2` masks this for anything built through `buildSdf`, but `surfaceNets` is
publicly exported. The shipped code has the guards; this block does not.

**If the volume test in Step 1 comes back inverted or the mesh renders
inside-out, the `flip` argument is the thing to check first** — the winding rule
is the one part of this that cannot be read off the maths, and getting it
backwards still produces a plausible-looking mesh.

- [ ] **Step 4: Create the module's public face**

Create `frontend/app/lib/scene3d/voxel/index.ts`:

```ts
// mesh -> signed distance grid -> surface nets -> mesh.
//
// One module, three consumers: the Remesh action, the Merge action, and the
// sculpt brush's ray picking (which uses the triangle grid this builds on the
// way in). Built once and passed around rather than rebuilt per use.
export type { TriGrid } from './triGrid'
export { buildTriGrid, closestDistance, raycastGrid } from './triGrid'
export type { Sdf, Lattice } from './sdf'
export { buildSdf, latticeFor, unionLattice, OPEN_INTERIOR_RATIO } from './sdf'
export { surfaceNets } from './surfaceNets'
export { boundsOf, cellFor } from './bounds'

import type { MeshData } from '~/lib/scene3d/mesh'
import { buildTriGrid } from './triGrid'
import { buildSdf, latticeFor } from './sdf'
import { surfaceNets } from './surfaceNets'
import { cellFor } from './bounds'

/** Rebuild `data` as a uniform-density mesh at `resolution` cells along its
 *  longest axis. `open: true` means the input is not a closed surface and the
 *  result is meaningless — the caller must refuse and offer Solidify instead of
 *  showing it, and `data` comes back UNCHANGED so a careless caller cannot
 *  accidentally commit a mangled mesh. */
export function remesh(data: MeshData, resolution: number): { data: MeshData; open: boolean } {
  const grid = buildTriGrid(data, cellFor(data, resolution))
  const { sdf, open } = buildSdf(grid, latticeFor(grid, resolution))
  if (open) return { data, open: true }
  return { data: surfaceNets(sdf), open: false }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-surface-nets`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/scene3d/voxel/ frontend/tests/unit/scene3d-surface-nets.unit.spec.ts
git commit -m "feat(scene3d): surface-nets remeshing over the signed distance field"
```

---

## Task 9: Remesh and Solidify in the studio

**Files:**
- Create: `frontend/app/lib/scene3d/voxel/solidify.ts`
- Modify: `frontend/app/lib/scene3d/toMesh.ts` (add `remeshObject`)
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`
- Test: `frontend/tests/unit/scene3d-remesh-action.unit.spec.ts`

**Interfaces:**
- Consumes: `remesh` (Task 8), `convertToMesh` (Task 5), `MESH_VERTEX_CAP`/`MESH_DEFAULT_TARGET` (Task 1).
- Produces:
  - `solidify(data: MeshData, thickness: number): MeshData`
  - `remeshObject(obj: PrimitiveObject, resolution: number): Promise<{ obj: PrimitiveObject; open: boolean; vertexCount: number }>`
  - `resolutionForTarget(data: MeshData, targetVertices: number): number`
  - `solidifyObject(obj: PrimitiveObject, thickness: number): Promise<PrimitiveObject>`

- [ ] **Step 1: Write the failing action test**

Create `frontend/tests/unit/scene3d-remesh-action.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  encodeMesh, meshDataFromGeometry, contentDigest,
  MESH_VERTEX_CAP, MESH_DEFAULT_TARGET,
} from '~/lib/scene3d/mesh'
import { remesh } from '~/lib/scene3d/voxel'
import { solidify } from '~/lib/scene3d/voxel/solidify'
import { remeshObject, resolutionForTarget } from '~/lib/scene3d/toMesh'
import type { PrimitiveObject } from '~/lib/scene3d/config'

const meshObject = async (geo: THREE.BufferGeometry): Promise<PrimitiveObject> => {
  const encoded = await encodeMesh(meshDataFromGeometry(geo))
  return {
    id: 'm1', name: 'M', visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: {} as any, kind: 'primitive', primitive: 'mesh',
    content: { mesh: encoded, meshKey: contentDigest(encoded) },
  }
}

describe('remesh action', () => {
  it('resolutionForTarget lands near the requested vertex count', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    const res = resolutionForTarget(src, MESH_DEFAULT_TARGET)
    const got = remesh(src, res).data.positions.length / 3
    expect(got).toBeGreaterThan(MESH_DEFAULT_TARGET * 0.65)
    expect(got).toBeLessThan(MESH_DEFAULT_TARGET * 1.35)
  })

  it('resolutionForTarget scales with the target', () => {
    const src = meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48))
    expect(resolutionForTarget(src, 20_000)).toBeGreaterThan(resolutionForTarget(src, 5_000))
  })

  it('remeshes a closed object into a different buffer', async () => {
    const obj = await meshObject(new THREE.SphereGeometry(0.5, 64, 48))
    const before = obj.content!.meshKey
    const out = await remeshObject(obj, 48)
    expect(out.open).toBe(false)
    expect(out.obj.content!.meshKey).not.toBe(before)
    expect(out.obj.content!.meshKey).toBe(contentDigest(out.obj.content!.mesh!))
  })

  it('refuses an open object and leaves its buffer untouched', async () => {
    const obj = await meshObject(new THREE.PlaneGeometry(1, 1))
    const before = obj.content!.mesh
    const out = await remeshObject(obj, 48)
    expect(out.open).toBe(true)
    expect(out.obj.content!.mesh).toBe(before)
  })

  it('solidify closes an open surface so it can then be remeshed', () => {
    const plane = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1, 8, 8))
    expect(remesh(plane, 48).open).toBe(true)
    const shell = solidify(plane, 0.05)
    expect(remesh(shell, 64).open).toBe(false)
  })

  it('solidify roughly doubles the triangle count plus a rim', () => {
    const plane = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1, 8, 8))
    const shell = solidify(plane, 0.05)
    expect(shell.indices.length).toBeGreaterThan(plane.indices.length * 2)
    expect(shell.positions.length).toBe(plane.positions.length * 2)
  })

  it('retries at a lower resolution rather than throwing over the cap', async () => {
    const obj = await meshObject(new THREE.SphereGeometry(0.5, 64, 48))
    // 256 would produce far more than MESH_VERTEX_CAP vertices.
    const out = await remeshObject(obj, 256)
    expect(out.open).toBe(false)
    expect(out.vertexCount).toBeLessThanOrEqual(MESH_VERTEX_CAP)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-remesh-action`
Expected: FAIL — `remeshObject is not exported`.

- [ ] **Step 3: Implement `solidify`**

Create `frontend/app/lib/scene3d/voxel/solidify.ts`:

```ts
// Turn an OPEN surface into a closed shell, so it has an inside for buildSdf's
// flood fill to find. Two offset copies along the vertex normals, the inner one
// wound backwards, stitched along the boundary.
import type { MeshData } from '~/lib/scene3d/mesh'

/** Area-weighted vertex normals — the same quantity three's computeVertexNormals
 *  produces, computed here so this module stays free of a THREE import. */
function vertexNormals(data: MeshData): Float32Array {
  const p = data.positions
  const ix = data.indices
  const n = new Float32Array(p.length)
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!
    // Unnormalised cross product — its length IS twice the triangle area, which
    // is the weighting we want.
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    for (const o of [a, b, c]) { n[o] += fx; n[o + 1] += fy; n[o + 2] += fz }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1
    n[i] /= len; n[i + 1] /= len; n[i + 2] /= len
  }
  return n
}

export function solidify(data: MeshData, thickness: number): MeshData {
  const p = data.positions
  const ix = data.indices
  const vCount = p.length / 3
  const half = thickness / 2
  const nrm = vertexNormals(data)

  // Outer shell occupies [0, vCount), inner shell [vCount, 2*vCount).
  const positions = new Float32Array(p.length * 2)
  for (let i = 0; i < p.length; i += 3) {
    positions[i] = p[i]! + nrm[i]! * half
    positions[i + 1] = p[i + 1]! + nrm[i + 1]! * half
    positions[i + 2] = p[i + 2]! + nrm[i + 2]! * half
    const j = p.length + i
    positions[j] = p[i]! - nrm[i]! * half
    positions[j + 1] = p[i + 1]! - nrm[i + 1]! * half
    positions[j + 2] = p[i + 2]! - nrm[i + 2]! * half
  }

  const indices: number[] = []
  // Outer shell keeps its winding; inner shell is reversed so it faces inward.
  for (let t = 0; t < ix.length; t += 3) {
    indices.push(ix[t]!, ix[t + 1]!, ix[t + 2]!)
    indices.push(vCount + ix[t + 2]!, vCount + ix[t + 1]!, vCount + ix[t]!)
  }

  // Boundary = a directed edge whose reverse never appears. Those are the only
  // edges with one adjacent triangle, and they are exactly the rim to stitch.
  const seen = new Set<number>()
  const key = (a: number, b: number) => a * vCount + b
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]!, b = ix[t + 1]!, c = ix[t + 2]!
    seen.add(key(a, b)); seen.add(key(b, c)); seen.add(key(c, a))
  }
  for (let t = 0; t < ix.length; t += 3) {
    const tri = [ix[t]!, ix[t + 1]!, ix[t + 2]!]
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!, b = tri[(e + 1) % 3]!
      if (seen.has(key(b, a))) continue // interior edge — shared with a neighbour
      // Rim quad from the outer edge down to its inner twin.
      indices.push(a, vCount + a, vCount + b)
      indices.push(a, vCount + b, b)
    }
  }

  return { positions, indices: new Uint32Array(indices) }
}
```

- [ ] **Step 4: Implement `remeshObject`, `solidifyObject` and `resolutionForTarget`**

Add to `frontend/app/lib/scene3d/toMesh.ts`:

```ts
import { remesh } from '~/lib/scene3d/voxel'
import { solidify } from '~/lib/scene3d/voxel/solidify'
import { decodeMesh, encodeMesh, MESH_VERTEX_CAP, type MeshData } from '~/lib/scene3d/mesh'

/** A resolution that lands near `targetVertices`.
 *
 *  Surface nets emits roughly one vertex per sign-changing cell, so the count
 *  scales with surface area over cell squared — i.e. with resolution squared.
 *  One cheap probe at a coarse resolution therefore pins the constant, and the
 *  answer is a scale by sqrt(target / probed). Far cheaper than bisecting with
 *  a full remesh per step. */
export function resolutionForTarget(data: MeshData, targetVertices: number): number {
  const PROBE = 24
  const probed = remesh(data, PROBE).data.positions.length / 3
  if (probed <= 0) return PROBE
  const scaled = PROBE * Math.sqrt(targetVertices / probed)
  return Math.max(8, Math.min(160, Math.round(scaled)))
}

const contentFor = async (data: MeshData) => {
  const mesh = await encodeMesh(data)
  return { mesh, meshKey: contentDigest(mesh) }
}

/** Rebuild the object's mesh at `resolution`.
 *
 *  Over the vertex cap, this retries at three-quarter resolution rather than
 *  throwing (up to 4 attempts): the user asked for a shape, not an error, and a
 *  slightly coarser shape is a far better answer than a failure toast. `open`
 *  returns the object UNCHANGED — see `remesh`. */
export async function remeshObject(
  obj: PrimitiveObject, resolution: number,
): Promise<{ obj: PrimitiveObject; open: boolean; vertexCount: number }> {
  const encoded = obj.content?.mesh
  if (!encoded) return { obj, open: false, vertexCount: 0 }
  const src = await decodeMesh(encoded)

  let res = resolution
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, open } = remesh(src, res)
    if (open) return { obj, open: true, vertexCount: src.positions.length / 3 }
    const count = data.positions.length / 3
    if (count <= MESH_VERTEX_CAP) {
      return {
        obj: { ...obj, content: { ...obj.content, ...(await contentFor(data)) } },
        open: false,
        vertexCount: count,
      }
    }
    res = Math.max(8, Math.round(res * 0.75))
  }
  // Four attempts at shrinking resolution and still over cap — the last resort
  // is the coarse floor, which cannot exceed the cap for any plausible shape.
  const { data } = remesh(src, 8)
  return {
    obj: { ...obj, content: { ...obj.content, ...(await contentFor(data)) } },
    open: false,
    vertexCount: data.positions.length / 3,
  }
}

/** Thicken an open surface into a closed shell so it can be remeshed. */
export async function solidifyObject(
  obj: PrimitiveObject, thickness: number,
): Promise<PrimitiveObject> {
  const encoded = obj.content?.mesh
  if (!encoded) return obj
  const shell = solidify(await decodeMesh(encoded), thickness)
  return { ...obj, content: { ...obj.content, ...(await contentFor(shell)) } }
}
```


- [ ] **Step 5: Add the Remesh control to the panel**

In the Geometry panel section of `Scene3DStudioSurface.vue`, when the selected
object is a `mesh` primitive, render in place of the (empty) parameter list:

- a **Resolution** slider, 16–128, defaulting to `resolutionForTarget(…, MESH_DEFAULT_TARGET)`
- live text: `{{ meshVertexCount }} vertices · {{ meshEncodedKB }} KB` — the
  spec requires the cost never be invisible
- a **Remesh** button
- when a remesh returns `open: true`, an inline notice replacing the button:
  *"This shape is open, so it has no inside to rebuild. Give it a thickness
  first."* plus a Thickness slider (0.005–0.2) and a **Solidify** button

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-remesh-action`
Expected: PASS.

- [ ] **Step 7: Live check**

Convert a sphere to mesh, remesh at 32 and at 96 — the reported vertex count and
KB should move accordingly and the shape should stay recognisably a sphere.
Convert a **plane** to mesh and hit Remesh — it must show the open notice, not a
mangled shape. Solidify it, then Remesh — it should now succeed.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/scene3d/voxel/solidify.ts frontend/app/lib/scene3d/toMesh.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/tests/unit/scene3d-remesh-action.unit.spec.ts
git commit -m "feat(scene3d): Remesh and Solidify actions for mesh objects"
```

**Phase 2 is complete and shippable here.** Confirm the §8 storage budget now:
remesh a few objects at the 20k default, save, and check the real `scene_state`
length against the ~70KB-per-sculpt figure before starting phase 3.

---

# Phase 3 — Sculpt mode

## Task 10: Sculpt session — working buffer, spatial hash, undo

**Files:**
- Create: `frontend/app/lib/scene3d/sculpt/session.ts`
- Test: `frontend/tests/unit/scene3d-sculpt-session.unit.spec.ts`

**Interfaces:**
- Consumes: `MeshData`, `encodeMesh`, `contentDigest` (Task 1); `buildTriGrid`, `raycastGrid` (Task 6).
- Produces:
  - `class SculptSession` with `constructor(data: MeshData)`, `positions: Float32Array`, `indices: Uint32Array`, `verticesNear(x,y,z,radius): Int32Array`, `beginStroke()`, `recordVertex(i)`, `endStroke()`, `undo(): boolean`, `pick(origin, dir)`, `recomputeNormals()`, `toMeshData(): MeshData`, `commit(): Promise<{ mesh: string; meshKey: string }>`, `dirty: boolean`
  - `UNDO_DEPTH = 32`

**The rule this class exists to enforce:** a stroke mutates `positions` in place
and touches nothing else. Encoding back into the document happens only in
`commit()`. Writing `scene_state` per stroke would drive ~70KB of base64 through
the persistence recency guard and the 409 stale-write path on every pointer
move.

- [ ] **Step 1: Write the failing session test**

Create `frontend/tests/unit/scene3d-sculpt-session.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry, contentDigest } from '~/lib/scene3d/mesh'
import { SculptSession, UNDO_DEPTH } from '~/lib/scene3d/sculpt/session'

const session = () =>
  new SculptSession(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 48, 32)))

/** Nudge every vertex the session reports near a point, recording as we go. */
const nudge = (s: SculptSession, x: number, y: number, z: number, r: number, dy: number) => {
  const hits = s.verticesNear(x, y, z, r)
  for (let n = 0; n < hits.length; n++) {
    const i = hits[n]!
    s.recordVertex(i)
    s.positions[i * 3 + 1] += dy
  }
  return hits.length
}

describe('sculpt session', () => {
  it('finds only vertices inside the radius, and more as it grows', () => {
    const s = session()
    const small = s.verticesNear(0, 0.5, 0, 0.1)
    const large = s.verticesNear(0, 0.5, 0, 0.3)
    expect(small.length).toBeGreaterThan(0)
    expect(large.length).toBeGreaterThan(small.length)
    for (let n = 0; n < small.length; n++) {
      const i = small[n]!
      const d = Math.hypot(
        s.positions[i * 3]! - 0, s.positions[i * 3 + 1]! - 0.5, s.positions[i * 3 + 2]! - 0,
      )
      expect(d).toBeLessThanOrEqual(0.1 + 1e-6)
    }
  })

  it('undo restores the exact prior positions', () => {
    const s = session()
    const before = s.positions.slice()
    s.beginStroke()
    expect(nudge(s, 0, 0.5, 0, 0.2, 0.05)).toBeGreaterThan(0)
    s.endStroke()
    expect(s.positions).not.toEqual(before)
    expect(s.undo()).toBe(true)
    expect(s.positions).toEqual(before) // exact, not approximate
  })

  it('records each vertex once per stroke, so undo survives repeated passes', () => {
    // A stroke drags across the same vertices many times. If recordVertex
    // overwrote the snapshot each pass, undo would restore a MID-stroke state.
    const s = session()
    const before = s.positions.slice()
    s.beginStroke()
    nudge(s, 0, 0.5, 0, 0.2, 0.02)
    nudge(s, 0, 0.5, 0, 0.2, 0.02)
    nudge(s, 0, 0.5, 0, 0.2, 0.02)
    s.endStroke()
    expect(s.undo()).toBe(true)
    expect(s.positions).toEqual(before)
  })

  it('undoes strokes one at a time, most recent first', () => {
    const s = session()
    const before = s.positions.slice()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    const afterFirst = s.positions.slice()
    s.beginStroke(); nudge(s, 0.5, 0, 0, 0.2, 0.05); s.endStroke()
    expect(s.undo()).toBe(true)
    expect(s.positions).toEqual(afterFirst)
    expect(s.undo()).toBe(true)
    expect(s.positions).toEqual(before)
    expect(s.undo()).toBe(false) // nothing left
  })

  it('keeps at most UNDO_DEPTH strokes', () => {
    const s = session()
    for (let n = 0; n < UNDO_DEPTH + 5; n++) {
      s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.001); s.endStroke()
    }
    let undone = 0
    while (s.undo()) undone++
    expect(undone).toBe(UNDO_DEPTH)
  })

  it('tracks dirty across strokes and commit', async () => {
    const s = session()
    expect(s.dirty).toBe(false)
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    expect(s.dirty).toBe(true)
    await s.commit()
    expect(s.dirty).toBe(false)
  })

  it('commit returns a payload whose digest matches', async () => {
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    const { mesh, meshKey } = await s.commit()
    expect(meshKey).toBe(contentDigest(mesh))
  })

  it('picks a ray aimed at the surface and misses one that is not', () => {
    const s = session()
    const hit = s.pick([0, 3, 0], [0, -1, 0])
    expect(hit).not.toBeNull()
    expect(hit!.point[1]).toBeCloseTo(0.5, 1)
    expect(s.pick([0, 3, 0], [0, 1, 0])).toBeNull() // pointing away
  })

  it('re-picks correctly after a stroke moved the surface', () => {
    // The pick structure is rebuilt on endStroke. Without that, the brush keeps
    // hitting where the surface USED to be and strokes drift off the shape.
    const s = session()
    const before = s.pick([0, 3, 0], [0, -1, 0])!
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.25, 0.2); s.endStroke()
    const after = s.pick([0, 3, 0], [0, -1, 0])!
    expect(after.point[1]).toBeGreaterThan(before.point[1] + 0.1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-sculpt-session`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the session**

Create `frontend/app/lib/scene3d/sculpt/session.ts`:

```ts
// The live state of a sculpt: a mutable vertex buffer, the queries a brush runs
// against it, and per-stroke undo.
//
// THE RULE THIS CLASS EXISTS TO ENFORCE: a stroke mutates `positions` and
// nothing else. Encoding back into the document happens only in commit().
// Writing scene_state per stroke would push ~70KB of base64 through the
// persistence recency guard and the 409 stale-write path on every pointermove.
import { encodeMesh, contentDigest, type MeshData } from '~/lib/scene3d/mesh'
import { buildTriGrid, raycastGrid, type TriGrid } from '~/lib/scene3d/voxel/triGrid'

/** Strokes kept for undo. Each entry holds only the vertices its stroke
 *  touched, so depth costs far less than 32 mesh copies. */
export const UNDO_DEPTH = 32

export class SculptSession {
  /** The working buffer. Brushes write here directly. */
  readonly positions: Float32Array
  /** Shared by reference — topology never changes during a session. */
  readonly indices: Uint32Array
  /** Recomputed once per endStroke, never per pointermove. */
  normals: Float32Array

  dirty = false

  private grid: TriGrid
  private hashCell = 0.1
  private hashDims: [number, number, number] = [1, 1, 1]
  private hashMin: [number, number, number] = [0, 0, 0]
  private hashStart = new Int32Array(1)
  private hashItems = new Int32Array(0)

  private stroke: Map<number, number> | null = null
  private strokeSnapshot: number[] = []
  private undoStack: { indices: Int32Array; values: Float32Array }[] = []

  constructor(data: MeshData) {
    this.positions = data.positions.slice()
    this.indices = data.indices
    this.normals = new Float32Array(this.positions.length)
    // Placeholder so `grid` is assigned before rebuildAcceleration replaces it
    // with one sized from the real vertex spacing.
    this.grid = buildTriGrid({ positions: this.positions, indices: this.indices }, 0.05)
    this.recomputeNormals() // pick() reads these, so they must exist before the first stroke
    this.rebuildAcceleration()
  }

  // --- queries ---------------------------------------------------------------

  /** Vertex indices within `radius` of a point. Reads the spatial hash, so this
   *  is the query a brush can afford to run on every pointermove. */
  verticesNear(x: number, y: number, z: number, radius: number): Int32Array {
    const out: number[] = []
    const r2 = radius * radius
    const lo = [0, 0, 0]
    const hi = [0, 0, 0]
    const q = [x, y, z]
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.max(0, Math.floor((q[a]! - radius - this.hashMin[a]!) / this.hashCell))
      hi[a] = Math.min(this.hashDims[a]! - 1, Math.floor((q[a]! + radius - this.hashMin[a]!) / this.hashCell))
    }
    for (let k = lo[2]!; k <= hi[2]!; k++)
      for (let j = lo[1]!; j <= hi[1]!; j++)
        for (let i = lo[0]!; i <= hi[0]!; i++) {
          const c = (k * this.hashDims[1]! + j) * this.hashDims[0]! + i
          for (let e = this.hashStart[c]!; e < this.hashStart[c + 1]!; e++) {
            const v = this.hashItems[e]!
            const dx = this.positions[v * 3]! - x
            const dy = this.positions[v * 3 + 1]! - y
            const dz = this.positions[v * 3 + 2]! - z
            if (dx * dx + dy * dy + dz * dz <= r2) out.push(v)
          }
        }
    return Int32Array.from(out)
  }

  /** Nearest surface hit along a ray, in the mesh's own object space. */
  pick(
    origin: [number, number, number], dir: [number, number, number],
  ): { point: [number, number, number]; normal: [number, number, number] } | null {
    const hit = raycastGrid(this.grid, origin, dir)
    if (!hit) return null
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const point: [number, number, number] = [
      origin[0] + (dir[0] / len) * hit.t,
      origin[1] + (dir[1] / len) * hit.t,
      origin[2] + (dir[2] / len) * hit.t,
    ]
    const t = hit.tri * 3
    const a = this.indices[t]!, b = this.indices[t + 1]!, c = this.indices[t + 2]!
    const nx = (this.normals[a * 3]! + this.normals[b * 3]! + this.normals[c * 3]!) / 3
    const ny = (this.normals[a * 3 + 1]! + this.normals[b * 3 + 1]! + this.normals[c * 3 + 1]!) / 3
    const nz = (this.normals[a * 3 + 2]! + this.normals[b * 3 + 2]! + this.normals[c * 3 + 2]!) / 3
    const nl = Math.hypot(nx, ny, nz) || 1
    return { point, normal: [nx / nl, ny / nl, nz / nl] }
  }

  /** Neighbour vertices of `v`, for the smooth brush. Built lazily on first use
   *  and reused for the session's lifetime — topology never changes. */
  neighboursOf(v: number): Int32Array {
    if (!this.adjacency) this.buildAdjacency()
    const s = this.adjStart![v]!
    return this.adjacency!.subarray(s, this.adjStart![v + 1]!)
  }

  private adjacency: Int32Array | null = null
  private adjStart: Int32Array | null = null

  private buildAdjacency(): void {
    const vCount = this.positions.length / 3
    const counts = new Int32Array(vCount + 1)
    const bump = (a: number) => { counts[a + 1]++ }
    for (let t = 0; t < this.indices.length; t += 3) {
      const a = this.indices[t]!, b = this.indices[t + 1]!, c = this.indices[t + 2]!
      bump(a); bump(a); bump(b); bump(b); bump(c); bump(c)
    }
    const start = new Int32Array(vCount + 1)
    for (let v = 0; v < vCount; v++) start[v + 1] = start[v]! + counts[v + 1]!
    const items = new Int32Array(start[vCount]!)
    const cursor = new Int32Array(vCount)
    const put = (a: number, b: number) => { items[start[a]! + cursor[a]!++] = b }
    for (let t = 0; t < this.indices.length; t += 3) {
      const a = this.indices[t]!, b = this.indices[t + 1]!, c = this.indices[t + 2]!
      put(a, b); put(a, c); put(b, a); put(b, c); put(c, a); put(c, b)
    }
    this.adjacency = items
    this.adjStart = start
  }

  // --- strokes ---------------------------------------------------------------

  beginStroke(): void {
    this.stroke = new Map()
    this.strokeSnapshot = []
  }

  /** Snapshot a vertex before a brush moves it. Only the FIRST call per stroke
   *  stores anything — a stroke drags across the same vertices repeatedly, and
   *  overwriting the snapshot each pass would make undo restore a mid-stroke
   *  state rather than the state before the stroke began. */
  recordVertex(v: number): void {
    if (!this.stroke || this.stroke.has(v)) return
    this.stroke.set(v, this.strokeSnapshot.length / 3)
    this.strokeSnapshot.push(
      this.positions[v * 3]!, this.positions[v * 3 + 1]!, this.positions[v * 3 + 2]!,
    )
  }

  endStroke(): void {
    if (!this.stroke) return
    if (this.stroke.size > 0) {
      this.undoStack.push({
        indices: Int32Array.from(this.stroke.keys()),
        values: Float32Array.from(this.strokeSnapshot),
      })
      if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift()
      this.dirty = true
    }
    this.stroke = null
    this.strokeSnapshot = []
    this.recomputeNormals()
    this.rebuildAcceleration()
  }

  undo(): boolean {
    const last = this.undoStack.pop()
    if (!last) return false
    for (let n = 0; n < last.indices.length; n++) {
      const v = last.indices[n]!
      this.positions[v * 3] = last.values[n * 3]!
      this.positions[v * 3 + 1] = last.values[n * 3 + 1]!
      this.positions[v * 3 + 2] = last.values[n * 3 + 2]!
    }
    this.dirty = this.undoStack.length > 0
    this.recomputeNormals()
    this.rebuildAcceleration()
    return true
  }

  // --- maintenance -----------------------------------------------------------

  /** Once per stroke end. Per-pointermove would dominate the frame. */
  recomputeNormals(): void {
    const n = this.normals
    n.fill(0)
    const p = this.positions
    for (let t = 0; t < this.indices.length; t += 3) {
      const a = this.indices[t]! * 3, b = this.indices[t + 1]! * 3, c = this.indices[t + 2]! * 3
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!
      const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
      for (const o of [a, b, c]) { n[o] += fx; n[o + 1] += fy; n[o + 2] += fz }
    }
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1
      n[i] /= len; n[i + 1] /= len; n[i + 2] /= len
    }
  }

  /** Rebuild the vertex hash and the pick grid against the CURRENT positions.
   *  Runs on stroke end, not per pointermove: skip it and the brush keeps
   *  picking where the surface used to be, so strokes drift off the shape. */
  private rebuildAcceleration(): void {
    const p = this.positions
    const vCount = p.length / 3
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.length; i++) {
      const a = i % 3, v = p[i]!
      if (v < lo[a]!) lo[a] = v
      if (v > hi[a]!) hi[a] = v
    }
    if (!Number.isFinite(lo[0])) { lo[0] = lo[1] = lo[2] = 0; hi[0] = hi[1] = hi[2] = 0 }

    // ~8 vertices per cell on average keeps the near-query cheap without
    // exploding the cell count.
    const extent = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!, 1e-6)
    const perAxis = Math.max(1, Math.round(Math.cbrt(vCount / 8)))
    this.hashCell = extent / perAxis
    this.hashMin = [lo[0]! - this.hashCell, lo[1]! - this.hashCell, lo[2]! - this.hashCell]
    this.hashDims = [0, 1, 2].map((a) =>
      Math.max(1, Math.ceil((hi[a]! - lo[a]!) / this.hashCell) + 3)) as [number, number, number]

    const cellCount = this.hashDims[0] * this.hashDims[1] * this.hashDims[2]
    const cellOf = (v: number): number => {
      const i = Math.min(this.hashDims[0] - 1, Math.max(0, Math.floor((p[v * 3]! - this.hashMin[0]) / this.hashCell)))
      const j = Math.min(this.hashDims[1] - 1, Math.max(0, Math.floor((p[v * 3 + 1]! - this.hashMin[1]) / this.hashCell)))
      const k = Math.min(this.hashDims[2] - 1, Math.max(0, Math.floor((p[v * 3 + 2]! - this.hashMin[2]) / this.hashCell)))
      return (k * this.hashDims[1] + j) * this.hashDims[0] + i
    }
    const counts = new Int32Array(cellCount + 1)
    for (let v = 0; v < vCount; v++) counts[cellOf(v) + 1]++
    const start = new Int32Array(cellCount + 1)
    for (let c = 0; c < cellCount; c++) start[c + 1] = start[c]! + counts[c + 1]!
    const items = new Int32Array(start[cellCount]!)
    const cursor = new Int32Array(cellCount)
    for (let v = 0; v < vCount; v++) { const c = cellOf(v); items[start[c]! + cursor[c]!++] = v }
    this.hashStart = start
    this.hashItems = items

    this.grid = buildTriGrid({ positions: p, indices: this.indices }, Math.max(this.hashCell, 1e-4))
  }

  // --- commit ----------------------------------------------------------------

  toMeshData(): MeshData {
    return { positions: this.positions.slice(), indices: this.indices }
  }

  /** The ONLY place the session produces document-shaped data. */
  async commit(): Promise<{ mesh: string; meshKey: string }> {
    const mesh = await encodeMesh(this.toMeshData())
    this.dirty = false
    return { mesh, meshKey: contentDigest(mesh) }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-sculpt-session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/sculpt/session.ts frontend/tests/unit/scene3d-sculpt-session.unit.spec.ts
git commit -m "feat(scene3d): sculpt session with a working buffer and per-stroke undo"
```

---

## Task 11: The core four brushes

**Files:**
- Create: `frontend/app/lib/scene3d/sculpt/brushes.ts`
- Test: `frontend/tests/unit/scene3d-sculpt-brushes.unit.spec.ts`

**Interfaces:**
- Consumes: `SculptSession` (Task 10).
- Produces:
  - `type BrushKind = 'draw' | 'smooth' | 'inflate' | 'flatten'`
  - `interface BrushStamp { centre: [number,number,number]; normal: [number,number,number]; radius: number; strength: number; invert: boolean }`
  - `applyBrush(session: SculptSession, kind: BrushKind, stamp: BrushStamp): void`
  - `falloff(t: number): number` (smoothstep, 1 at the centre, 0 at the rim)

- [ ] **Step 1: Write the failing brush test**

Create `frontend/tests/unit/scene3d-sculpt-brushes.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { SculptSession } from '~/lib/scene3d/sculpt/session'
import { applyBrush, falloff, type BrushStamp } from '~/lib/scene3d/sculpt/brushes'

/** A flat patch in the XZ plane, normal +Y, centred on the origin. */
const patch = () => {
  const geo = new THREE.PlaneGeometry(2, 2, 24, 24).rotateX(-Math.PI / 2)
  return new SculptSession(meshDataFromGeometry(geo))
}
const sphere = () =>
  new SculptSession(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 48, 32)))

const stamp = (over: Partial<BrushStamp> = {}): BrushStamp => ({
  centre: [0, 0, 0], normal: [0, 1, 0], radius: 0.4, strength: 0.5, invert: false, ...over,
})

/** Index of the vertex nearest a point. */
const nearest = (s: SculptSession, x: number, y: number, z: number): number => {
  let best = -1, bestD = Infinity
  for (let v = 0; v < s.positions.length / 3; v++) {
    const d = Math.hypot(s.positions[v * 3]! - x, s.positions[v * 3 + 1]! - y, s.positions[v * 3 + 2]! - z)
    if (d < bestD) { bestD = d; best = v }
  }
  return best
}
const y = (s: SculptSession, v: number) => s.positions[v * 3 + 1]!

describe('falloff', () => {
  it('is 1 at the centre, 0 at the rim, and monotonic between', () => {
    expect(falloff(0)).toBeCloseTo(1, 6)
    expect(falloff(1)).toBe(0)
    expect(falloff(1.5)).toBe(0)
    expect(falloff(0.3)).toBeGreaterThan(falloff(0.7))
  })
})

describe('draw brush', () => {
  it('pushes along the stamp normal', () => {
    const s = patch()
    const v = nearest(s, 0, 0, 0)
    s.beginStroke(); applyBrush(s, 'draw', stamp()); s.endStroke()
    expect(y(s, v)).toBeGreaterThan(0)
  })

  it('carves the other way when inverted', () => {
    const s = patch()
    const v = nearest(s, 0, 0, 0)
    s.beginStroke(); applyBrush(s, 'draw', stamp({ invert: true })); s.endStroke()
    expect(y(s, v)).toBeLessThan(0)
  })

  it('moves the centre more than the rim, and outside the radius not at all', () => {
    const s = patch()
    const centre = nearest(s, 0, 0, 0)
    const mid = nearest(s, 0.32, 0, 0)     // 80% of the radius
    const outside = nearest(s, 0.9, 0, 0)  // beyond it
    s.beginStroke(); applyBrush(s, 'draw', stamp()); s.endStroke()
    expect(y(s, centre)).toBeGreaterThan(y(s, mid))
    expect(y(s, mid)).toBeGreaterThan(0)
    expect(y(s, outside)).toBeCloseTo(0, 6)
  })

  it('records every vertex it moves, so undo is exact', () => {
    const s = patch()
    const before = s.positions.slice()
    s.beginStroke(); applyBrush(s, 'draw', stamp()); s.endStroke()
    expect(s.undo()).toBe(true)
    expect(s.positions).toEqual(before)
  })
})

describe('inflate brush', () => {
  it('moves each vertex along its OWN normal, not the stamp normal', () => {
    // On a sphere, the top and bottom of the brush region face opposite ways.
    // An implementation that used the stamp normal for every vertex would move
    // them the same direction and fail this.
    const s = sphere()
    const top = nearest(s, 0, 0.5, 0)
    const bottom = nearest(s, 0, -0.5, 0)
    const y0 = y(s, top), y1 = y(s, bottom)
    s.beginStroke()
    applyBrush(s, 'inflate', stamp({ centre: [0, 0.5, 0], radius: 5, strength: 0.5 }))
    s.endStroke()
    expect(y(s, top)).toBeGreaterThan(y0)     // pushed up, out of the sphere
    expect(y(s, bottom)).toBeLessThan(y1)     // pushed down, also out
  })
})

describe('smooth brush', () => {
  it('pulls a spike back toward its neighbours', () => {
    const s = patch()
    const v = nearest(s, 0, 0, 0)
    s.positions[v * 3 + 1] = 1 // a spike
    const before = y(s, v)
    s.beginStroke(); applyBrush(s, 'smooth', stamp({ strength: 1 })); s.endStroke()
    expect(y(s, v)).toBeLessThan(before)
    expect(y(s, v)).toBeGreaterThan(0) // toward the neighbours, not past them
  })
})

describe('flatten brush', () => {
  it('reduces the spread of a bumpy region', () => {
    const s = patch()
    const inRange = s.verticesNear(0, 0, 0, 0.4)
    for (let n = 0; n < inRange.length; n++) {
      s.positions[inRange[n]! * 3 + 1] = (n % 2 === 0 ? 0.2 : -0.2)
    }
    const spread = (): number => {
      const vals: number[] = []
      for (let n = 0; n < inRange.length; n++) vals.push(y(s, inRange[n]!))
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      return vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
    }
    const before = spread()
    s.beginStroke(); applyBrush(s, 'flatten', stamp({ strength: 1 })); s.endStroke()
    expect(spread()).toBeLessThan(before)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-sculpt-brushes`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the brushes**

Create `frontend/app/lib/scene3d/sculpt/brushes.ts`:

```ts
// The brushes. All of them share one loop — gather the vertices in range,
// weight each by its falloff, displace — and differ only in the direction they
// push. Keeping that loop in one place is what makes adding a brush a few lines
// rather than a new file.
import type { SculptSession } from '~/lib/scene3d/sculpt/session'

export type BrushKind = 'draw' | 'smooth' | 'inflate' | 'flatten'

export interface BrushStamp {
  /** Where the brush touches the surface, in the mesh's object space. */
  centre: [number, number, number]
  /** Surface normal at `centre`. Used by `draw`; ignored by `inflate`, which
   *  reads each vertex's own normal instead. */
  normal: [number, number, number]
  radius: number
  /** 0–1. Scaled by `radius` so a brush feels the same at any size. */
  strength: number
  /** Alt-held: carve inward instead of pushing outward. */
  invert: boolean
}

/** 1 at the centre, 0 at the rim, smooth at both ends. Squaring keeps the
 *  centre plateau-ish so a stroke does not leave a spike at its midpoint. */
export function falloff(t: number): number {
  if (t >= 1) return 0
  const u = 1 - t * t
  return u * u
}

export function applyBrush(session: SculptSession, kind: BrushKind, stamp: BrushStamp): void {
  const [cx, cy, cz] = stamp.centre
  const hits = session.verticesNear(cx, cy, cz, stamp.radius)
  if (hits.length === 0) return
  const p = session.positions
  const sign = stamp.invert ? -1 : 1
  const scale = stamp.strength * stamp.radius

  // `flatten` needs the region's average plane before it can move anything, so
  // it takes one gathering pass first.
  let planeY = 0
  let pnx = 0, pny = 0, pnz = 0
  if (kind === 'flatten') {
    let ax = 0, ay = 0, az = 0
    for (let n = 0; n < hits.length; n++) {
      const v = hits[n]!
      ax += p[v * 3]!; ay += p[v * 3 + 1]!; az += p[v * 3 + 2]!
      pnx += session.normals[v * 3]!
      pny += session.normals[v * 3 + 1]!
      pnz += session.normals[v * 3 + 2]!
    }
    const inv = 1 / hits.length
    ax *= inv; ay *= inv; az *= inv
    const nl = Math.hypot(pnx, pny, pnz) || 1
    pnx /= nl; pny /= nl; pnz /= nl
    // Signed distance of the plane from the origin along its normal.
    planeY = ax * pnx + ay * pny + az * pnz
  }

  for (let n = 0; n < hits.length; n++) {
    const v = hits[n]!
    const x = p[v * 3]!, yy = p[v * 3 + 1]!, z = p[v * 3 + 2]!
    const d = Math.hypot(x - cx, yy - cy, z - cz)
    const w = falloff(d / stamp.radius)
    if (w <= 0) continue

    let dx = 0, dy = 0, dz = 0
    if (kind === 'draw') {
      dx = stamp.normal[0] * w * scale * sign
      dy = stamp.normal[1] * w * scale * sign
      dz = stamp.normal[2] * w * scale * sign
    } else if (kind === 'inflate') {
      // The vertex's OWN normal — that is the whole difference from `draw`, and
      // what makes this expand a form rather than push one side of it.
      dx = session.normals[v * 3]! * w * scale * sign
      dy = session.normals[v * 3 + 1]! * w * scale * sign
      dz = session.normals[v * 3 + 2]! * w * scale * sign
    } else if (kind === 'smooth') {
      const nb = session.neighboursOf(v)
      if (nb.length === 0) continue
      let mx = 0, my = 0, mz = 0
      for (let k = 0; k < nb.length; k++) {
        const u = nb[k]!
        mx += p[u * 3]!; my += p[u * 3 + 1]!; mz += p[u * 3 + 2]!
      }
      const inv = 1 / nb.length
      dx = (mx * inv - x) * w * stamp.strength
      dy = (my * inv - yy) * w * stamp.strength
      dz = (mz * inv - z) * w * stamp.strength
    } else { // flatten
      const along = x * pnx + yy * pny + z * pnz
      const pull = (planeY - along) * w * stamp.strength
      dx = pnx * pull; dy = pny * pull; dz = pnz * pull
    }

    // ALWAYS before the write — undo depends on it.
    session.recordVertex(v)
    p[v * 3] = x + dx
    p[v * 3 + 1] = yy + dy
    p[v * 3 + 2] = z + dz
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-sculpt-brushes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/sculpt/brushes.ts frontend/tests/unit/scene3d-sculpt-brushes.unit.spec.ts
git commit -m "feat(scene3d): draw, smooth, inflate and flatten sculpt brushes"
```

---

## Task 12: Mirror symmetry

**Files:**
- Create: `frontend/app/lib/scene3d/sculpt/symmetry.ts`
- Test: `frontend/tests/unit/scene3d-sculpt-symmetry.unit.spec.ts`

**Interfaces:**
- Consumes: `BrushStamp` (Task 11).
- Produces:
  - `type SymmetryMode = 'none' | 'mirror' | 'radial'`
  - `interface SymmetrySpec { mode: SymmetryMode; axis: 0 | 1 | 2; count: number }`
  - `expandStamp(stamp: BrushStamp, spec: SymmetrySpec): BrushStamp[]`

- [ ] **Step 1: Write the failing symmetry test**

Create `frontend/tests/unit/scene3d-sculpt-symmetry.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { expandStamp } from '~/lib/scene3d/sculpt/symmetry'
import type { BrushStamp } from '~/lib/scene3d/sculpt/brushes'

// DELIBERATELY ASYMMETRIC — a stamp on an axis or at the origin would pass
// against a broken mirror by coincidence.
const stamp: BrushStamp = {
  centre: [0.3, 0.7, -0.2], normal: [0.6, 0.8, 0], radius: 0.1, strength: 0.5, invert: false,
}

describe('symmetry', () => {
  it('passes the stamp through unchanged when off', () => {
    expect(expandStamp(stamp, { mode: 'none', axis: 0, count: 1 })).toEqual([stamp])
  })

  it('mirrors position AND normal across X', () => {
    const out = expandStamp(stamp, { mode: 'mirror', axis: 0, count: 1 })
    expect(out).toHaveLength(2)
    expect(out[1]!.centre).toEqual([-0.3, 0.7, -0.2])
    // The normal must flip too — mirroring only the position tilts every
    // mirrored stroke the wrong way, which reads as a lighting bug.
    expect(out[1]!.normal).toEqual([-0.6, 0.8, 0])
  })

  it('leaves the other components untouched when mirroring', () => {
    const out = expandStamp(stamp, { mode: 'mirror', axis: 0, count: 1 })
    expect(out[1]!.radius).toBe(0.1)
    expect(out[1]!.strength).toBe(0.5)
  })

  it('produces N stamps around the axis in radial mode', () => {
    const out = expandStamp(stamp, { mode: 'radial', axis: 1, count: 8 })
    expect(out).toHaveLength(8)
    // Every copy keeps its distance from the axis and its height.
    const r0 = Math.hypot(stamp.centre[0], stamp.centre[2])
    for (const s of out) {
      expect(Math.hypot(s.centre[0], s.centre[2])).toBeCloseTo(r0, 6)
      expect(s.centre[1]).toBeCloseTo(0.7, 6)
    }
    // ...and they are actually distinct, not eight copies of the same point.
    const xs = new Set(out.map((s) => s.centre[0]!.toFixed(4)))
    expect(xs.size).toBe(8)
  })

  it('radial with count 1 is a no-op', () => {
    expect(expandStamp(stamp, { mode: 'radial', axis: 1, count: 1 })).toEqual([stamp])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-sculpt-symmetry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `expandStamp`**

Create `frontend/app/lib/scene3d/sculpt/symmetry.ts`. Mirror negates the
`axis` component of **both** `centre` and `normal`. Radial rotates both about
`axis` by `i * 2π / count` for `i` in `0..count-1`. Both return `[stamp]`
unchanged when the mode is off or the count is 1.

Note in the file header that radial is written now even though phase 3 only
exposes mirror in the UI — the machinery is identical and splitting it would
mean touching this file twice.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-sculpt-symmetry`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/sculpt/symmetry.ts frontend/tests/unit/scene3d-sculpt-symmetry.unit.spec.ts
git commit -m "feat(scene3d): mirror and radial stroke symmetry"
```

---

## Task 13: Sculpt mode in the studio

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/Scene3DSculptPanel.vue`
- Modify: `frontend/app/lib/scene3d/interaction.ts` (third orbit-lock concern)
- Modify: `frontend/app/lib/scene3d/engine.ts` (live working-buffer geometry)
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`
- Test: `frontend/tests/unit/scene3d-orbit-lock.unit.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 10–12.
- Produces: `SceneInteraction.setSculpting(active: boolean): void`

- [ ] **Step 1: Write the failing orbit-lock test**

Create `frontend/tests/unit/scene3d-orbit-lock.unit.spec.ts`, extending the
existing pure helper `orbitShouldBeEnabled` (`interaction.ts:33`) to a third
argument:

```ts
import { describe, it, expect } from 'vitest'
import { orbitShouldBeEnabled } from '~/lib/scene3d/interaction'

describe('orbit lock', () => {
  it('is enabled only when no concern holds a lock', () => {
    expect(orbitShouldBeEnabled(false, false, false)).toBe(true)
  })

  it('is disabled by any single concern', () => {
    expect(orbitShouldBeEnabled(true, false, false)).toBe(false)  // camera motion
    expect(orbitShouldBeEnabled(false, true, false)).toBe(false)  // gizmo drag
    expect(orbitShouldBeEnabled(false, false, true)).toBe(false)  // sculpting
  })

  it('stays disabled while several overlap', () => {
    expect(orbitShouldBeEnabled(true, true, true)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-orbit-lock`
Expected: FAIL — the third argument is ignored, so the third assertion returns `true`.

- [ ] **Step 3: Add the third orbit concern**

In `frontend/app/lib/scene3d/interaction.ts`:

```ts
/** Orbit is enabled only when NO concern holds a lock. Pure so it's
 *  unit-testable independent of a live OrbitControls.
 *
 *  Three concerns now: camera motion playback, a gizmo drag, and a live sculpt
 *  stroke. Each owns a private field on SceneInteraction and NOTHING writes
 *  `orbit.enabled` directly — a per-frame writer that did so silently stomped
 *  another concern's lock once already. Go through `updateOrbitEnabled`. */
export function orbitShouldBeEnabled(
  cameraLocked: boolean,
  gizmoDragging: boolean,
  sculpting: boolean,
): boolean {
  return !cameraLocked && !gizmoDragging && !sculpting
}
```

Add the private field and setter to the class, alongside `cameraLocked` and
`gizmoDragging`:

```ts
  private sculpting = false

  /** Held for the duration of a brush stroke. Third orbit concern — see
   *  orbitShouldBeEnabled. Also hides the gizmo, which has no meaning in
   *  sculpt mode. */
  setSculpting(active: boolean): void {
    this.sculpting = active
    this.updateOrbitEnabled()
    this.updateGizmosEnabled()
  }
```

Update `updateOrbitEnabled` to pass all three fields.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-orbit-lock`
Expected: PASS, 3 tests.

- [ ] **Step 5: Let the engine render the live working buffer**

While sculpting, the mesh must show the session's in-progress positions, not the
doc's committed buffer. Add to `SceneEngine`:

```ts
  /** While a sculpt session is live, this object's geometry comes from the
   *  session's working buffer instead of `content.mesh`. Cleared on commit.
   *  Set to null to go back to the doc. */
  setSculptOverride(id: string | null, positions: Float32Array | null, indices: Uint32Array | null): void
```

Implementation: store the override, and in `geometryForObject` return a geometry
built from it when `obj.id` matches. The surface calls this once per `endStroke`
(and once on entry), not per pointermove — the mesh's position attribute is
updated in place between strokes via `needsUpdate`, so a stroke costs no
geometry rebuild.

- [ ] **Step 6: Build the sculpt panel**

Create `frontend/app/components/vue-canvas/studio/Scene3DSculptPanel.vue` with:
brush palette (Draw / Smooth / Inflate / Flatten), Size and Strength sliders,
a Symmetry segmented control (Off / Mirror), a hint line reading
*"Hold Alt to carve inward"*, and Apply / Exit buttons. Follow the existing
`StudioButton` and slider components used elsewhere in the surface; action blue
is the only accent colour.

- [ ] **Step 7: Wire the pointer loop**

In `Scene3DStudioSurface.vue`:
- **Sculpt** button appears in the object-panel action row when exactly one
  `mesh` primitive is selected
- entering: decode the buffer, construct a `SculptSession`, call
  `interaction.setSculpting(true)`, swap the inspector for the sculpt panel
- `pointerdown` on the canvas: `session.beginStroke()`
- `pointermove` while down: unproject the pointer to a ray, `session.pick(...)`,
  build a `BrushStamp` from the hit, `expandStamp(...)`, `applyBrush(...)` for
  each, then write the changed positions into the live mesh's position attribute
  and set `needsUpdate = true`
- `pointerup`: `session.endStroke()`, `session.recomputeNormals()`, refresh the
  engine override
- Cmd+Z / Ctrl+Z while in sculpt mode: `session.undo()` — and it must **not**
  fall through to the studio's doc-level undo
- Apply / Exit: `await session.commit()`, write `content.mesh` and
  `content.meshKey` onto the object **once**, `interaction.setSculpting(false)`,
  clear the engine override

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck 2>&1 | tail -5`
Expected: matches the pre-task baseline. Any error naming a sculpt symbol is
yours.

- [ ] **Step 9: Live check — this is the part unit tests cannot reach**

In a real browser (not the hidden Browser pane — a hidden pane pauses rAF and
makes interaction timing lie):
1. Convert a sphere to mesh, remesh at the default, enter Sculpt.
2. Drag on the surface — it deforms under the cursor, and **the camera does not
   orbit**. Release and drag on empty space — the camera orbits again.
3. Alt-drag carves inward.
4. Turn Mirror on and stroke off-centre — the mirrored bump appears on the
   other side and is the same shape, not tilted.
5. Cmd+Z removes the last stroke only.
6. Exit, then reload the page — the sculpt survives.
7. Watch the network/save traffic during a stroke: **no `scene_state` write
   until Apply/Exit.** This is the constraint most likely to regress silently.

- [ ] **Step 10: Commit**

```bash
git add frontend/app/lib/scene3d/interaction.ts frontend/app/lib/scene3d/engine.ts frontend/app/components/vue-canvas/studio/Scene3DSculptPanel.vue frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/tests/unit/scene3d-orbit-lock.unit.spec.ts
git commit -m "feat(scene3d): sculpt mode with brush strokes, symmetry and undo"
```

**Phase 3 is complete and shippable here.** You can mold a shape by hand.

---

# Phase 4 — The rest of the brushes, and Merge

## Task 14: Grab, pinch and crease

**Files:**
- Modify: `frontend/app/lib/scene3d/sculpt/brushes.ts`
- Modify: `frontend/app/components/vue-canvas/studio/Scene3DSculptPanel.vue`
- Test: `frontend/tests/unit/scene3d-sculpt-brushes.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: Task 11's `applyBrush` loop.
- Produces: `BrushKind` widens to include `'grab' | 'pinch' | 'crease'`;
  `BrushStamp` gains `drag?: [number, number, number]` (world-space pointer
  delta, `grab` only).

- [ ] **Step 1: Extend the brush test**

Add to `frontend/tests/unit/scene3d-sculpt-brushes.unit.spec.ts`:

```ts
describe('pinch brush', () => {
  it('pulls vertices toward the stamp centre', () => {
    const s = patch()
    const inRange = s.verticesNear(0, 0, 0, 0.4)
    const meanDist = (): number => {
      let sum = 0
      for (let n = 0; n < inRange.length; n++) {
        const v = inRange[n]!
        sum += Math.hypot(s.positions[v * 3]!, s.positions[v * 3 + 1]!, s.positions[v * 3 + 2]!)
      }
      return sum / inRange.length
    }
    const before = meanDist()
    s.beginStroke(); applyBrush(s, 'pinch', stamp({ strength: 0.5 })); s.endStroke()
    expect(meanDist()).toBeLessThan(before)
  })
})

describe('crease brush', () => {
  it('pinches AND displaces — an implementation doing only one fails', () => {
    const s = patch()
    const v = nearest(s, 0.2, 0, 0)
    const rBefore = Math.hypot(s.positions[v * 3]!, s.positions[v * 3 + 2]!)
    s.beginStroke(); applyBrush(s, 'crease', stamp({ strength: 0.5, invert: true })); s.endStroke()
    const rAfter = Math.hypot(s.positions[v * 3]!, s.positions[v * 3 + 2]!)
    expect(rAfter).toBeLessThan(rBefore)      // the pinch half
    expect(y(s, v)).toBeLessThan(0)           // the displace half (inverted = cut in)
  })
})

describe('grab brush', () => {
  it('translates by the drag, ignoring normals entirely', () => {
    // On a sphere, top and bottom face opposite ways. Every other brush would
    // move them in opposite directions; grab must move both the SAME way.
    const s = sphere()
    const top = nearest(s, 0, 0.5, 0)
    const bottom = nearest(s, 0, -0.5, 0)
    const beforeTop = s.positions[top * 3]!
    const beforeBottom = s.positions[bottom * 3]!
    s.beginStroke()
    applyBrush(s, 'grab', stamp({ centre: [0, 0, 0], radius: 5, strength: 1, drag: [0.1, 0, 0] }))
    s.endStroke()
    expect(s.positions[top * 3]!).toBeGreaterThan(beforeTop)
    expect(s.positions[bottom * 3]!).toBeGreaterThan(beforeBottom)
  })

  it('does nothing without a drag', () => {
    const s = patch()
    const before = s.positions.slice()
    s.beginStroke(); applyBrush(s, 'grab', stamp()); s.endStroke()
    expect(s.positions).toEqual(before)
  })

  it('falls off from the centre like every other brush', () => {
    const s = patch()
    const centre = nearest(s, 0, 0, 0)
    const rim = nearest(s, 0.35, 0, 0)
    const c0 = s.positions[centre * 3]!, r0 = s.positions[rim * 3]!
    s.beginStroke()
    applyBrush(s, 'grab', stamp({ strength: 1, drag: [0.1, 0, 0] }))
    s.endStroke()
    expect(s.positions[centre * 3]! - c0).toBeGreaterThan(s.positions[rim * 3]! - r0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-sculpt-brushes`
Expected: FAIL on the three new cases.

- [ ] **Step 3: Implement the three brushes**

Widen the type and the stamp in `brushes.ts`:

```ts
export type BrushKind = 'draw' | 'smooth' | 'inflate' | 'flatten' | 'grab' | 'pinch' | 'crease'

export interface BrushStamp {
  // ...existing fields...
  /** World-space pointer delta for this move. `grab` ONLY — every other brush
   *  ignores it, and grab is a no-op without it. */
  drag?: [number, number, number]
}
```

Then add three branches to the displacement chain, after `flatten`:

```ts
    } else if (kind === 'pinch') {
      const len = Math.hypot(x - cx, yy - cy, z - cz) || 1
      const pull = w * scale * sign
      dx = ((cx - x) / len) * pull
      dy = ((cy - yy) / len) * pull
      dz = ((cz - z) / len) * pull
    } else if (kind === 'crease') {
      // Pinch and displace together — the pinch alone only narrows a ridge, the
      // displacement alone only dents it. A crease is both at once.
      const len = Math.hypot(x - cx, yy - cy, z - cz) || 1
      const pull = w * scale * sign
      dx = ((cx - x) / len) * pull + stamp.normal[0] * w * scale * sign
      dy = ((cy - yy) / len) * pull + stamp.normal[1] * w * scale * sign
      dz = ((cz - z) / len) * pull + stamp.normal[2] * w * scale * sign
    } else if (kind === 'grab') {
      // No normal term at all: grab carries the surface with the pointer, which
      // is why it can pull out a limb where a normal-driven brush cannot.
      const drag = stamp.drag
      if (!drag) continue
      dx = drag[0] * w
      dy = drag[1] * w
      dz = drag[2] * w
    }
```

Note the existing `flatten` branch is currently the `else`; change it to
`else if (kind === 'flatten')` so these can follow it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-sculpt-brushes`
Expected: PASS.

- [ ] **Step 5: Add them to the panel and the pointer loop**

Add the three to the brush palette. In the surface's `pointermove` handler,
populate `stamp.drag` from the world-space delta between this move's ray-plane
intersection and the previous one when the active brush is `grab` — grab tracks
the pointer, not the surface.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/scene3d/sculpt/brushes.ts frontend/app/components/vue-canvas/studio/Scene3DSculptPanel.vue frontend/tests/unit/scene3d-sculpt-brushes.unit.spec.ts
git commit -m "feat(scene3d): grab, pinch and crease brushes"
```

---

## Task 15: Radial symmetry in the UI

**Files:**
- Modify: `frontend/app/components/vue-canvas/studio/Scene3DSculptPanel.vue`

**Interfaces:**
- Consumes: `expandStamp` with `mode: 'radial'` (already built and tested in Task 12).

- [ ] **Step 1: Extend the symmetry control**

Widen the segmented control to Off / Mirror / Radial. When Radial is selected,
show a Count stepper (2–16, default 6) and an Axis selector (X / Y / Z,
default Y).

- [ ] **Step 2: Live check**

Enter sculpt on a remeshed sphere, set Radial with count 8 about Y, and draw one
bump — eight evenly spaced bumps appear around the axis at the same height.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/Scene3DSculptPanel.vue
git commit -m "feat(scene3d): expose radial symmetry in the sculpt panel"
```

---

## Task 16: Merge

**Files:**
- Create: `frontend/app/lib/scene3d/voxel/merge.ts`
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`
- Test: `frontend/tests/unit/scene3d-merge.unit.spec.ts`

**Interfaces:**
- Consumes: `buildTriGrid`, `buildSdf`, `surfaceNets` (Tasks 6–8); `worldMatrixOf` from `hierarchy.ts`.
- Produces:
  - `type MergeOp = 'union' | 'subtract' | 'intersect'`
  - `mergeMeshes(inputs: MeshData[], op: MergeOp, blend: number, resolution: number): { data: MeshData; open: boolean }`

- [ ] **Step 1: Write the failing merge test**

Create `frontend/tests/unit/scene3d-merge.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry, type MeshData } from '~/lib/scene3d/mesh'
import { mergeMeshes } from '~/lib/scene3d/voxel/merge'

const RES = 56
/** Two unit spheres overlapping by half a radius along X. */
const ball = (x: number) =>
  meshDataFromGeometry(new THREE.SphereGeometry(0.5, 48, 32).translate(x, 0, 0))

const volumeOf = (d: MeshData): number => {
  let v = 0
  const p = d.positions, ix = d.indices
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i]! * 3, b = ix[i + 1]! * 3, c = ix[i + 2]! * 3
    v += (
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!)
      - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!)
      + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)
    ) / 6
  }
  return Math.abs(v)
}

/** Number of connected components over the triangle adjacency. */
const components = (d: MeshData): number => {
  const n = d.positions.length / 3
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]! } return x }
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (let i = 0; i < d.indices.length; i += 3) {
    join(d.indices[i]!, d.indices[i + 1]!)
    join(d.indices[i + 1]!, d.indices[i + 2]!)
  }
  const roots = new Set<number>()
  for (let i = 0; i < n; i++) roots.add(find(i))
  return roots.size
}

const SPHERE_VOL = (4 / 3) * Math.PI * 0.5 ** 3

describe('merge', () => {
  it('union of two overlapping spheres is ONE connected body', () => {
    // Two components would mean the fields were never combined — the single
    // most likely way to get a merge that "looks fine" but did nothing.
    const { data, open } = mergeMeshes([ball(-0.25), ball(0.25)], 'union', 0, RES)
    expect(open).toBe(false)
    expect(components(data)).toBe(1)
  })

  it('union volume exceeds either input but is less than their sum', () => {
    // Less than the sum, because they overlap — a naive concatenation of the
    // two meshes would pass "greater than either" and fail this.
    const { data } = mergeMeshes([ball(-0.25), ball(0.25)], 'union', 0, RES)
    const v = volumeOf(data)
    expect(v).toBeGreaterThan(SPHERE_VOL * 1.1)
    expect(v).toBeLessThan(SPHERE_VOL * 2)
  })

  it('subtract removes material from the base', () => {
    const { data } = mergeMeshes([ball(-0.25), ball(0.25)], 'subtract', 0, RES)
    expect(volumeOf(data)).toBeLessThan(SPHERE_VOL * 0.95)
  })

  it('intersect keeps only the overlap', () => {
    const { data } = mergeMeshes([ball(-0.25), ball(0.25)], 'intersect', 0, RES)
    const v = volumeOf(data)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(SPHERE_VOL * 0.75)
  })

  it('blend adds material at the join', () => {
    const sharp = volumeOf(mergeMeshes([ball(-0.3), ball(0.3)], 'union', 0, RES).data)
    const filleted = volumeOf(mergeMeshes([ball(-0.3), ball(0.3)], 'union', 0.15, RES).data)
    expect(filleted).toBeGreaterThan(sharp)
  })

  it('refuses when any input is open', () => {
    const plane = meshDataFromGeometry(new THREE.PlaneGeometry(1, 1))
    const out = mergeMeshes([ball(0), plane], 'union', 0, RES)
    expect(out.open).toBe(true)
  })

  it('subtract is order-sensitive — the first input is the base', () => {
    const a = volumeOf(mergeMeshes([ball(-0.25), ball(0.25)], 'subtract', 0, RES).data)
    const b = volumeOf(mergeMeshes([ball(0.25), ball(-0.25)], 'subtract', 0, RES).data)
    expect(a).toBeCloseTo(b, 1) // symmetric shapes, so volumes match...
    // ...but the results occupy different halves of space.
    const ca = mergeMeshes([ball(-0.25), ball(0.25)], 'subtract', 0, RES).data
    const cb = mergeMeshes([ball(0.25), ball(-0.25)], 'subtract', 0, RES).data
    const meanX = (d: MeshData) => {
      let s = 0
      for (let i = 0; i < d.positions.length; i += 3) s += d.positions[i]!
      return s / (d.positions.length / 3)
    }
    expect(meanX(ca)).toBeLessThan(meanX(cb))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-merge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mergeMeshes`**

Create `frontend/app/lib/scene3d/voxel/merge.ts`:

```ts
// Boolean operations through the distance field.
//
// Chosen over exact mesh CSG because the output is ALREADY a clean uniform mesh
// — you can keep sculpting a merge result without remeshing it first — and
// because a smooth-min gives a fillet at the join for free. The cost accepted
// in exchange: sharp edges soften at grid resolution. Merging a box into a box
// will not give you a crisp corner. If crisp hard-surface booleans are ever
// wanted, they belong behind this same action at blend 0, not inside here.
import { MESH_VERTEX_CAP, type MeshData } from '~/lib/scene3d/mesh'
import { buildTriGrid } from './triGrid'
import { buildSdf, unionLattice } from './sdf'
import { surfaceNets } from './surfaceNets'
// Measured against each input's OWN longest axis, so a small object in a big
// merge still gets sampled finely enough to survive.
import { cellFor } from './bounds'

export type MergeOp = 'union' | 'subtract' | 'intersect'

/** Polynomial smooth minimum. At k = 0 this is exactly min(). */
function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/** Smooth maximum, the same construction mirrored — needed so `intersect` and
 *  `subtract` get a fillet too rather than only `union`. */
function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k)
}

export function mergeMeshes(
  inputs: MeshData[], op: MergeOp, blend: number, resolution: number,
): { data: MeshData; open: boolean } {
  if (inputs.length === 0) return { data: { positions: new Float32Array(0), indices: new Uint32Array(0) }, open: false }
  if (inputs.length === 1) return { data: inputs[0]!, open: false }

  let res = resolution
  for (let attempt = 0; attempt < 4; attempt++) {
    // ONE lattice for every input, so the fields line up node-for-node and no
    // resampling step is needed between them. Per-input lattices would have to
    // be interpolated onto a common one, blurring every merge.
    const grids = inputs.map((d) => buildTriGrid(d, cellFor(d, res)))
    const lattice = unionLattice(grids, res)

    const fields: Float32Array[] = []
    for (const g of grids) {
      const { sdf, open } = buildSdf(g, lattice)
      if (open) return { data: inputs[0]!, open: true }
      fields.push(sdf.values)
    }

    const base = fields[0]!
    const out = new Float32Array(base.length)
    out.set(base)
    for (let f = 1; f < fields.length; f++) {
      const other = fields[f]!
      for (let i = 0; i < out.length; i++) {
        const a = out[i]!
        const b = other[i]!
        out[i] = op === 'union' ? smin(a, b, blend)
          : op === 'intersect' ? smax(a, b, blend)
          : smax(a, -b, blend) // subtract — the FIRST input is the base
      }
    }

    const data = surfaceNets({ values: out, min: lattice.min, dims: lattice.dims, cell: lattice.cell })
    if (data.positions.length / 3 <= MESH_VERTEX_CAP) return { data, open: false }
    res = Math.max(8, Math.round(res * 0.75))
  }

  // Same last-resort floor as remeshObject: a coarse shape beats an error.
  const grids = inputs.map((d) => buildTriGrid(d, cellFor(d, 8)))
  const lattice = unionLattice(grids, 8)
  const { sdf } = buildSdf(grids[0]!, lattice)
  return { data: surfaceNets(sdf), open: false }
}

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- scene3d-merge`
Expected: PASS.

- [ ] **Step 5: Wire the Merge action**

In `Scene3DStudioSurface.vue`:
- **Merge** button in the object-panel action row when 2+ objects are selected
- a small popover with the operation (Union / Subtract / Intersect), a Blend
  slider (0–0.3), and a Resolution slider
- bake each selected object's geometry into **world space** via
  `worldMatrixOf(doc.objects, id)` before merging — objects at different
  transforms must combine where they visually are, not where their local
  origins are
- the result becomes one new `mesh` object placed at the merged bbox centre; the
  source objects are removed
- on `open: true`, show the same open-surface notice Task 9 added, naming which
  input was open

- [ ] **Step 6: Live check**

Place two overlapping spheres at different positions and scales. Merge with
Blend 0 — one object, fused where they overlap. Undo, merge with Blend 0.15 — a
visible fillet at the join. Confirm the result enters Sculpt mode directly
without needing a remesh first.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/scene3d/voxel/merge.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/tests/unit/scene3d-merge.unit.spec.ts
git commit -m "feat(scene3d): merge objects through the voxel field with a blend fillet"
```

---

## Task 17: Dashboard and docs

**Files:**
- Modify: `docs/STATE.md`, `docs/ROADMAP.md`
- Modify: the live ⛵ State of the Build artifact

- [ ] **Step 1: Read the LIVE artifact first**

Other sessions publish to the same dashboard. Fetch its current content before
editing so you merge rather than overwrite.

- [ ] **Step 2: Update `docs/STATE.md` and `docs/ROADMAP.md`**

Record: the `mesh` primitive and its codec, the voxel module, sculpt mode, and
merge. Note the storage budget measured in phase 2 and whether the asset-URL
route is still deferred.

- [ ] **Step 3: Republish the artifact and commit the docs**

```bash
git add docs/STATE.md docs/ROADMAP.md
git commit -m "docs(state): sculpt and merge in the 3D Studio"
```

---

## Verification checklist

Before calling this done, run and paste the output — not a summary:

```bash
cd frontend && npm run test:unit -- scene3d
```

Then confirm by hand, in a real browser window:

- [ ] A sculpted mesh survives a page reload unchanged
- [ ] No `scene_state` write occurs during a stroke — only on Apply/Exit
- [ ] The camera does not orbit mid-stroke, and orbits normally after
- [ ] Mirror symmetry produces a matching bump, not a tilted one
- [ ] Remesh on an open shape refuses with the notice rather than mangling it
- [ ] A merged object can be sculpted without a remesh first
- [ ] A mesh object still renders in the exported frame, not just the viewport
