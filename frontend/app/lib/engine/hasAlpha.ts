/**
 * Alpha detection for the "Transparent background" video-export toggle
 * (Space Type first — see SpaceTypeSurface.vue's Render menu).
 *
 * vitest runs in a node environment with no DOM/HTMLCanvasElement, so the
 * pure logic here takes an ImageData-like buffer instead of a canvas. The
 * Vue caller is responsible for producing that buffer (typically via
 * `ctx.getImageData(...)` on a 2D canvas the source WebGL canvas was drawn
 * into — see SpaceTypeSurface.vue's `detectAlpha`).
 *
 * STRATEGY: full scan, every pixel, no sampling and no downscaling. A false
 * NEGATIVE here is much worse than a slow call: it silently disables the
 * toggle and the user never learns transparent export exists for their
 * piece. Sparse sampling (checking every Nth pixel) can walk straight past
 * a small transparent region — e.g. a thin stroke or a single glyph's
 * counter — and report "opaque" for a frame that genuinely isn't.
 * Downscaling first would avoid that risk too (averaging spreads a
 * transparent pixel's contribution into its neighbours), but it isn't
 * needed: this runs once, on demand (when the Render menu opens), not per
 * frame, and even a 4K RGBA buffer (~33M comparisons) scans in low
 * milliseconds — there's no perf reason to trade away certainty here.
 */

export interface ImageDataLike {
  /** RGBA bytes, 4 per pixel, row-major — same layout as canvas ImageData.data. */
  data: ArrayLike<number>
  width: number
  height: number
}

/** True if any pixel in `source` has alpha < 255 (i.e. isn't fully opaque). */
export function canvasHasAlpha(source: ImageDataLike): boolean {
  const { data } = source
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true
  }
  return false
}
