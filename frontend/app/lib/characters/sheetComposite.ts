/**
 * The composite reference sheet: one 1920×1080 PNG with all 5 Higgsfield
 * panels laid out in fixed rects (body-front / body-back / portrait / the two
 * face close-ups stacked), so every downstream consumer (cast resolution,
 * training) gets ONE identity asset instead of 5 loose files. The layout
 * (`compositeLayout`) is pure math — unit-tested without a DOM. The bake
 * (`bakeCompositeSheet`) is thin canvas glue on top of it: draw a cover-fit
 * crop of each panel into its rect against a neutral #808080 background (the
 * gaps a panel's aspect ratio doesn't fill), then export as PNG. jsdom has no
 * real canvas, so this half is verified by a live render, not vitest.
 */
import type { PanelSlot } from '#shared/characters/types'

export interface CompositeRect { slot: PanelSlot; x: number; y: number; w: number; h: number }

export const COMPOSITE_W = 1920
export const COMPOSITE_H = 1080

/**
 * Exactly these 5 rects, in this order — a wide portrait as the centerpiece
 * (widest single panel: it's the identity's clearest full read), body-front/
 * back flanking it at full sheet height, and the two face close-ups sharing
 * the remaining column stacked one over the other. Rects exactly tile the
 * full 1920×1080 sheet: no gaps, no overlaps.
 */
export function compositeLayout(): CompositeRect[] {
  return [
    { slot: 'body-front', x: 0, y: 0, w: 420, h: 1080 },
    { slot: 'body-back', x: 420, y: 0, w: 420, h: 1080 },
    { slot: 'portrait', x: 840, y: 0, w: 660, h: 1080 },
    { slot: 'face-neutral', x: 1500, y: 0, w: 420, h: 540 },
    { slot: 'face-smile', x: 1500, y: 540, w: 420, h: 540 },
  ]
}

/**
 * Pure cover-fit crop math: given a source image size and a destination box,
 * return the centered source-rect crop `drawImage`'s 9-arg form needs so the
 * source fills the destination without distortion (CSS `object-fit: cover`,
 * cropping whichever axis overflows).
 */
export function coverFitCrop(srcW: number, srcH: number, dstW: number, dstH: number): { sx: number; sy: number; sw: number; sh: number } {
  const srcAspect = srcW / srcH
  const dstAspect = dstW / dstH
  if (srcAspect > dstAspect) {
    // Source is relatively wider than the destination — crop the sides.
    const sw = srcH * dstAspect
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH }
  }
  // Source is relatively taller (or equal) — crop top/bottom.
  const sh = srcW / dstAspect
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = dataUrl
  })
}

/**
 * Bake the 5 panel data URLs into one composite sheet PNG. Missing panels
 * (a caller that only has a subset) simply leave that rect as background —
 * callers that require all 5 (the panel/node "Generate sheet" flow) check
 * completeness before calling this.
 */
export async function bakeCompositeSheet(panelDataUrls: Record<PanelSlot, string>): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = COMPOSITE_W
  canvas.height = COMPOSITE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, COMPOSITE_W, COMPOSITE_H)

  for (const rect of compositeLayout()) {
    const src = panelDataUrls[rect.slot]
    if (!src) continue
    const img = await loadImage(src)
    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    const { sx, sy, sw, sh } = coverFitCrop(srcW, srcH, rect.w, rect.h)
    ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h)
  }

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('canvas export failed')
  return new File([blob], 'sheet.png', { type: 'image/png' })
}
