// frontend/server/api/inpaint/fix-anatomy.post.ts
/**
 * POST /api/inpaint/fix-anatomy
 *
 * Localized anatomy repair (hands/faces/limbs). Masks ONLY the bad region with
 * SAM-2, then regenerates inside the mask with FLUX-Fill and a canned anatomy
 * prompt — the rest of the image is preserved by construction. Glue over the
 * existing /api/inpaint/segment and /api/inpaint/flux-fill routes.
 *
 * Body:
 *   image   string                    data URL or http URL of the source image
 *   point   { xPx, yPx }              click point in source pixel space, OR
 *   bbox    [x,y,w,h] (normalized)    + imageW + imageH to derive the point
 *   kind    'hand' | 'face' | 'limb'  selects the canned prompt (default 'hand')
 *   count   number                    variations (default 2, max 4)
 *   seed    number                    optional base seed (reproducible retries)
 *
 * Returns { images: string[], mask: string }. 400 if the target can't be
 * resolved; 409 { reason } if SAM can't isolate a region (caller falls back).
 */
import { pointFromTarget, repairPromptFor, type AnatomyKind } from '../../utils/anatomyRepair'

interface Body {
  image?: string
  point?: { xPx: number; yPx: number }
  bbox?: [number, number, number, number]
  imageW?: number
  imageH?: number
  kind?: AnatomyKind
  count?: number
  seed?: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (!body?.image) throw createError({ statusCode: 400, message: 'image is required' })

  const pt = pointFromTarget(body)
  if (!pt) throw createError({ statusCode: 400, message: 'a point, or a bbox with imageW/imageH, is required' })

  // 1) Mask just the clicked region (SAM-2). Reuses the existing route.
  let mask: string
  try {
    const seg = await $fetch<{ mask: string }>('/api/inpaint/segment', {
      method: 'POST',
      body: { image: body.image, xPx: pt.xPx, yPx: pt.yPx },
    })
    mask = seg.mask
  } catch {
    throw createError({ statusCode: 409, message: 'Could not isolate the region', data: { reason: 'segment-failed' } })
  }
  if (!mask) throw createError({ statusCode: 409, message: 'Could not isolate the region', data: { reason: 'empty-mask' } })

  // 2) Repair inside the mask only (FLUX-Fill dev). Reuses the existing route.
  const kind: AnatomyKind = body.kind ?? 'hand'
  const count = Math.max(1, Math.min(4, Math.round(body.count ?? 2)))
  const fill = await $fetch<{ images: string[] }>('/api/inpaint/flux-fill', {
    method: 'POST',
    body: { image: body.image, mask, prompt: repairPromptFor(kind), tier: 'dev', count, seed: body.seed },
  })

  return { images: fill.images, mask }
})
