import type { EffectDef, ShaderFxCatalog } from './types'

let promise: Promise<ShaderFxCatalog> | null = null

/** Fetch the catalog from the backend (proxied /sailor route). Cached per page load. */
export function fetchShaderFxCatalog(force = false): Promise<ShaderFxCatalog> {
  if (!promise || force) {
    promise = $fetch<ShaderFxCatalog>('/sailor/shader_effects').catch((err) => {
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

export function assetUrl(file: string, v?: string | number): string {
  const base = `/sailor/shader_effects/assets/${encodeURIComponent(file)}`
  // Append a content version (the file's mtime, from the catalog) so a rebaked
  // texture is a NEW url the browser must fetch fresh — defeats any stale cache.
  return v != null ? `${base}?v=${encodeURIComponent(String(v))}` : base
}
