/**
 * Content-addressed naming for cached depth maps. Pure and dependency-free so the
 * unit tests never touch the model or the filesystem.
 *
 * Keyed by CONTENT, not filename: the same photo dropped into two documents — or
 * re-uploaded under a new name — reuses one depth map.
 */
import { createHash } from 'node:crypto'

export function depthCacheKey(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export function depthCacheName(key: string): string {
  return `depth_${key}.png`
}
