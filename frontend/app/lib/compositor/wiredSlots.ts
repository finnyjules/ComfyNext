/**
 * Pure helpers for wired-slot bookkeeping on the Compositor node (no DOM, so
 * they unit-test in the vitest node env).
 *
 * Wired slots are derived from EDGES only, so a slot that isn't in `liveSlots`
 * is genuinely gone — there's no load-time window where a wired slot looks
 * absent. That's what makes pruning safe.
 */

/**
 * Drop hidden/locked flag entries for slots that no longer have a wired source.
 * Returns `null` when nothing changed, so callers can skip a redundant node
 * write (and the node-property churn it causes).
 *
 * Without this, hiding a slot and then unplugging its wire leaves a stale slot
 * number behind, and the NEXT image wired into that port renders invisible with
 * no visible cause.
 */
export function pruneWiredSlotFlags(flags: number[], liveSlots: number[]): number[] | null {
  if (!flags.length) return null
  const live = new Set(liveSlots)
  const kept = flags.filter(s => live.has(s))
  return kept.length === flags.length ? null : kept
}

/**
 * Drop entries of a slot-keyed record whose slot no longer has a wire. Returns
 * `null` when nothing changed, so callers skip a redundant node write.
 *
 * `parseSlot` maps a record key to its slot number, or null when the key isn't
 * slot-shaped — unrecognized keys are KEPT (conservative: never discard state
 * this function doesn't understand).
 *
 * Same trap `pruneWiredSlotFlags` fixes for hidden/locked flags: without this,
 * a stale mask or cloner on a freed slot is inherited by the next image wired
 * into that port, rendering invisible or half-erased.
 */
export function pruneSlotKeyedRecord<T>(
  rec: Record<string, T>,
  liveSlots: number[],
  parseSlot: (key: string) => number | null,
): Record<string, T> | null {
  const keys = Object.keys(rec)
  if (!keys.length) return null
  const live = new Set(liveSlots)
  const next: Record<string, T> = {}
  let changed = false
  for (const key of keys) {
    const slot = parseSlot(key)
    if (slot !== null && !live.has(slot)) { changed = true; continue }
    next[key] = rec[key] as T
  }
  return changed ? next : null
}

/**
 * Place `key` directly above `anchor` in a bottom→top stack order. Used when a
 * wired layer is copied into the frame: the copy must hold the wired slot's
 * z-position instead of jumping to the top of the stack.
 *
 * Absent anchor ⇒ append (top). Already-present key ⇒ moved, never duplicated.
 */
export function insertStackKeyAbove(order: string[], key: string, anchor: string): string[] {
  const without = order.filter(k => k !== key)
  const i = without.indexOf(anchor)
  if (i < 0) return [...without, key]
  return [...without.slice(0, i + 1), key, ...without.slice(i + 1)]
}
