// POST /api/scene3d/gen-map — text → colour tile, for Scene3D surface relief. The client
// runs the returned image through its own brightness→height conversion (same path as the
// file-upload flow) to get the height map. /api/scene3d is already in NITRO_API_PREFIXES.
//
// This used to be a two-stage pipeline that also ran a fal depth model over the tile and
// returned a `heightUrl`. Removed: depth models report scene DISTANCE, which is nearly
// flat on a material sample photographed straight-on (measured mean gradient ~3.3, well
// below RELIEF_FLAT_THRESHOLD) — so it produced a featureless height map that the client
// never actually used, while still being billed on every generation. Do not reinstate a
// depth stage for this purpose; see server/utils/scene3dRelief.ts.
//
// Mirrors the auto-import convention of gen-image.post.ts (runFal/firstFalImageUrl from
// server/utils/falRun.ts, shapeReliefPrompt from server/utils/scene3dRelief.ts — both
// auto-imported by Nitro from server/utils, no import statements needed).
import { assertRateLimit } from '../../lib/rateLimit'

interface Body {
  prompt?: string
  seed?: number
}

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'scene3d-gen-map', 30)
  const body = await readBody<Body>(event)
  const seed = Number.isFinite(body?.seed) ? Math.round(body!.seed as number) : Math.floor(Date.now() % 2_000_000_000)

  const prompt = shapeReliefPrompt(body?.prompt ?? '')
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt is required' })
  const tile = await runFal('fal-ai/flux/dev', { prompt, image_size: 'square_hd', num_images: 1, seed })
  const imageUrl = firstFalImageUrl(tile) ?? ''
  if (!imageUrl) throw createError({ statusCode: 502, message: 'fal returned no image' })

  return { imageUrl, seed }
})
