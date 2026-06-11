import type { EffectDef, ShaderFxCatalog } from './types'

let promise: Promise<ShaderFxCatalog> | null = null

/** Fetch the catalog from the backend (proxied /comfynext route). Cached per page load. */
export function fetchShaderFxCatalog(force = false): Promise<ShaderFxCatalog> {
  if (!promise || force) {
    promise = $fetch<ShaderFxCatalog>('/comfynext/shader_effects').catch((err) => {
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

export function assetUrl(file: string): string {
  return `/comfynext/shader_effects/assets/${encodeURIComponent(file)}`
}
