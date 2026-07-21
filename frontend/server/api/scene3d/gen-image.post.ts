// POST /api/scene3d/gen-image — text → a clean single-object image via fal FLUX,
// the reference for the image-to-3D step. Returns a public fal CDN image URL.
//
// Mirrors the auto-import convention of /api/inpaint/flux-fill.post.ts
// (runFal/firstFalImageUrl from server/utils/falRun.ts, shapeImagePrompt from
// server/utils/scene3dGen.ts — both auto-imported by Nitro from server/utils).
interface Body {
  prompt?: string
  seed?: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt is required' })
  const seed = Number.isFinite(body?.seed) ? Math.round(body!.seed as number) : Math.floor(Date.now() % 2_000_000_000)

  const result = await runFal('fal-ai/flux/dev', {
    prompt: shapeImagePrompt(prompt),
    image_size: 'square_hd',
    num_images: 1,
    seed,
  })
  const imageUrl = firstFalImageUrl(result)
  if (!imageUrl) throw createError({ statusCode: 502, message: 'fal returned no image' })
  return { imageUrl, seed }
})
