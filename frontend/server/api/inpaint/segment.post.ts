import { buildSamInput, type SamRequestBody } from '../../utils/samInput'

/**
 * POST /api/inpaint/segment  (v3 click-to-select)
 *
 * Turn a single click into an inpaint mask using a Segment-Anything model on
 * Replicate: the user clicks an object, SAM returns its silhouette, and we feed
 * that straight into the FLUX Fill mask. Saves hand-painting around objects.
 *
 * Body:
 *   image   string  data URL (or public http URL) of the source image
 *   xPx     number  click X in the source image's pixel space (legacy single point)
 *   yPx     number  click Y in the source image's pixel space (legacy single point)
 *   points  {x,y,label}[]  optional multi-point prompt (smart select); label 1 =
 *           foreground, 0 = background. Non-empty points wins over xPx/yPx.
 *
 * Returns:
 *   { mask: string }              — legacy single-point path (xPx/yPx, no points):
 *                                    one data URL, WHITE = selected, BLACK = keep.
 *   { mask: string, masks: string[] } — multi-point (smart-select) path: `masks`
 *                                    holds up to 4 candidate data URLs (SAM-2's
 *                                    individual_masks — combined_mask is a
 *                                    visualization, not usable as a mask). The
 *                                    client picks the candidate that actually
 *                                    contains the prompt points (see
 *                                    lib/compositor/smartSelect.pickSamMask).
 *                                    `mask` is `masks[0]` for back-compat.
 *
 * NOTE: SAM model refs on Replicate change and vary by account access. The model
 * and its input mapping are isolated in SAM_MODEL / buildSamInput below — if your
 * account uses a different point-prompt SAM, adjust just those two. The client
 * (useInpaint.segment) falls back to manual brushing if this route errors, so an
 * unconfigured model degrades gracefully rather than blocking inpainting.
 */
const SAM_MODEL = 'meta/sam-2'

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()
  const body = await readBody<SamRequestBody>(event)
  if (!body?.image) throw createError({ statusCode: 400, message: 'image is required' })

  const input = buildSamInput(body)
  // Strip undefined keys so we never send fields the model rejects.
  for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k]

  const out = await runReplicate(SAM_MODEL, input, token, { timeoutMs: 90_000 })
  const o = (out && typeof out === 'object') ? (out as any) : null

  if (body.points?.length) {
    // Smart-select multi-point path: meta/sam-2 returns SEVERAL binary
    // individual_masks candidates for one point prompt (subpart/part/whole);
    // combined_mask is a visualization, not usable as a mask. Collect every
    // individual_masks URL, then the legacy single-URL resolution as a
    // trailing fallback, and let the client pick the right one (pickSamMask).
    const candidateUrls: string[] = []
    if (o && Array.isArray(o.individual_masks)) {
      for (const m of o.individual_masks) {
        const u = typeof m === 'string' ? m : firstOutputUrl(m)
        if (u) candidateUrls.push(u)
      }
    }
    const fallbackUrl = firstOutputUrl(out) || (o && (firstOutputUrl(o.combined_mask) || firstOutputUrl(o.masks))) || null
    if (fallbackUrl && !candidateUrls.includes(fallbackUrl)) candidateUrls.push(fallbackUrl)
    if (!candidateUrls.length) throw createError({ statusCode: 502, message: 'Segmentation returned no mask' })

    const masks = await Promise.all(candidateUrls.slice(0, 4).map(u => fetchAsDataUrl(u)))
    return { mask: masks[0]!, masks }
  }

  // Legacy single-point path (no `points`) — unchanged: one mask URL, current
  // preference order. The Inpaint modal's click-to-select consumes this.
  let url = firstOutputUrl(out)
  if (!url && o) {
    url = firstOutputUrl(o.combined_mask) || firstOutputUrl(o.individual_masks) || firstOutputUrl(o.masks)
  }
  if (!url) throw createError({ statusCode: 502, message: 'Segmentation returned no mask' })

  return { mask: await fetchAsDataUrl(url) }
})
