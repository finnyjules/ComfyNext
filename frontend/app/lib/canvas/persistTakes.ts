// Takes ↔ properties round-trip. convertToLiteGraph's node mapping writes a
// curated field set, so anything not explicitly stashed into `properties` is
// DROPPED on save — which is why filmstrips (takes + the user's pick) used to
// vanish on every reload while only `sailor_preview` (the active image)
// survived. These helpers stash the takes array + activeTakeId alongside it
// and restore them on load. Pure, so the round-trip is unit-testable.

/** Stash `data.takes`/`data.activeTakeId` into node properties (new object
 *  unless nothing changed). Removes a stale stash when takes were discarded. */
export function stashTakesIntoProperties(
  data: { takes?: any[] | null; activeTakeId?: string | null } | null | undefined,
  properties: Record<string, any> | undefined,
): Record<string, any> {
  const takes = data?.takes
  if (Array.isArray(takes) && takes.length) {
    return {
      ...(properties || {}),
      sailor_takes: { takes, activeTakeId: data?.activeTakeId ?? null },
    }
  }
  // No takes: drop a stale stash so a discarded filmstrip can't resurrect.
  if (properties && 'sailor_takes' in properties) {
    const { sailor_takes: _drop, ...rest } = properties
    return rest
  }
  return properties ?? {}
}

/** Restore a stashed filmstrip, or null when absent/malformed. A stale
 *  activeTakeId (its take gone) falls back to the newest take. */
export function restoreTakesFromProperties(
  properties: Record<string, any> | null | undefined,
): { takes: any[]; activeTakeId: string | null } | null {
  const stash = properties?.sailor_takes
  if (!stash || typeof stash !== 'object') return null
  const takes = (stash as any).takes
  if (!Array.isArray(takes) || !takes.length) return null
  if (!takes.every((t: any) => t && typeof t === 'object' && t.id != null)) return null
  const wanted = (stash as any).activeTakeId
  const activeTakeId = takes.some((t: any) => t.id === wanted)
    ? wanted
    : takes[takes.length - 1].id
  return { takes, activeTakeId }
}
