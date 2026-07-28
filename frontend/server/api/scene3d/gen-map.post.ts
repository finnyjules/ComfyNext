// POST /api/scene3d/gen-map — text → colour tile → grayscale height map, for Scene3D
// surface relief. Returns both URLs so the UI can offer the colour tile as the albedo
// map in the same action. /api/scene3d is already in NITRO_API_PREFIXES.
//
// Mirrors the auto-import convention of gen-image.post.ts (runFal/firstFalImageUrl from
// server/utils/falRun.ts, shapeReliefPrompt/DEPTH_MODEL from server/utils/scene3dRelief.ts
// — both auto-imported by Nitro from server/utils, no import statements needed).
interface Body {
  prompt?: string
  seed?: number
  /** Skip stage 1 and run depth directly on an image the user already has
   *  (powers "Refine with depth" on an uploaded photo — same route, one component). */
  imageUrl?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const seed = Number.isFinite(body?.seed) ? Math.round(body!.seed as number) : Math.floor(Date.now() % 2_000_000_000)

  let imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : ''
  if (!imageUrl) {
    const prompt = shapeReliefPrompt(body?.prompt ?? '')
    if (!prompt) throw createError({ statusCode: 400, message: 'prompt or imageUrl is required' })
    const tile = await runFal('fal-ai/flux/dev', { prompt, image_size: 'square_hd', num_images: 1, seed })
    imageUrl = firstFalImageUrl(tile) ?? ''
    if (!imageUrl) throw createError({ statusCode: 502, message: 'fal returned no image' })
  }

  const depth = await runFal(DEPTH_MODEL.app, DEPTH_MODEL.buildInput(imageUrl))
  const heightUrl = DEPTH_MODEL.heightUrlFrom(depth)
  if (!heightUrl) throw createError({ statusCode: 502, message: 'fal returned no height map' })

  return { imageUrl, heightUrl, seed }
})
