/**
 * Decide which wired layers need a silhouette mask compiled into the backend
 * Compositor node at submit. Pure so it's unit-testable. `connectedSlots1Based`
 * are the 1-based wired slots actually connected; `treatments` is
 * sailor_wiredTreatments. Returns one job per wired content slot that is
 * masked and present.
 *
 * `layers` is `sailor_localLayers`. On a schema-2 (unified) frame a connected
 * slot IS a layer, and the editor writes that layer's mask onto the LAYER — the
 * treatments registry is left frozen at its pre-migration value. So the registry
 * is only the BASE here and a wired layer overrides its own slot, including
 * clearing it. Reading the registry alone rendered the mask the editor had
 * stopped showing (the same trap `injectCompositorCloners` fell into, fixed the
 * same way in d49fc31f1).
 */
import { layerMaskRef } from '~/composables/useCompositorLayers'

export interface WiredMaskJob {
  contentSlot: number   // 1-based wired slot to receive layer{N}_mask
  sourceKey: string     // StackKey of the mask source ('w:<slot>' | 'l:<id>')
  showSource: boolean   // if false, the source must be hidden from the composite
}

/** The minimum layer shape the overlay reads. `slot` is 0-BASED. */
export interface MaskPlanLayer {
  id: string
  kind?: string
  slot?: number
  maskedByKey?: string
  maskedById?: string
  maskShowSource?: boolean
  unlinked?: boolean
}

export function planWiredMaskJobs(
  treatments: Record<string, { maskedByKey?: string; showSource?: boolean }>,
  connectedSlots1Based: number[],
  layers: readonly MaskPlanLayer[] = [],
): WiredMaskJob[] {
  const present = new Set(connectedSlots1Based)

  // Base: the legacy per-slot registry, for slots no layer has claimed yet.
  const eff = new Map<number, { maskedByKey?: string; showSource: boolean }>()
  for (const slot of connectedSlots1Based) {
    const t = treatments[`w:${slot}`]
    eff.set(slot, { maskedByKey: t?.maskedByKey, showSource: !!t?.showSource })
  }

  // Overlay: a schema-2 wired layer owns its slot's mask outright.
  const wiredById = new Map<string, MaskPlanLayer>()
  const ownKey = new Map<number, string>()      // 1-based slot → its layer's key
  for (const l of layers) {
    if (l?.kind !== 'wired' || !Number.isInteger(l.slot)) continue
    const n = (l.slot as number) + 1
    wiredById.set(l.id, l)
    ownKey.set(n, `l:${l.id}`)
    if (!eff.has(n)) continue                   // slot not connected → no job anyway
    eff.set(n, { maskedByKey: layerMaskRef(l), showSource: !!l.maskShowSource })
  }

  const jobs: WiredMaskJob[] = []
  for (const slot of connectedSlots1Based) {
    const t = eff.get(slot)
    if (!t?.maskedByKey) continue
    const src = t.maskedByKey
    // A layer can't mask itself — under either of its keys.
    if (src === `w:${slot}` || src === ownKey.get(slot)) continue
    // A wired source must be present to mask against; a local source is always usable.
    if (src.startsWith('w:') && !present.has(Number(src.slice(2)))) continue
    // A wired LAYER source only has pixels while its own slot is live: masking
    // against a cut/unlinked one would bake a blank silhouette and erase the
    // content entirely on the server.
    if (src.startsWith('l:')) {
      const w = wiredById.get(src.slice(2))
      if (w && (w.unlinked || !present.has((w.slot as number) + 1))) continue
    }
    jobs.push({ contentSlot: slot, sourceKey: src, showSource: t.showSource })
  }
  return jobs
}
