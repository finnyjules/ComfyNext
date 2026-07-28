// Capsule state ↔ properties round-trip. Same reason persistTakes.ts exists:
// convertToLiteGraph writes a CURATED field set, so anything not explicitly
// stashed into `properties` is dropped on every save. `collapsed` and `hasRun`
// were both being dropped, which is why a reloaded project came back with
// every capsule expanded into a full card again — the spec says the flag
// persists with the project.
//
// WHAT IS DELIBERATELY NOT PERSISTED: `running` and `runningSince`. Both are
// live-run state, and `runningSince` is a wall-clock timestamp — saving a
// project mid-run and reloading it an hour later would restore a node that
// believes it has been rendering for an hour, with a counter that ticks
// forever because no completion event is ever coming for a run that ended in
// another session. The stash is an explicit allow-list rather than a spread of
// `data` precisely so neither can be added by accident.

/** The subset of capsule state that survives a save. */
export interface CapsuleStash {
  collapsed?: boolean
  hasRun?: boolean
}

/** Stash `data.collapsed` / `data.hasRun` under `sailor_capsule`. Returns a new
 *  object only when there is something to write (or something stale to drop). */
export function stashCapsuleIntoProperties(
  data: { collapsed?: boolean; hasRun?: boolean } | null | undefined,
  properties: Record<string, any> | undefined,
): Record<string, any> {
  const stash: CapsuleStash = {}
  // ONLY `true` is recorded. `collapsed` is tri-state (see ComfyNode.vue) and
  // `false` is not a preference — it is the transient "pinned open" state from
  // clicking a capsule, which the spec says lasts until you click away.
  // Persisting it made that pin permanent: the click-away that clears it lives
  // in component state, so it cannot survive a reload, and a node expanded once
  // came back expanded forever with nothing able to reset it. Saving only the
  // deliberate collapse means a reloaded node returns to its tier default.
  if (data?.collapsed === true) stash.collapsed = true
  if (data?.hasRun === true) stash.hasRun = true

  if (Object.keys(stash).length) {
    return { ...(properties || {}), sailor_capsule: stash }
  }
  // Nothing to record: drop a stale stash so a node reset to its defaults does
  // not resurrect an old collapse state on the next load.
  if (properties && 'sailor_capsule' in properties) {
    const { sailor_capsule: _drop, ...rest } = properties
    return rest
  }
  return properties ?? {}
}

/** Restore stashed capsule state, or null when absent/malformed. */
export function restoreCapsuleFromProperties(
  properties: Record<string, any> | null | undefined,
): CapsuleStash | null {
  const stash = properties?.sailor_capsule
  if (!stash || typeof stash !== 'object' || Array.isArray(stash)) return null
  const out: CapsuleStash = {}
  // Symmetric with the save side: only `true` is honoured. Projects saved
  // before that rule have `collapsed: false` baked in, and reading it back
  // would keep those nodes expanded forever even though nothing writes it any
  // more. Ignoring it here heals them on load rather than on next save.
  if ((stash as any).collapsed === true) out.collapsed = true
  if ((stash as any).hasRun === true) out.hasRun = true
  return Object.keys(out).length ? out : null
}
