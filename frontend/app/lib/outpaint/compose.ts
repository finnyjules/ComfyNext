// Browser-side: turn an OutpaintPlan + a loaded bitmap into the two PNG data
// URLs FLUX Fill needs — the base image (source painted onto the target-aspect
// canvas) and the mask (WHITE = extend/generate, BLACK = keep the original).
// Kept separate from plan.ts (pure) so the geometry stays unit-testable.
import type { OutpaintPlan } from './plan'

export interface OutpaintCompose {
  image: string // PNG data URL — source drawn onto the target-aspect canvas
  mask: string  // PNG data URL — white margins to fill, black keep-rect
}

/** Paint the base + mask for `plan` from `img` (already loaded). */
export function composeOutpaint(img: HTMLImageElement, plan: OutpaintPlan): OutpaintCompose {
  const { canvasW, canvasH, drawRect, keepRect } = plan

  // Base: black canvas + the crisp source at its drawRect. The extension margins
  // sit under the white mask, so their pixels are regenerated — black is a safe,
  // neutral filler that flux-fill ignores.
  const base = document.createElement('canvas')
  base.width = canvasW
  base.height = canvasH
  const bctx = base.getContext('2d')!
  bctx.fillStyle = '#000000'
  bctx.fillRect(0, 0, canvasW, canvasH)
  bctx.drawImage(img, drawRect.x, drawRect.y, drawRect.w, drawRect.h)

  // Mask: white everywhere (generate) except the keep-rect (black = preserve).
  const mask = document.createElement('canvas')
  mask.width = canvasW
  mask.height = canvasH
  const mctx = mask.getContext('2d')!
  mctx.fillStyle = '#ffffff'
  mctx.fillRect(0, 0, canvasW, canvasH)
  mctx.fillStyle = '#000000'
  mctx.fillRect(keepRect.x, keepRect.y, keepRect.w, keepRect.h)

  return { image: base.toDataURL('image/png'), mask: mask.toDataURL('image/png') }
}
