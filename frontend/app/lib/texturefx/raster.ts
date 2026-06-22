const fract = (x: number) => x - Math.floor(x)
const tri = (x: number) => Math.abs(2 * fract(x) - 1) // seamless triangle wave: tri(0)=tri(1)=1

/**
 * Seamless texture coord (0..1) to sample for tile uv (u,v). `scale` zooms about
 * the tile centre. mirror → triangle wave (clean, mirrored). feather → half-tile
 * offset so the image seam lands at the tile centre (edges become the image
 * interior, already continuous); the shader cross-fades the centre band to hide it.
 */
export function rasterSampleUV(method: string, u: number, v: number, scale: number): [number, number] {
  const s = scale > 0 ? scale : 1
  if (method === 'feather') {
    const zu = fract((u - 0.5) / s + 0.5)
    const zv = fract((v - 0.5) / s + 0.5)
    return [fract(zu + 0.5), fract(zv + 0.5)]
  }
  // mirror: triangle wave directly on the zoomed coord (continuous across the wrap)
  return [tri((u - 0.5) / s + 0.5), tri((v - 0.5) / s + 0.5)]
}

// --- image cache ---
const _cache = new Map<string, HTMLImageElement>()

export function rasterViewUrl(filename: string): string {
  return `/view?${new URLSearchParams({ filename, type: 'input' })}`
}

/** Load (and cache) the imported raster image. Resolves when decoded (or on error). */
export function loadRaster(filename: string): Promise<void> {
  if (!filename) return Promise.resolve()
  const cached = _cache.get(filename)
  if (cached && cached.complete && cached.naturalWidth) return Promise.resolve()
  return new Promise<void>((res) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { _cache.set(filename, img); res() }
    img.onerror = () => res()
    img.src = rasterViewUrl(filename)
  })
}

/** Cached, fully-decoded image for `filename`, or null if not loaded yet. */
export function getRaster(filename: string): HTMLImageElement | null {
  const img = _cache.get(filename)
  return img && img.complete && img.naturalWidth ? img : null
}
