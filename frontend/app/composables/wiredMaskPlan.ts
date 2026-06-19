/**
 * Decide which wired layers need a silhouette mask compiled into the backend
 * Compositor node at submit. Pure so it's unit-testable. `connectedSlots1Based`
 * are the 1-based wired slots actually connected; `treatments` is
 * comfynext_wiredTreatments. Returns one job per wired content slot that is
 * masked and present.
 */
export interface WiredMaskJob {
  contentSlot: number   // 1-based wired slot to receive layer{N}_mask
  sourceKey: string     // StackKey of the mask source ('w:<slot>' | 'l:<id>')
  showSource: boolean   // if false, the source must be hidden from the composite
}

export function planWiredMaskJobs(
  treatments: Record<string, { maskedByKey?: string; showSource?: boolean }>,
  connectedSlots1Based: number[],
): WiredMaskJob[] {
  const present = new Set(connectedSlots1Based)
  const jobs: WiredMaskJob[] = []
  for (const slot of connectedSlots1Based) {
    const t = treatments[`w:${slot}`]
    if (!t?.maskedByKey) continue
    if (t.maskedByKey === `w:${slot}`) continue // a layer can't mask itself
    // A wired source must be present to mask against; a local source is always usable.
    if (t.maskedByKey.startsWith('w:') && !present.has(Number(t.maskedByKey.slice(2)))) continue
    jobs.push({ contentSlot: slot, sourceKey: t.maskedByKey, showSource: !!t.showSource })
  }
  return jobs
}
