/**
 * Figma-style resize geometry. Works in isotropic logical px. Handles rotation by
 * transforming the pointer delta into the layer's LOCAL frame, resizing there, then
 * mapping the center shift back to world. Pure.
 *
 *   - Edge handle (t/r/b/l): 1D resize, opposite edge fixed (Alt → symmetric).
 *   - Corner handle: 2D resize, opposite corner fixed (Alt → from center;
 *     Shift → constrain to the original aspect ratio).
 * Never flips: dims clamp to `minSize`.
 */
export interface Box { cx: number; cy: number; w: number; h: number }
export type Handle = 'tl' | 't' | 'tr' | 'l' | 'r' | 'bl' | 'b' | 'br'

const DIR: Record<Handle, { sx: number; sy: number }> = {
  tl: { sx: -1, sy: -1 }, t: { sx: 0, sy: -1 }, tr: { sx: 1, sy: -1 },
  l: { sx: -1, sy: 0 }, r: { sx: 1, sy: 0 },
  bl: { sx: -1, sy: 1 }, b: { sx: 0, sy: 1 }, br: { sx: 1, sy: 1 },
}

function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return { x: x * c - y * s, y: x * s + y * c }
}

export function resizeBox(
  start: Box, rotationDeg: number, handle: Handle,
  p0: { x: number; y: number }, p1: { x: number; y: number },
  opts: { aspect?: boolean; fromCenter?: boolean } = {}, minSize = 2,
): Box {
  const { sx, sy } = DIR[handle]
  const d = rot(p1.x - p0.x, p1.y - p0.y, -rotationDeg) // pointer delta in local frame
  const corner = sx !== 0 && sy !== 0
  const clamp = (v: number) => Math.max(minSize, v)
  let w = start.w, h = start.h, shiftLX = 0, shiftLY = 0

  if (opts.fromCenter) {
    if (sx !== 0) w = clamp(start.w + 2 * sx * d.x)
    if (sy !== 0) h = clamp(start.h + 2 * sy * d.y)
    if (opts.aspect && corner) {
      const scale = Math.max(w / start.w, h / start.h)
      w = start.w * scale; h = start.h * scale
    }
    // center fixed → no shift
  } else if (opts.aspect && corner) {
    const scale = Math.max(Math.abs(sx * start.w + d.x) / start.w, Math.abs(sy * start.h + d.y) / start.h)
    w = clamp(start.w * scale); h = clamp(start.h * scale)
    shiftLX = (sx * (w - start.w)) / 2; shiftLY = (sy * (h - start.h)) / 2
  } else {
    if (sx !== 0) w = clamp(start.w + sx * d.x)
    if (sy !== 0) h = clamp(start.h + sy * d.y)
    shiftLX = (sx * (w - start.w)) / 2; shiftLY = (sy * (h - start.h)) / 2
  }

  const world = rot(shiftLX, shiftLY, rotationDeg)
  return { cx: start.cx + world.x, cy: start.cy + world.y, w, h }
}
