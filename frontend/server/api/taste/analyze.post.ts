/**
 * POST /api/taste/analyze   (dev-only, deterministic — no AI)
 *
 * The cheap half of the executable-brand-kit spike's elicited route: palette +
 * histogram facets straight from pixels (server/utils/tasteAnalyze.ts).
 *
 * Body (either or both):
 *   pixels?: { w, h, data: number[] }[]   — RGBA bytes, downsampled ~64x64
 *                                           client-side via canvas (preferred:
 *                                           no server-side decoder needed)
 *   images?: string[]                     — PNG base64 data URLs only (decoded
 *                                           via pngjs, a devDependency; JPEG/
 *                                           WebP must go through `pixels`)
 * Order is pixels-first then images; `perImage[i]` / `image-<i>` indices follow
 * that combined order.
 *
 * Returns: { reading: TasteReading (deterministic facets only, avoids: []),
 *            palette: string[5], perImage: { palette, facets }[] }
 *
 * Allowlisted in server/middleware/comfyui-proxy.ts ('/api/taste') — without
 * that the route 404s into ComfyUI.
 */
import { analyzeTaste, validatePixelImage, type PixelImage } from '../../utils/tasteAnalyze'

const PNG_DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/
const MAX_IMAGES = 64

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const body = await readBody(event) as { pixels?: unknown; images?: unknown }
  const rawPixels = Array.isArray(body?.pixels) ? body.pixels : []
  const rawImages = Array.isArray(body?.images) ? body.images : []
  if (!rawPixels.length && !rawImages.length) {
    throw createError({ statusCode: 400, statusMessage: 'pixels[] or images[] required' })
  }
  if (rawPixels.length + rawImages.length > MAX_IMAGES) {
    throw createError({ statusCode: 400, statusMessage: `too many images (max ${MAX_IMAGES})` })
  }

  const images: PixelImage[] = []
  try {
    rawPixels.forEach((p, i) => images.push(validatePixelImage(p, i)))
  }
  catch (err: any) {
    throw createError({ statusCode: err?.statusCode || 400, statusMessage: err?.message || 'bad pixels' })
  }

  if (rawImages.length) {
    // pngjs is a devDependency; the route is dev-only, so a lazy import keeps
    // the production bundle honest and fails loudly rather than at build time.
    const { PNG } = await import('pngjs')
    for (let i = 0; i < rawImages.length; i++) {
      const raw = rawImages[i]
      const m = typeof raw === 'string' ? PNG_DATA_URL_RE.exec(raw) : null
      if (!m) {
        throw createError({
          statusCode: 400,
          statusMessage: `images[${i}] must be a PNG base64 data URL (send JPEG/WebP as decoded pixels[] instead)`,
        })
      }
      try {
        const png = PNG.sync.read(Buffer.from(m[1]!, 'base64'))
        images.push({ w: png.width, h: png.height, data: png.data })
      }
      catch {
        throw createError({ statusCode: 400, statusMessage: `images[${i}]: failed to decode PNG` })
      }
    }
  }

  return analyzeTaste(images)
})
