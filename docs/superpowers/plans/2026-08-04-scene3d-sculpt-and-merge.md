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
thousand vertices. A 40k-vertex mesh at cloneCount 100 is 4M vertices and hangs
the tab. The clamp must be **surfaced**, not silent.

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
    const r = clampedClones({ cloneCount: 100 }, 40_000) // would be 4M vertices
    expect(r.clamped).toBe(true)
    expect(r.count).toBeGreaterThanOrEqual(1)
    expect(r.count * 40_000).toBeLessThanOrEqual(300_000)
  })

  it('never clamps below a single copy', () => {
    const r = clampedClones({ cloneCount: 100 }, 10_000_000)
    expect(r.count).toBe(1)
  })

  it('applyModifiers honours the clamp', () => {
    // 20k-vertex base at cloneCount 100 would be 2M; the budget caps it.
    const base = new THREE.SphereGeometry(0.5, 180, 110)
    const n = base.getAttribute('position').count
    expect(n).toBeGreaterThan(15_000)
    const out = applyModifiers(base, { cloneCount: 100, cloneOffsetX: 2 })
    expect(out.getAttribute('position').count).toBeLessThanOrEqual(300_000)
  })

  it('totalClones still reports the user-set figure, unclamped', () => {
    // The clamp is a render-time guard; the doc's value is what the user chose.
    expect(totalClones({ cloneCount: 100 })).toBe(100)
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
 *  few thousand vertices. A 40k-vertex `mesh` primitive at cloneCount 100 is
 *  4M vertices and hangs the tab.
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
- Create: `frontend/app/lib/scene3d/voxel/triGrid.ts`
- Test: `frontend/tests/unit/scene3d-tri-grid.unit.spec.ts`

**Interfaces:**
- Consumes: `MeshData` (Task 1).
- Produces:
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

- [ ] **Step 3: Implement the grid**

Create `frontend/app/lib/scene3d/voxel/triGrid.ts` implementing:

- `buildTriGrid` — compute the mesh bbox, pad it by one cell, size `dims` from
  `cell`, then for each triangle compute its bbox in cell coordinates and push
  its index into every overlapping bin. Store bins as an `Int32Array[]` built
  from a counting pass followed by a fill pass (avoid per-bin JS arrays; a 40k
  triangle mesh at 64³ is 260k bin entries).
- `closestDistance` — walk cells outward from the query point in expanding
  shells, tracking the best point-triangle distance seen (standard
  closest-point-on-triangle: project onto the plane, then clamp into the
  triangle through its three edge regions and three vertex regions). Stop the
  shell walk once `shellRadius * cell > best`, since no further cell can
  improve it. Return `maxRadius` if nothing is found within it.
- `raycastGrid` — 3D DDA over the grid from the ray origin, testing the
  triangles in each visited cell with Möller–Trumbore, returning the nearest
  hit. This is the brush's picking path: a brute-force `THREE.Raycaster` over
  80k triangles is 5–15ms per `pointermove`, which cannot hold 60Hz.

Document at the top of the file that this single structure serves three
consumers — the SDF sample loop, the brush ray pick, and the merge — which is
why it is built once and passed around rather than rebuilt per use.

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
  - `interface Sdf { values: Float32Array; dims: [number,number,number]; cell: number; min: [number,number,number] }`
  - `buildSdf(grid: TriGrid, resolution: number): { sdf: Sdf; open: boolean }`
  - `OPEN_INTERIOR_FRACTION = 0.05`

**Signing:** flood-fill the exterior inward from the grid boundary; cells the
fill never reaches are interior. No generalised winding numbers.

**Open detection:** for a closed mesh the un-reached set *is* the object's
volume — a substantial cell count. For an open mesh the fill leaks inside and
that set collapses to nearly nothing. Compare the un-reached count against the
bounding-box cell count; below `OPEN_INTERIOR_FRACTION` means open.

- [ ] **Step 1: Write the failing SDF test**

Create `frontend/tests/unit/scene3d-sdf.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { buildTriGrid } from '~/lib/scene3d/voxel/triGrid'
import { buildSdf } from '~/lib/scene3d/voxel/sdf'

const sdfOf = (geo: THREE.BufferGeometry, res = 48) =>
  buildSdf(buildTriGrid(meshDataFromGeometry(geo), 2 / res), res)

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
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-sdf`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildSdf`**

Create `frontend/app/lib/scene3d/voxel/sdf.ts`:

1. Size the grid: `dims` from the padded bbox and `resolution` (the longest axis
   gets `resolution` cells). Pad by 2 cells on every side so the exterior fill
   always has a seed and surface nets has room.
2. Unsigned distance: for every cell, `closestDistance(grid, …, maxRadius)` with
   `maxRadius = 3 * cell`. Cells beyond that keep `3 * cell` — surface nets only
   reads the narrow band, and a full-field exact distance is far more work than
   this needs.
3. Exterior flood fill: a queue seeded with every boundary cell, expanding
   through 6-neighbours, blocked by cells whose unsigned distance is under
   `0.75 * cell` (the surface band). Mark reached cells `exterior`.
4. Open detection: count cells that are neither exterior nor in the surface
   band — the interior. If `interior / totalCells < OPEN_INTERIOR_FRACTION`,
   return `open: true`. Callers must refuse rather than proceed.
5. Sign: `values[i] = exterior[i] ? +unsigned[i] : -unsigned[i]`.

Document the open-detection reasoning inline — the "why" is not recoverable
from the code, and getting it backwards produces plausible-looking garbage.

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

For every cell whose 8 corners do not all share a sign:
1. Find the zero crossing on each of the 12 edges by linear interpolation
   between its two corner values.
2. Place one vertex at the average of those crossings.
3. Record the vertex index in a `cellIndex` lookup (`Int32Array` filled with -1).

Then for each of the three axis directions, every edge with a sign change emits
the quad formed by the four cells sharing that edge, split into two triangles,
wound consistently from the sign of the crossing so normals point outward.

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
export type { Sdf } from './sdf'
export { buildSdf, OPEN_INTERIOR_FRACTION } from './sdf'
export { surfaceNets } from './surfaceNets'

import type { MeshData } from '~/lib/scene3d/mesh'
import { buildTriGrid } from './triGrid'
import { buildSdf } from './sdf'
import { surfaceNets } from './surfaceNets'

/** Rebuild `data` as a uniform-density mesh at `resolution` cells along its
 *  longest axis. `open: true` means the input is not a closed surface and the
 *  result is meaningless — the caller must refuse and offer Solidify instead of
 *  showing it. */
export function remesh(data: MeshData, resolution: number): { data: MeshData; open: boolean } {
  const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (let i = 0; i < data.positions.length; i++) {
    const a = i % 3, v = data.positions[i]!
    if (v < bbox.min[a]!) bbox.min[a] = v
    if (v > bbox.max[a]!) bbox.max[a] = v
  }
  const longest = Math.max(
    bbox.max[0]! - bbox.min[0]!, bbox.max[1]! - bbox.min[1]!, bbox.max[2]! - bbox.min[2]!, 1e-6,
  )
  const cell = longest / resolution
  const { sdf, open } = buildSdf(buildTriGrid(data, cell), resolution)
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
  - `remeshObject(obj: PrimitiveObject, resolution: number): Promise<{ obj: PrimitiveObject; open: true } | { obj: PrimitiveObject; open: false }>`
  - `resolutionForTarget(data: MeshData, targetVertices: number): number`

- [ ] **Step 1: Write the failing action test**

Create `frontend/tests/unit/scene3d-remesh-action.unit.spec.ts` covering:
- `resolutionForTarget` returns a resolution whose remesh lands within ±35% of
  `MESH_DEFAULT_TARGET` for a sphere (it is a search, not a formula — iterate
  a couple of bisection steps against the actual cell count).
- `remeshObject` on a closed mesh object returns `open: false` and a new
  `content.mesh` whose digest differs from the input's.
- `remeshObject` on an object built from a `PlaneGeometry` returns `open: true`
  and leaves `content.mesh` **unchanged**.
- `solidify` on a plane produces a mesh whose remesh reports `open: false`.
- A remesh whose result would exceed `MESH_VERTEX_CAP` is retried at a lower
  resolution rather than throwing.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-remesh-action`
Expected: FAIL — `remeshObject is not exported`.

- [ ] **Step 3: Implement `solidify`**

Create `frontend/app/lib/scene3d/voxel/solidify.ts`: offset every vertex along
its normal by `+thickness/2` and `-thickness/2` to make two shells, reverse the
winding on the inner shell, and stitch the boundary edges (edges belonging to
exactly one triangle) into a rim. The result is closed, so `buildSdf` will sign
it.

- [ ] **Step 4: Implement `remeshObject` and `resolutionForTarget`**

Add both to `frontend/app/lib/scene3d/toMesh.ts`. `remeshObject` decodes the
object's buffer, calls `remesh`, and on `open: false` re-encodes into a new
`content`. If the result exceeds `MESH_VERTEX_CAP`, halve the resolution and
retry (at most 3 times) rather than throwing — the user asked for a shape, not
an error.

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

Create `frontend/tests/unit/scene3d-sculpt-session.unit.spec.ts` covering:
- `verticesNear` on a sphere returns only vertices inside the radius, and the
  count grows with the radius
- `beginStroke` → move some vertices → `endStroke` → `undo()` restores the
  **exact** prior positions (assert byte equality against a snapshot taken
  before the stroke)
- undo past `UNDO_DEPTH` strokes returns `false` and leaves positions untouched
- `commit()` returns a `meshKey` equal to `contentDigest(mesh)`
- `dirty` is false on construction, true after a stroke, false after commit
- `pick` returns a hit for a ray aimed at the mesh and null for one that misses

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-sculpt-session`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the session**

Create `frontend/app/lib/scene3d/sculpt/session.ts`:

- **Working buffer**: `positions` is a `Float32Array` copied from the decoded
  `MeshData`; `indices` is shared by reference (topology never changes during a
  stroke).
- **Spatial hash**: a uniform grid over vertex positions, cell ≈ the median edge
  length. Rebuilt on `endStroke` (positions moved), not per pointermove.
- **Undo ring**: on `beginStroke`, start an empty `Map<number, [number,number,number]>`.
  `recordVertex(i)` stores the vertex's position **only the first time** it is
  touched in this stroke. `endStroke` pushes the map into a 32-deep ring,
  dropping the oldest. `undo` pops and writes the stored positions back.
  Bounded memory; never a full mesh copy.
- **Picking**: build a `TriGrid` on construction and after each `endStroke`;
  `pick` delegates to `raycastGrid`.
- **Normals**: `recomputeNormals` runs once per `endStroke`, never per
  pointermove.

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

Create `frontend/tests/unit/scene3d-sculpt-brushes.unit.spec.ts` covering, on a
flat grid patch in the XZ plane with a known +Y normal:
- **draw** pushes vertices in +Y; with `invert: true` it pushes −Y
- **draw** moves the centre vertex further than one at 80% of the radius
  (falloff monotonicity), and does not move a vertex outside the radius at all
- **inflate** on a sphere moves each vertex along **its own** normal — assert
  that two vertices on opposite sides move in opposite world directions, which
  a normal-at-centre implementation would fail
- **smooth** on a patch with one spiked vertex reduces that spike's deviation
  from its neighbours' mean
- **flatten** on a bumpy patch reduces the variance of the Y coordinates inside
  the radius
- every brush calls `recordVertex` for each vertex it moves — assert undo
  restores exactly

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-sculpt-brushes`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the brushes**

Create `frontend/app/lib/scene3d/sculpt/brushes.ts`. All four share one loop:
`session.verticesNear(...)` → per-vertex `t = distance / radius` →
`w = falloff(t) * strength` → a per-kind displacement:

| Kind | Displacement |
|---|---|
| `draw` | `stamp.normal * w * radius * (invert ? -1 : 1)` |
| `inflate` | the vertex's **own** normal `* w * radius * (invert ? -1 : 1)` |
| `smooth` | `(mean(neighbours) - position) * w` |
| `flatten` | `(projectionOntoLocalPlane - position) * w` where the plane is fitted from the vertices in range |

`falloff(t) = t >= 1 ? 0 : (1 - t*t) ** 2` (smooth at the rim, flat-ish at the
centre). Every kind calls `session.recordVertex(i)` **before** writing.

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
- **pinch** moves vertices toward the stamp centre and reduces their mean
  distance from it
- **crease** both pinches and displaces — assert both the distance reduction
  *and* the along-normal movement, so an implementation that does only one fails
- **grab** translates vertices by `stamp.drag` scaled by falloff, **ignoring
  normals entirely** — assert that a grab on a curved surface moves two
  vertices with opposite normals in the *same* world direction, which every
  normal-driven brush would fail

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-sculpt-brushes`
Expected: FAIL on the three new cases.

- [ ] **Step 3: Implement the three brushes**

| Kind | Displacement |
|---|---|
| `pinch` | `normalize(centre - position) * w * radius * (invert ? -1 : 1)` |
| `crease` | pinch, plus `stamp.normal * w * radius * (invert ? -1 : 1)` |
| `grab` | `stamp.drag * w` — no normal term at all |

`grab` is the only kind that reads `stamp.drag`; it is undefined for the others
and must be treated as a no-op if missing.

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

Create `frontend/tests/unit/scene3d-merge.unit.spec.ts` covering:
- **union** of two spheres overlapping by half their radius produces **one**
  connected component (flood-fill the result's vertex adjacency and assert a
  single component) — two components would mean the fields never combined
- union volume is greater than either input and **less than their sum** (they
  overlap, so a naive concatenation would fail this)
- **subtract** produces a volume smaller than the base sphere
- **intersect** of two spheres overlapping by half produces a volume smaller
  than either
- **blend > 0** produces a strictly larger volume than `blend: 0` for the same
  union — the fillet adds material
- an open input returns `open: true` and does not mesh

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- scene3d-merge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mergeMeshes`**

Create `frontend/app/lib/scene3d/voxel/merge.ts`:

1. Union the inputs' bounding boxes, pad by 2 cells, size one shared grid from
   `resolution`.
2. Build an `Sdf` per input **on that shared grid** (same origin, same dims — a
   per-input grid would need resampling and would blur the result).
3. If any input reports `open: true`, return `{ open: true }` immediately.
4. Combine per cell:
   - `union` → `min(a, b)`
   - `intersect` → `max(a, b)`
   - `subtract` → `max(a, -b)`, first input is the base
   - `blend > 0` swaps `min`/`max` for the polynomial smooth-min:
     `smin(a, b, k) = min(a, b) - h*h*k/4` where `h = max(k - |a - b|, 0) / k`
5. `surfaceNets` the combined field. If the result exceeds `MESH_VERTEX_CAP`,
   halve the resolution and retry (at most 3 times).

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
