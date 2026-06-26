let _cache: Promise<Record<string, string>> | null = null
let _resolved: Record<string, string> = {}

/** Fetch the {effectId: imageUrl} map of captured thumbnails once; memoized. Failure → {}. */
export function loadEffectThumbnails(): Promise<Record<string, string>> {
  if (!_cache) {
    _cache = fetch('/comfynext/space_thumbnails')
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((m: Record<string, string>) => { _resolved = m || {}; return _resolved })
  }
  return _cache
}

/** Sync read of the resolved map (null before load resolves or if the effect has no thumbnail). */
export function effectThumbUrl(id: string): string | null { return _resolved[id] ?? null }

/** POST a captured PNG as effect `id`'s thumbnail; updates the cached URL (cache-busted) on success. */
export async function saveEffectThumbnail(id: string, blob: Blob): Promise<boolean> {
  try {
    const r = await fetch(`/comfynext/space_thumbnail/${id}`, { method: 'POST', body: blob })
    if (!r.ok) return false
    _resolved = { ..._resolved, [id]: `/comfynext/space_thumbnail/${id}?v=${Date.now()}` }
    return true
  } catch { return false }
}

/** Test-only: reset the module cache. */
export function __resetEffectThumbnailsCache(): void { _cache = null; _resolved = {} }
