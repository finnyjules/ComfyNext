import type { EmbedSurface } from './contract'

/**
 * One entry per embeddable surface. This list IS the feature's scope — the same
 * declaration-per-capability shape as shader_effects/manifest.json.
 * Dynamic imports so an embed bundle only ever pulls in its own adapter.
 */
const REGISTRY: Record<string, () => Promise<{ default: EmbedSurface }>> = {
  shader: () => import('./surfaces/shader'),
  gradient: () => import('./surfaces/gradient'),
}

export function embedSurfaceKinds(): string[] {
  return Object.keys(REGISTRY)
}

export function isEmbeddable(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, kind)
}

export async function loadEmbedSurface(kind: string): Promise<EmbedSurface | null> {
  const loader = REGISTRY[kind]
  if (!loader) return null
  return (await loader()).default
}
