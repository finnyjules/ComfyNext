/**
 * Per-wired-layer treatments (Phase 1: mask reference) persisted on the node as
 * `comfynext_wiredTreatments`, keyed by the unified StackKey ('w:<slot>'). This
 * mirrors how comfynext_stackOrder lives in node.data.properties. Pure helpers so
 * the logic is unit-testable outside the SFC.
 */
export interface WiredTreatment { maskedByKey?: string }
export type WiredTreatments = Record<string, WiredTreatment>

export function readWiredTreatments(node: any): WiredTreatments {
  return (node?.data?.properties?.comfynext_wiredTreatments as WiredTreatments | undefined) ?? {}
}

function writeWiredTreatments(node: any, next: WiredTreatments) {
  if (!node?.data) return
  if (!node.data.properties) node.data.properties = {}
  node.data.properties.comfynext_wiredTreatments = next
}

/** Set/clear the mask reference for a wired slot (1-based). Empty key clears. */
export function setWiredMask(node: any, slot: number, maskedByKey: string) {
  const key = `w:${slot}`
  const cur = { ...readWiredTreatments(node) }
  if (maskedByKey) cur[key] = { ...cur[key], maskedByKey }
  else { const t = { ...cur[key] }; delete t.maskedByKey; if (Object.keys(t).length) cur[key] = t; else delete cur[key] }
  writeWiredTreatments(node, cur)
}

/** Every other present layer key (cross-source), excluding `selfKey`. */
export function maskCandidateKeys(presentKeys: string[], selfKey: string): string[] {
  return presentKeys.filter(k => k !== selfKey)
}
