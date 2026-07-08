/** Promote — re-run a draft take's exact snapshot at full quality (spec §Promote).
 *  The overrides substitute into the run-path workflow copy AFTER the draft
 *  rewrite, so a promote wins over draft mode for its node. */
import type { Take } from '~/composables/useTakes'

export function promoteOverridesFor(take: Take): Record<string, any> | null {
  if (!take?.draft) return null
  const p = take.params ?? {}
  const o: Record<string, any> = { ...(p.draftRestore ?? {}) }
  if (p.seed !== undefined) o.seed = p.seed
  if (typeof p.prompt === 'string' && p.prompt) o.prompt = p.prompt
  if (p.aspect_ratio !== undefined) o.aspect_ratio = p.aspect_ratio
  return Object.keys(o).length ? o : null
}

export function applyPendingPromotes(
  plainWorkflow: any,
  vnodes: any[],
  consume: (nodeId: string) => { fromTakeId: string; overrides: Record<string, any> } | null,
): string[] {
  const promoted: string[] = []
  const vById = new Map((vnodes || []).map((n: any) => [String(n.id), n]))
  for (const wn of plainWorkflow?.nodes ?? []) {
    const meta = consume(String(wn.id))
    if (!meta) continue
    const defs = vById.get(String(wn.id))?.data?.widgetDefs as Array<{ name?: string }> | undefined
    if (!defs || !Array.isArray(wn.widgets_values)) continue
    for (const [name, value] of Object.entries(meta.overrides)) {
      const i = defs.findIndex(d => d?.name === name)
      if (i >= 0 && i < wn.widgets_values.length) wn.widgets_values[i] = value
    }
    promoted.push(String(wn.id))
  }
  return promoted
}
