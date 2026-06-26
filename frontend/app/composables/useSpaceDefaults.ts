import type { Scene } from '~/lib/spacetype/scene'

let _cache: Promise<Record<string, Scene>> | null = null
let _resolved: Record<string, Scene> = {}

/** Fetch the {effectId: scene} default map once; memoized. Network failure → {} (today's behavior). */
export function loadSpaceDefaults(): Promise<Record<string, Scene>> {
  if (!_cache) {
    _cache = fetch('/comfynext/space_defaults')
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((m: Record<string, Scene>) => { _resolved = m || {}; return _resolved })
  }
  return _cache
}

/** Synchronous read of the resolved map (null before load resolves or if the effect has none). */
export function spaceDefaultFor(id: string): Scene | null {
  return _resolved[id] ?? null
}

/** Persist a scene as effect `id`'s default; updates the in-memory cache on success. */
export async function saveSpaceDefault(id: string, scene: Scene): Promise<boolean> {
  try {
    const r = await fetch(`/comfynext/space_default/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scene),
    })
    if (!r.ok) return false
    _resolved = { ..._resolved, [id]: scene }
    return true
  } catch { return false }
}

/** Test-only: reset the module cache. */
export function __resetSpaceDefaultsCache(): void { _cache = null; _resolved = {} }
