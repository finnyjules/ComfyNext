/**
 * POST /api/vector/trace
 *
 * Local raster→SVG vectorization via VTracer (WASM, @neplex/vectorizer). $0,
 * cross-platform, no external service. Body (JSON):
 *   { image: string,            // data URL OR http(s)/relative URL to fetch
 *     mode?: 'color' | 'bw',
 *     filterSpeckle?, colorPrecision?, ... }  // optional VTracer tuning
 * Returns: { svg: string }
 *
 * The frontend imports the returned SVG via svgToPathLayers → editable paths.
 */
import { vectorize, ColorMode, Hierarchical, PathSimplifyMode, type Config } from '@neplex/vectorizer'

async function toBuffer(image: string, event: any): Promise<Buffer> {
  if (image.startsWith('data:')) {
    const b64 = image.slice(image.indexOf(',') + 1)
    return Buffer.from(b64, 'base64')
  }
  // Resolve relative URLs (e.g. /view?...) against this server's origin so we
  // can pull a ComfyUI generation straight through the dev proxy.
  let url = image
  if (image.startsWith('/')) {
    const origin = getRequestURL(event).origin
    url = origin + image
  }
  const res = await fetch(url)
  if (!res.ok) throw createError({ statusCode: 400, message: `Could not fetch image (${res.status})` })
  return Buffer.from(await res.arrayBuffer())
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as {
    image?: string
    mode?: 'color' | 'bw'
    filterSpeckle?: number
    colorPrecision?: number
    layerDifference?: number
    cornerThreshold?: number
    pathPrecision?: number
  }
  if (!body.image) throw createError({ statusCode: 400, message: 'image is required (data URL or URL)' })

  const buf = await toBuffer(body.image, event)

  const config: Config = {
    colorMode: body.mode === 'bw' ? ColorMode.Binary : ColorMode.Color,
    hierarchical: Hierarchical.Stacked,
    filterSpeckle: body.filterSpeckle ?? 4,
    colorPrecision: body.colorPrecision ?? 6,
    layerDifference: body.layerDifference ?? 16,
    mode: PathSimplifyMode.Spline,
    cornerThreshold: body.cornerThreshold ?? 60,
    lengthThreshold: 4,
    maxIterations: 10,
    spliceThreshold: 45,
    pathPrecision: body.pathPrecision ?? 8,
  }

  try {
    const svg = await vectorize(buf, config)
    return { svg }
  } catch (err: any) {
    throw createError({ statusCode: 500, message: `Vectorize failed: ${err?.message || String(err)}` })
  }
})
