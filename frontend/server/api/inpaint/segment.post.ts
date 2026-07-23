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
 * Returns: { mask: string }  — a data URL, WHITE = selected (inpaint), BLACK = keep.
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

  // SAM outputs vary: a single mask URL, an array of mask URLs, or an object
  // like { individual_masks: [...] } / { combined_mask: url }. Take the first
  // usable image URL.
  let url = firstOutputUrl(out)
  if (!url && out && typeof out === 'object') {
    const o = out as any
    url = firstOutputUrl(o.combined_mask) || firstOutputUrl(o.individual_masks) || firstOutputUrl(o.masks)
  }
  if (!url) throw createError({ statusCode: 502, message: 'Segmentation returned no mask' })

  return { mask: await fetchAsDataUrl(url) }
})
