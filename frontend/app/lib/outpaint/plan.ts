// Pure geometry for outpainting an image to a target aspect ratio. No canvas, no
// DOM — just the math, so it can be unit-tested headlessly. `compose.ts` turns a
// plan + a bitmap into the image/mask PNGs FLUX Fill needs.

export interface Rect { x: number; y: number; w: number; h: number }

export interface OutpaintPlan {
  /** Target-aspect canvas the source is painted onto. */
  canvasW: number
  canvasH: number
  /** Where the (fully-preserved) source sits on that canvas. */
  drawRect: Rect
  /** Region the model must KEEP (mask black). Inset from drawRect by `overlap` so
   *  a thin seam of the original is regenerated for a blend-free join. */
  keepRect: Rect
}

export interface PlanOpts {
  /** Longest canvas side, capped for cost (house rule: 1536). */
  max?: number
  /** Seam overlap as a fraction of the source's shorter drawn side. */
  overlap?: number
}

/**
 * Plan an outpaint that extends a `srcW×srcH` image to `targetAspect` (w/h).
 * The source is scaled to fully fit the MATCHING axis and the canvas grows on the
 * DEFICIENT axis — the original is never cropped, only surrounded by new pixels.
 */
export function planOutpaint(
  srcW: number,
  srcH: number,
  targetAspect: number,
  opts: PlanOpts = {},
): OutpaintPlan {
  const max = opts.max ?? 1536
  const overlap = opts.overlap ?? 0.04
  const sw = Math.max(1, srcW)
  const sh = Math.max(1, srcH)
  const srcAspect = sw / sh

  let canvasW: number
  let canvasH: number
  let drawW: number
  let drawH: number
  if (targetAspect >= srcAspect) {
    // Target is wider (or equal): match height, extend horizontally.
    canvasH = sh
    canvasW = Math.round(sh * targetAspect)
    drawH = sh
    drawW = sw
  } else {
    // Target is taller: match width, extend vertically.
    canvasW = sw
    canvasH = Math.round(sw / targetAspect)
    drawW = sw
    drawH = sh
  }

  // Cap the longest canvas side (cost). Scale the whole plan uniformly.
  const scale = Math.min(1, max / Math.max(canvasW, canvasH))
  canvasW = Math.max(1, Math.round(canvasW * scale))
  canvasH = Math.max(1, Math.round(canvasH * scale))
  drawW = Math.min(canvasW, Math.max(1, Math.round(drawW * scale)))
  drawH = Math.min(canvasH, Math.max(1, Math.round(drawH * scale)))

  const drawX = Math.round((canvasW - drawW) / 2)
  const drawY = Math.round((canvasH - drawH) / 2)
  const drawRect: Rect = { x: drawX, y: drawY, w: drawW, h: drawH }

  const inset = Math.round(Math.min(drawW, drawH) * overlap)
  const keepRect: Rect = {
    x: drawX + inset,
    y: drawY + inset,
    w: Math.max(1, drawW - 2 * inset),
    h: Math.max(1, drawH - 2 * inset),
  }

  return { canvasW, canvasH, drawRect, keepRect }
}
