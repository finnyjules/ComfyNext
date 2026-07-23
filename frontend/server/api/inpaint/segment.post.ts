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
 *                                    holds up to 12 candidate data URLs — SAM-2's
 *                                    individual_masks, i.e. EVERY segment found in
 *                                    the image (combined_mask is a colored
 *                                    visualization, never usable as a mask, and is
 *                                    used only as a last-resort fallback when
 *                                    individual_masks is missing/empty). The client
 *                                    assigns each prompt point to its own segment
 *                                    and unions the winners (see
 *                                    lib/compositor/smartSelect.pickSamSegments).
 *                                    `mask` is `masks[0]` for back-compat.
 *
 * NOTE: SAM model refs on Replicate change and vary by account access. The model
 * and its input mapping are isolated in SAM_MODEL / buildSamInput below — if your
 * account uses a different point-prompt SAM, adjust just those two. The client
 * (useInpaint.segment) falls back to manual brushing if this route errors, so an
 * unconfigured model degrades gracefully rather than blocking inpainting.
 *
 * The currently deployed SAM_MODEL (meta/sam-2) is the AUTOMATIC
 * segment-everything variant on Replicate: its input schema has no point
 * prompts, so point_coords/point_labels built above are silently ignored by
 * the model (harmless to still send — and correct again if a promptable SAM
 * deployment is swapped in later via SAM_MODEL). individual_masks is the full
 * set of segments the model found (background/object/part), independent of
 * any points; client-side per-point assignment is what makes the prompt
 * points matter (verified live).
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
    // Smart-select multi-point path: this SAM deployment is segment-everything
    // (see header note) — individual_masks is EVERY segment found, regardless
    // of the points sent. Candidates are individual_masks ONLY; the legacy
    // single-URL resolution (combined_mask etc.) is used ONLY when
    // individual_masks is missing/empty — never appended alongside real
    // segments (the combined_mask visualization poisoned picking when mixed
    // in as a fallback candidate; verified live).
    const candidateUrls: string[] = []
    if (o && Array.isArray(o.individual_masks)) {
      for (const m of o.individual_masks) {
        const u = typeof m === 'string' ? m : firstOutputUrl(m)
        if (u) candidateUrls.push(u)
      }
    }
    if (!candidateUrls.length) {
      const fallbackUrl = firstOutputUrl(out) || (o && (firstOutputUrl(o.combined_mask) || firstOutputUrl(o.masks))) || null
      if (fallbackUrl) candidateUrls.push(fallbackUrl)
    }
    if (!candidateUrls.length) throw createError({ statusCode: 502, message: 'Segmentation returned no mask' })

    const masks = await Promise.all(candidateUrls.slice(0, 12).map(u => fetchAsDataUrl(u)))
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
