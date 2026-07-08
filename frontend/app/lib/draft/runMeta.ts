/**
 * Per-node run metadata bridging submit time (runVueWorkflow, layouts/default.vue)
 * and result time (appendTake sites, VueNodeCanvas.vue). Keyed by node id, not
 * promptId — the submit path doesn't learn the promptId synchronously.
 *
 * Known accepted race (spec §edge cases): toggling Draft→Final and resubmitting
 * while a draft result is still streaming can mislabel that late result. Cosmetic.
 */
const draftByNode = new Map<string, { restore: Record<string, any> }>()
const promoteByNode = new Map<string, { fromTakeId: string; overrides: Record<string, any> }>()

export function markDraftRun(nodeIds: string[], restoreById: Record<string, Record<string, any>>): void {
  for (const id of nodeIds) draftByNode.set(String(id), { restore: restoreById[String(id)] ?? {} })
}

export function clearDraftRun(nodeIds: string[]): void {
  for (const id of nodeIds) draftByNode.delete(String(id))
}

export function draftMetaFor(nodeId: string): { restore: Record<string, any> } | null {
  return draftByNode.get(String(nodeId)) ?? null
}

export function setPendingPromote(nodeId: string, meta: { fromTakeId: string; overrides: Record<string, any> }): void {
  promoteByNode.set(String(nodeId), meta)
}

export function consumePendingPromote(nodeId: string): { fromTakeId: string; overrides: Record<string, any> } | null {
  const m = promoteByNode.get(String(nodeId)) ?? null
  promoteByNode.delete(String(nodeId))
  return m
}

export function peekPendingPromote(nodeId: string): { fromTakeId: string; overrides: Record<string, any> } | null {
  return promoteByNode.get(String(nodeId)) ?? null
}
