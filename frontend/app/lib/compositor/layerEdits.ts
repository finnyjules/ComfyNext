/**
 * Pure layer-edit operations for the Compositor / Frame editor — the Figma
 * interaction layer (nudge, duplicate, rotate-snap, snap-to-edge). All functions
 * are side-effect-free and return new arrays, so useLocalLayerEditor stays a thin
 * wiring layer and every behavior is unit-tested without Vue or canvas. Mirrors
 * the pure-lib pattern of layerGroups.ts.
 */
import type { LocalLayer } from '~/composables/useCompositorLayers'
import type { LayerGroup } from '~/lib/compositor/layerGroups'

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Move every selected layer by a normalized delta (clamped like the drag path). */
export function nudgeLayers(layers: LocalLayer[], selectedIds: Set<string>, dx: number, dy: number): LocalLayer[] {
  if (!selectedIds.size || (dx === 0 && dy === 0)) return layers
  return layers.map(l => (selectedIds.has(l.id)
    ? ({ ...l, x: clamp(l.x + dx, -0.5, 1.5), y: clamp(l.y + dy, -0.5, 1.5) } as LocalLayer)
    : l))
}

/** Duplicate the selected layers: fresh ids, offset, and a fresh group id per
 *  distinct source group (added as a registry root). Deep-clones layer data.
 *  mkId/mkGid are injected so callers control id minting (and tests stay
 *  deterministic). Nested-group parent links are NOT remapped (v1 flat copy). */
export function duplicateLayers(
  layers: LocalLayer[],
  groups: LayerGroup[],
  selectedIds: Set<string>,
  offset: number,
  mkId: () => string,
  mkGid: () => string,
): { layers: LocalLayer[]; groups: LayerGroup[]; newIds: string[] } {
  const sel = layers.filter(l => selectedIds.has(l.id))
  if (!sel.length) return { layers, groups, newIds: [] }
  const groupMap = new Map<string, string>()
  const newIds: string[] = []
  const clones = sel.map((l) => {
    const c = JSON.parse(JSON.stringify(l)) as any
    c.id = mkId(); newIds.push(c.id)
    c.x = clamp(l.x + offset, -0.5, 1.5)
    c.y = clamp(l.y + offset, -0.5, 1.5)
    if (l.groupId) {
      if (!groupMap.has(l.groupId)) groupMap.set(l.groupId, mkGid())
      c.groupId = groupMap.get(l.groupId)
    }
    return c as LocalLayer
  })
  const newGroups: LayerGroup[] = [...groups, ...[...groupMap.values()].map(id => ({ id }))]
  return { layers: [...layers, ...clones], groups: newGroups, newIds }
}

/** Round an angle (degrees) to the nearest `step`; pass through when step falsy. */
export function snapAngle(deg: number, step: number | null): number {
  if (!step) return deg
  return Math.round(deg / step) * step
}
