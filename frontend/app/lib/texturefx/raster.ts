/**
 * Seamless texture coord (0..1) to sample for tile uv (u,v). `scale` zooms about
 * the tile centre.
 * - mirror → triangle wave (clean, mirrored seams at tile edges).
 * - feather → half-tile offset so the image seam lands at the tile centre; the
 *   shader cross-fades the centre band to hide it.
 * - direct → plain fract wrap; use when the image is already seamless (AI-baked).
 */
export function rasterSampleUV(method: string, u: number, v: number, scale: number): [number, number] {
  const s = scale > 0 ? scale : 1
  const cu = (u - 0.5) / s + 0.5
  const cv = (v - 0.5) / s + 0.5
  const fr = (x: number) => x - Math.floor(x)
  if (method === 'direct') return [fr(cu), fr(cv)]
  if (method === 'feather') {
    const zu = fr(cu), zv = fr(cv)
    return [fr(zu + 0.5), fr(zv + 0.5)]
  }
  const tri = (x: number) => Math.abs(2 * fr(x) - 1)
  return [tri(cu), tri(cv)]
}

/**
 * Build flux-fill inputs for AI-seamless: an offset-wrapped copy of `img`
 * (½-shift, wrapped → seamless edges + a cross seam at centre) and a mask whose
 * white cross band (width `band` fraction of the tile) marks the seam to inpaint.
 * Returns PNG data URLs. Browser-only (uses canvas).
 */
export function buildSeamlessInputs(img: HTMLImageElement, band = 0.14): { image: string, mask: string } {
  const S = Math.min(1024, Math.max(256, img.naturalWidth || 512))
  const wrap = document.createElement('canvas'); wrap.width = S; wrap.height = S
  const wx = wrap.getContext('2d')!
  for (const dx of [-S / 2, S / 2]) for (const dy of [-S / 2, S / 2]) wx.drawImage(img, dx, dy, S, S)
  const mask = document.createElement('canvas'); mask.width = S; mask.height = S
  const mc = mask.getContext('2d')!
  mc.fillStyle = '#000'; mc.fillRect(0, 0, S, S)
  const w = Math.round(S * band)
  mc.fillStyle = '#fff'
  mc.fillRect(0, Math.round(S / 2 - w / 2), S, w)   // horizontal seam band
  mc.fillRect(Math.round(S / 2 - w / 2), 0, w, S)   // vertical seam band
  return { image: wrap.toDataURL('image/png'), mask: mask.toDataURL('image/png') }
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
