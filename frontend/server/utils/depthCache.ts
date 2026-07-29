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

/** The three ComfyUI asset roots a Compositor image can live in. A wired layer's
 *  image is usually in `output` or `temp`; an uploaded one is in `input`. */
export type AssetType = 'input' | 'output' | 'temp'
const ASSET_TYPES = new Set<AssetType>(['input', 'output', 'temp'])

/** Null for anything unrecognised — coercing an unknown root to a default would
 *  silently read the wrong directory. */
export function assetType(type: string | undefined | null): AssetType | null {
  const t = (type ?? '').trim()
  if (!t) return 'input'
  return ASSET_TYPES.has(t as AssetType) ? (t as AssetType) : null
}

/**
 * Relative path under an asset root, or null if it could escape it. These parts come
 * straight off a client-supplied /view URL, so they are untrusted: reject traversal,
 * absolute paths and backslashes rather than trying to normalise them.
 */
export function safeAssetRelPath(filename: string, subfolder?: string): string | null {
  const f = (filename ?? '').trim()
  const s = (subfolder ?? '').trim()
  const unsafe = (v: string) =>
    v.includes('..') || v.includes('\\') || v.startsWith('/')
  if (!f || unsafe(f)) return null
  if (!s) return f
  if (unsafe(s)) return null
  return `${s.replace(/\/+$/, '')}/${f}`
}
