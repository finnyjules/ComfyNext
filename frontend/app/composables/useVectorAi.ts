/**
 * AI-native vector helpers — thin client over the /api/vector/* server routes.
 * Each returns an SVG string that callers feed to svgToPathLayers / addPathFromSvg,
 * so generation and vectorization land as editable path layers in the same stack.
 */

export type VectorizeBackend = 'local' | 'recraft'

/** Text → editable SVG (Recraft v3-svg via Replicate). */
export async function generateVectorFromText(
  prompt: string,
  opts: { style?: string; size?: string } = {},
): Promise<string> {
  const res = await $fetch<{ svg: string }>('/api/vector/recraft-generate', {
    method: 'POST',
    body: { prompt, style: opts.style, size: opts.size },
  })
  return res.svg
}

/**
 * Raster → editable SVG. `backend: 'local'` (default) uses free WASM VTracer;
 * `'recraft'` uses Replicate for higher fidelity at a per-call cost. `image` is
 * a data URL or a URL the server can fetch (e.g. a /view generation URL).
 */
export async function vectorizeImage(
  image: string,
  opts: { backend?: VectorizeBackend; mode?: 'color' | 'bw'; filterSpeckle?: number; colorPrecision?: number } = {},
): Promise<string> {
  if (opts.backend === 'recraft') {
    const res = await $fetch<{ svg: string }>('/api/vector/recraft-vectorize', {
      method: 'POST', body: { image },
    })
    return res.svg
  }
  const res = await $fetch<{ svg: string }>('/api/vector/trace', {
    method: 'POST',
    body: { image, mode: opts.mode, filterSpeckle: opts.filterSpeckle, colorPrecision: opts.colorPrecision },
  })
  return res.svg
}

/** Convert a same-origin image URL (e.g. /view?...) to a data URL for sending. */
export async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob()
  return await new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}
