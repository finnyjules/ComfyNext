// GLB loading with per-URL caching. Fetch first so we can enforce a size cap
// before parsing; GLTFLoader.parse then works from the ArrayBuffer directly.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const GLB_SIZE_CAP_BYTES = 50 * 1024 * 1024

const cache = new Map<string, Promise<THREE.Group>>()

export function loadGlb(url: string): Promise<THREE.Group> {
  let p = cache.get(url)
  if (!p) {
    p = fetchAndParse(url)
    // Don't cache failures — a retry should actually retry.
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  // Clone per consumer so the same GLB can appear multiple times in a scene.
  return p.then((g) => g.clone(true))
}

async function fetchAndParse(url: string): Promise<THREE.Group> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`glb fetch failed: ${res.status}`)
  const buf = await res.arrayBuffer()
  if (buf.byteLength > GLB_SIZE_CAP_BYTES) throw new Error('too-large')
  const loader = new GLTFLoader()
  const gltf = await loader.parseAsync(buf, '')
  return gltf.scene
}
