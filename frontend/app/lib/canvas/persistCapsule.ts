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
  // `collapsed` is tri-state on purpose (see ComfyNode.vue): undefined means
  // "use the tier default", so only a real boolean is worth recording — writing
  // `collapsed: false` for an untouched node would freeze it against a later
  // change to its tier default.
  if (typeof data?.collapsed === 'boolean') stash.collapsed = data.collapsed
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
  if (typeof (stash as any).collapsed === 'boolean') out.collapsed = (stash as any).collapsed
  if ((stash as any).hasRun === true) out.hasRun = true
  return Object.keys(out).length ? out : null
}
