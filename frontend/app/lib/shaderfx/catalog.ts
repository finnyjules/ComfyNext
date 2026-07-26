import type { EffectDef, ShaderFxCatalog } from './types'

let promise: Promise<ShaderFxCatalog> | null = null
// Last successfully resolved catalog, kept alongside `promise` so a synchronous
// reader (see getEffectSync below) never has to await. Cleared only by a fresh
// `force` fetch overwriting it on success — a failed refetch leaves the previous
// good catalog in place rather than blanking a working sync reader.
let cached: ShaderFxCatalog | null = null

/** Fetch the catalog from the backend (proxied /sailor route). Cached per page load. */
export function fetchShaderFxCatalog(force = false): Promise<ShaderFxCatalog> {
  if (!promise || force) {
    promise = $fetch<ShaderFxCatalog>('/sailor/shader_effects').then((cat) => {
      cached = cat
      return cat
    }).catch((err) => {
      promise = null
      throw err
    })
  }
  return promise
}

export async function getEffect(id: string): Promise<EffectDef | null> {
  const cat = await fetchShaderFxCatalog()
  return cat.effects.find(e => e.id === id) ?? null
}

/**
 * Synchronous read of whatever catalog `fetchShaderFxCatalog` has already resolved
 * elsewhere (a page's `onMounted`, a preload call, etc). Never triggers a fetch and
 * never awaits — returns null if the catalog hasn't resolved yet. Exists for
 * `~/lib/shaderfill/field.ts`, whose `resolveField()` renders synchronously (it's a
 * canvas/WebGL readback bridge with no await point) and so cannot use the async
 * `getEffect` above.
 */
export function getEffectSync(id: string): EffectDef | null {
  return cached?.effects.find(e => e.id === id) ?? null
}

export function assetUrl(file: string, v?: string | number): string {
  const base = `/sailor/shader_effects/assets/${encodeURIComponent(file)}`
  // Append a content version (the file's mtime, from the catalog) so a rebaked
  // texture is a NEW url the browser must fetch fresh — defeats any stale cache.
  return v != null ? `${base}?v=${encodeURIComponent(String(v))}` : base
}
