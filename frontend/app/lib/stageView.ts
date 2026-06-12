/**
 * Pure zoom/pan transform math for the inpaint stage. The stage content (image
 * + mask overlay) is a logical rectW×rectH box rendered with CSS
 * `transform: translate(tx,ty) scale(scale)` and `transform-origin: 0 0`.
 *
 * Keeping this pure (no Vue, no DOM) means the regression-prone screen↔mask
 * coordinate mapping is unit-tested, and the live overlay/bake stay in logical
 * space — so useBrushMask.bakeMask never has to know about zoom.
 */
export interface View {
  scale: number
  tx: number   // pan offset px (screen, relative to stage rect origin)
  ty: number
}

export const MIN_SCALE = 0.25
export const MAX_SCALE = 8

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

export function identityView(): View {
  return { scale: 1, tx: 0, ty: 0 }
}

/** Normalized content point (0..1) → screen px relative to the stage rect origin. */
export function normToScreen(nx: number, ny: number, rectW: number, rectH: number, v: View) {
  return { sx: v.tx + v.scale * nx * rectW, sy: v.ty + v.scale * ny * rectH }
}

/** Screen px (relative to the stage rect origin) → normalized content point (0..1). */
export function screenToNorm(sx: number, sy: number, rectW: number, rectH: number, v: View) {
  return {
    nx: (sx - v.tx) / (v.scale * rectW),
    ny: (sy - v.ty) / (v.scale * rectH),
  }
}

/** Zoom by `factor` about an anchor screen point, keeping that point fixed. */
export function zoomAt(v: View, factor: number, anchorX: number, anchorY: number): View {
  const scale = clampScale(v.scale * factor)
  const k = scale / v.scale
  // Keep the content point under the anchor stationary: s' = anchor - k·(anchor - s)
  return {
    scale,
    tx: anchorX - k * (anchorX - v.tx),
    ty: anchorY - k * (anchorY - v.ty),
  }
}

/** Pan by a screen-px delta. */
export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, tx: v.tx + dx, ty: v.ty + dy }
}
