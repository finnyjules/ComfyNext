// Nested-pattern fill helper: renders a sub-pattern config to a cached canvas
// using a SEPARATE TextureFxRenderer instance so the main singleton is never
// re-entered.  The caller passes a flat texture config (mode/motif/colors/etc.)
// without a 'fills' key; this module deletes 'fills' from any copy it receives
// as a hard recursion guard (one level only, never deeper).

import { createTextureFx } from '~/lib/texturefx/renderer'
import type { Params } from '~/lib/spacetype/effect'

let _r: ReturnType<typeof createTextureFx> | null = null
const _cache = new Map<string, HTMLCanvasElement>()
const CACHE_CAP = 32

// Render a sub-pattern (ONE level: fills stripped) to a cached canvas on a
// SEPARATE renderer so the main render is never reentered.
export function getPatternFillCanvas(sub: Record<string, unknown>, size = 256): HTMLCanvasElement | null {
  if (!sub) return null
  const key = JSON.stringify(sub) + ':' + size
  const hit = _cache.get(key)
  if (hit) {
    // Refresh recency: re-insert moves the entry to newest in insertion order.
    _cache.delete(key); _cache.set(key, hit); return hit
  }
  try {
    if (!_r) _r = createTextureFx()
    const safe = { ...sub } as any; delete safe.fills   // hard guard: never recurse
    const c = _r.render(safe as Params, size, size)
    // Copy out (the renderer reuses its own canvas) so the cache entry is stable.
    const out = document.createElement('canvas'); out.width = size; out.height = size
    out.getContext('2d')!.drawImage(c, 0, 0)
    _cache.set(key, out)
    // Evict oldest entries while over cap.
    while (_cache.size > CACHE_CAP) { const oldest = _cache.keys().next().value; if (oldest === undefined) break; _cache.delete(oldest) }
    return out
  } catch { return null }
}

export function patternFillKey(sub: Record<string, unknown>, size = 256): string {
  return JSON.stringify(sub) + ':' + size
}

export function clearPatternFillCache(): void { _cache.clear() }
