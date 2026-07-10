/**
 * Expressive arrangement of a Frame layer-group's members.
 *
 * Frame groups are organizational only — the paint stack is flat and never
 * consults groups. So "expressive placement" here BAKES new centre positions +
 * rotation into the member layers (the renderer already honours layer.x/y/
 * rotation). The container is a fixed pixel box snapshotted when expressive is
 * enabled (see CompositorModal), so rerolls stay stable instead of the group's
 * bounds drifting as members move.
 *
 * All px here are in the SAME space the renderer uses:
 *   pixelCentre = (W/2 + layer.x·W, H/2 + layer.y·H)   (layer coords are centred)
 * so callers convert layer↔px around that. This module is pure geometry.
 */

import { layoutExpressiveBoxes, type ExpressiveBoxParams } from '../../../shared/text-layout/boxes'

export interface ArrangeMember { id: string; wPx: number; hPx: number }
export interface BoxPx { x: number; y: number; w: number; h: number }
export interface ArrangeResult { id: string; cx: number; cy: number; rotation: number }

/** Union bounding box (px) of members given each one's centre + size. */
export function unionBBoxPx(members: Array<{ cx: number; cy: number; wPx: number; hPx: number }>): BoxPx {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const m of members) {
    minX = Math.min(minX, m.cx - m.wPx / 2)
    minY = Math.min(minY, m.cy - m.hPx / 2)
    maxX = Math.max(maxX, m.cx + m.wPx / 2)
    maxY = Math.max(maxY, m.cy + m.hPx / 2)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Scatter members (keeping their sizes) within a fixed px box; returns each
 *  member's new CENTRE px + rotation (deg). */
export function arrangeMembers(members: ArrangeMember[], box: BoxPx, params: ExpressiveBoxParams): ArrangeResult[] {
  const placed = layoutExpressiveBoxes({
    items: members.map(m => ({ id: m.id, w: m.wPx, h: m.hPx })),
    boxWidth: box.w, boxHeight: box.h, params,
  })
  const byId = new Map(members.map(m => [m.id, m]))
  return placed.map((p) => {
    const m = byId.get(p.id)!
    return { id: p.id, cx: box.x + p.x + m.wPx / 2, cy: box.y + p.y + m.hPx / 2, rotation: p.rotation }
  })
}
