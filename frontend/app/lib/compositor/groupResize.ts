/**
 * Proportional resize for a multi-selection (a group, or an ad-hoc marquee set).
 * One uniform scale factor `f` scales every child's position (about a fixed anchor)
 * and its size. Uniform, so text/line/path (uniform-size kinds) scale cleanly.
 */
import type { LocalLayer } from '~/composables/useCompositorLayers'

export interface Box { cx: number; cy: number; w: number; h: number }
export type Handle = 'tl' | 'tr' | 'br' | 'bl'

/** Axis-aligned union of member boxes (px). */
export function unionBox(boxes: Box[]): Box {
  const xs = boxes.flatMap(b => [b.cx - b.w / 2, b.cx + b.w / 2])
  const ys = boxes.flatMap(b => [b.cy - b.h / 2, b.cy + b.h / 2])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }
}

const SGN: Record<Handle, { sx: number; sy: number }> = {
  tl: { sx: -1, sy: -1 }, tr: { sx: 1, sy: -1 }, br: { sx: 1, sy: 1 }, bl: { sx: -1, sy: 1 },
}

/** The px point of a corner handle. */
export function cornerOf(box: Box, handle: Handle): { x: number; y: number } {
  const { sx, sy } = SGN[handle]
  return { x: box.cx + sx * box.w / 2, y: box.cy + sy * box.h / 2 }
}

/** The fixed anchor: the opposite corner, or the box center when fromCenter (Alt). */
export function anchorOf(box: Box, handle: Handle, fromCenter: boolean): { x: number; y: number } {
  if (fromCenter) return { x: box.cx, y: box.cy }
  const { sx, sy } = SGN[handle]
  return { x: box.cx - sx * box.w / 2, y: box.cy - sy * box.h / 2 }
}

/** Uniform scale factor = distance(pointer,anchor) / distance(cornerStart,anchor). */
export function groupScaleFactor(anchor: { x: number; y: number }, cornerStart: { x: number; y: number }, pointerNow: { x: number; y: number }, minF = 0.05, maxF = 20): number {
  const d0 = Math.hypot(cornerStart.x - anchor.x, cornerStart.y - anchor.y)
  const d1 = Math.hypot(pointerNow.x - anchor.x, pointerNow.y - anchor.y)
  if (d0 < 1e-6) return 1
  return Math.min(maxF, Math.max(minF, d1 / d0))
}

/** Scale one layer about `anchor` (px) by `f`: center repositions in px, size fields
 *  multiply by the dimensionless `f`. Returns only the changed fields. */
export function scaleLayerAbout(layer: LocalLayer, anchor: { x: number; y: number }, f: number, W: number, H: number): Partial<LocalLayer> {
  const cx = layer.x * W, cy = layer.y * H
  const nx = anchor.x + (cx - anchor.x) * f
  const ny = anchor.y + (cy - anchor.y) * f
  const patch: Record<string, number> = { x: nx / W, y: ny / H }
  const l = layer as any
  if (l.kind === 'text') patch.fontSize = l.fontSize * f
  else if (l.kind === 'line') patch.w = l.w * f
  else if (l.kind === 'path') patch.scale = l.scale * f
  else { patch.w = l.w * f; patch.h = l.h * f } // rect / ellipse / image
  return patch as Partial<LocalLayer>
}
