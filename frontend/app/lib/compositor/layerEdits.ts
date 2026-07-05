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
