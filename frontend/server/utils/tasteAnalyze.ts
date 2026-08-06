/**
 * Deterministic taste analyzers — the "cheap reads beside the model call" of the
 * executable-brand-kit spike (docs/superpowers/spikes/2026-08-05-...spike.md).
 *
 * Pure pixel math, no AI, no h3: computes a dominant palette plus the facets a
 * histogram can honestly claim (warmth, valueBias, contrast, saturation,
 * paletteBreadth, density) from raw RGBA buffers. The client downsamples and
 * decodes (canvas) and sends ~64x64 RGBA arrays; PNG data URLs are also accepted
 * at the endpoint via pngjs (devDependency; the route is dev-only).
 *
 * Kept h3-free so vitest can unit-test the math directly
 * (tests/unit/taste-analyze.unit.spec.ts).
 */
import type { FacetId, FacetReading, TasteReading } from '../../shared/taste/facets'

/** One decoded image: RGBA, row-major, 4 bytes per pixel. */
export interface PixelImage {
  w: number
  h: number
  data: number[] | Uint8Array | Uint8ClampedArray
}

export interface ImageMetrics {
  /** 5 dominant swatches, hex, ordered by cluster share (largest first). */
  palette: string[]
  /** Per-facet 0..1 values this image contributes. */
  facets: Partial<Record<FacetId, number>>
}

export interface DeterministicAnalysis {
  /** Aggregate reading across all images (deterministic facets only). */
  reading: TasteReading
  /** Pooled dominant palette across the whole set (5 swatches). */
  palette: string[]
  /** Per-image breakdown so attribution survives (facet -> which images pushed it). */
  perImage: ImageMetrics[]
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Rec. 601 luma, 0..255. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** HSL-ish hue (degrees, 0..360) + saturation (0..1). */
function hueSat(r: number, g: number, b: number): { hue: number; sat: number } {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const d = max - min
  const l = (max + min) / 2
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1) || 1)
  let hue = 0
  if (d > 0) {
    const rn = r / 255, gn = g / 255, bn = b / 255
    if (max === rn) hue = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) hue = 60 * ((bn - rn) / d + 2)
    else hue = 60 * ((rn - gn) / d + 4)
  }
  if (hue < 0) hue += 360
  return { hue, sat }
}

const toHex = (n: number): string => Math.round(clamp01(n / 255) * 255).toString(16).padStart(2, '0')

/**
 * Dominant palette via k-means (k=5) on the RGB cloud. Deterministic on
 * purpose: centroids seed from luminance-sorted quantiles, not Math.random —
 * same buffer, same swatches, every run (seeded-randomness house rule).
 */
export function dominantPalette(img: PixelImage, k = 5): string[] {
  const { data } = img
  const n = Math.floor(data.length / 4)
  if (!n) return []
  // Sample at most ~4096 pixels, evenly strided.
  const stride = Math.max(1, Math.floor(n / 4096))
  const px: Array<[number, number, number]> = []
  for (let i = 0; i < n; i += stride) {
    const o = i * 4
    if ((data[o + 3] ?? 255) < 8) continue // skip fully transparent
    px.push([data[o]!, data[o + 1]!, data[o + 2]!])
  }
  if (!px.length) return []
  const kk = Math.min(k, px.length)
  // Seed: sort by luma, take quantile pixels.
  const byLuma = [...px].sort((a, b) => luma(...a) - luma(...b))
  const centroids: Array<[number, number, number]> = []
  for (let c = 0; c < kk; c++) {
    const q = byLuma[Math.floor(((c + 0.5) / kk) * (byLuma.length - 1))]!
    centroids.push([...q])
  }
  const assign = new Array<number>(px.length).fill(0)
  for (let iter = 0; iter < 10; iter++) {
    let moved = false
    for (let i = 0; i < px.length; i++) {
      const p = px[i]!
      let best = 0, bestD = Infinity
      for (let c = 0; c < kk; c++) {
        const ct = centroids[c]!
        const d = (p[0] - ct[0]) ** 2 + (p[1] - ct[1]) ** 2 + (p[2] - ct[2]) ** 2
        if (d < bestD) { bestD = d; best = c }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true }
    }
    const sums = centroids.map(() => [0, 0, 0, 0])
    for (let i = 0; i < px.length; i++) {
      const s = sums[assign[i]!]!
      const p = px[i]!
      s[0]! += p[0]; s[1]! += p[1]; s[2]! += p[2]; s[3]! += 1
    }
    for (let c = 0; c < kk; c++) {
      const s = sums[c]!
      if (s[3]) centroids[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!]
    }
    if (!moved) break
  }
  const counts = centroids.map(() => 0)
  for (const a of assign) counts[a]!++
  return centroids
    .map((c, i) => ({ c, share: counts[i]! }))
    .sort((a, b) => b.share - a.share)
    .map(({ c }) => `#${toHex(c[0])}${toHex(c[1])}${toHex(c[2])}`)
}

/**
 * Per-image facet metrics, each 0..1 on its facet's low↔high axis:
 *  - warmth: saturation-weighted colour temperature (hue distance from orange
 *    vs azure; grey pixels are neutral and drop out of the weighting)
 *  - valueBias: mean luminance (dark → light)
 *  - contrast: luminance standard deviation, normalized
 *  - saturation: mean saturation (muted → vivid)
 *  - paletteBreadth: circular hue dispersion, saturation-weighted
 *    (monochrome → polychrome)
 *  - density: edge fraction — gradient-magnitude threshold (sparse → busy)
 */
