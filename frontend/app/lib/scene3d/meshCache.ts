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