export function imageMetrics(img: PixelImage): ImageMetrics {
  const { w, h, data } = img
  const n = Math.floor(data.length / 4)
  const facets: Partial<Record<FacetId, number>> = {}
  if (!n || w * h === 0) return { palette: [], facets }

  let lumaSum = 0, lumaSq = 0
  let satSum = 0
  let warmthWeighted = 0, warmthWeight = 0
  let hueX = 0, hueY = 0, hueWeight = 0
  const lumas = new Float32Array(w * h)

  for (let i = 0; i < n; i++) {
    const o = i * 4
    const r = data[o]!, g = data[o + 1]!, b = data[o + 2]!
    const l = luma(r, g, b)
    lumas[i] = l
    lumaSum += l
    lumaSq += l * l
    const { hue, sat } = hueSat(r, g, b)
    satSum += sat
    // Warmth: cos distance from 30° (orange). +1 warm, -1 cool (210° azure).
    const wv = Math.cos(((hue - 30) * Math.PI) / 180)
    warmthWeighted += sat * (0.5 + 0.5 * wv)
    warmthWeight += sat
    // Hue dispersion: resultant vector length of hue angles, sat-weighted.
    hueX += sat * Math.cos((hue * Math.PI) / 180)
    hueY += sat * Math.sin((hue * Math.PI) / 180)
    hueWeight += sat
  }

  const meanLuma = lumaSum / n
  const std = Math.sqrt(Math.max(0, lumaSq / n - meanLuma * meanLuma))

  facets.valueBias = clamp01(meanLuma / 255)
  facets.contrast = clamp01(std / 80) // pure b/w checker: std 127.5 → saturates
  facets.saturation = clamp01(satSum / n)
  facets.warmth = warmthWeight > 1e-6 ? clamp01(warmthWeighted / warmthWeight) : 0.5
  // 1 - |resultant| = circular variance: 0 for one hue, → 1 for a full wheel.
  facets.paletteBreadth = hueWeight > 1e-6
    ? clamp01(1 - Math.hypot(hueX / hueWeight, hueY / hueWeight))
    : 0
  // Density proxy: fraction of pixels whose right/down luminance gradient
  // exceeds a threshold. Scaled so a busy image (~25% edge pixels) reads ~1.
  let edges = 0
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x
      const gmag = Math.abs(lumas[i]! - lumas[i + 1]!) + Math.abs(lumas[i]! - lumas[i + w]!)
      if (gmag > 24) edges++
    }
  }
  const interior = (w - 1) * (h - 1)
  facets.density = interior ? clamp01((edges / interior) * 4) : 0

  return { palette: dominantPalette(img), facets }
}

/** Facets the deterministic route can honestly read. */
export const DETERMINISTIC_FACETS: FacetId[] = [
  'warmth', 'valueBias', 'contrast', 'saturation', 'paletteBreadth', 'density',
]

/**
 * Aggregate per-image metrics into one TasteReading.
 *
 * value = mean across images; confidence = high when the images agree
 * (1 − spread, floored), so a board that disagrees with itself reads as
 * uncertain rather than as its own mush of a mean. sources = the images that
 * pushed the facet — the ones on the aggregate's side of centre, most extreme
 * first — so attribution survives into the wall page.
 */
export function analyzeTaste(images: PixelImage[]): DeterministicAnalysis {
  const perImage = images.map(imageMetrics)
  const facets: Partial<Record<FacetId, FacetReading>> = {}

  for (const id of DETERMINISTIC_FACETS) {
    const vals = perImage
      .map((m, i) => ({ v: m.facets[id], i }))
      .filter((e): e is { v: number; i: number } => typeof e.v === 'number')
    if (!vals.length) continue
    const mean = vals.reduce((s, e) => s + e.v, 0) / vals.length
    const spread = Math.sqrt(vals.reduce((s, e) => s + (e.v - mean) ** 2, 0) / vals.length)
    const sources = vals
      .filter(e => (mean >= 0.5 ? e.v >= 0.5 : e.v < 0.5))
      .sort((a, b) => Math.abs(b.v - 0.5) - Math.abs(a.v - 0.5))
      .slice(0, 5)
      .map(e => `image-${e.i}`)
    facets[id] = {
      value: clamp01(mean),
      confidence: clamp01(Math.max(0.2, 1 - spread * 2)),
      ...(sources.length ? { sources } : {}),
    }
  }

  // Pooled palette: concatenate every image's pixels is overkill — pool the
  // per-image swatches (5 each, share-ordered) and re-cluster those.
  const swatchPixels: number[] = []
  for (const m of perImage) {
    for (const hex of m.palette) {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      swatchPixels.push(r, g, b, 255)
    }
  }
  const palette = swatchPixels.length
    ? dominantPalette({ w: swatchPixels.length / 4, h: 1, data: swatchPixels })
    : []

  return { reading: { facets, avoids: [] }, palette, perImage }
}

/** Runtime validation for client-sent pixel buffers. Throws plain Errors with statusCode. */
export function validatePixelImage(raw: unknown, index: number, maxDim = 256): PixelImage {
  const bad = (msg: string): Error & { statusCode: number } =>
    Object.assign(new Error(`pixels[${index}]: ${msg}`), { statusCode: 400 })
  const o = raw as { w?: unknown; h?: unknown; data?: unknown } | null
  if (!o || typeof o !== 'object') throw bad('must be an object { w, h, data }')
  const w = o.w, h = o.h
  if (typeof w !== 'number' || typeof h !== 'number' || !Number.isInteger(w) || !Number.isInteger(h)
    || w < 1 || h < 1 || w > maxDim || h > maxDim) {
    throw bad(`w/h must be integers 1..${maxDim} (downsample client-side)`)
  }
  const data = o.data
  if (!Array.isArray(data) && !(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) {
    throw bad('data must be an RGBA byte array')
  }
  if (data.length !== w * h * 4) throw bad(`data length ${data.length} != w*h*4 (${w * h * 4})`)
  return { w, h, data: data as PixelImage['data'] }
}
