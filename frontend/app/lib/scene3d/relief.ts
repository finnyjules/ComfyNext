// Surface relief helpers. The pixel transform lives here as a pure function over raw
// RGBA so it is unit-testable in the repo's node test environment (no DOM, no canvas).
// Every relief producer — uploaded image, AI-generated tile, shader field — funnels
// through toHeightPixels, so there is exactly one definition of "height" in Scene3D.

/** Rec. 709 luma weights — the perceptual convention, so a green-dominant texture does
 *  not read as uniformly higher than a red one of the same apparent brightness. */
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

/** Collapse RGBA to a grayscale height field. Returns a NEW buffer; the input is not
 *  mutated. Alpha is forced opaque: a transparent source pixel has no meaningful height,
 *  and leaving it transparent would punch a hole THREE samples as zero. */
export function toHeightPixels(rgba: Uint8ClampedArray, invert = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const luma = LUMA_R * rgba[i]! + LUMA_G * rgba[i + 1]! + LUMA_B * rgba[i + 2]!
    const v = Math.round(invert ? 255 - luma : luma)
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
    out[i + 3] = 255
  }
  return out
}

/** Below this mean gradient, bump mapping shows effectively nothing — the whole class of
 *  failure this guards against. Calibrated from measured artifacts (see gen-map.post.ts /
 *  Scene3DStudioSurface.vue relief section for the incident): fbm_warp (5.42) and two
 *  real AI-generated depth maps (3.26, 3.30) were all reported invisible; voronoi_cells
 *  (36.8, the current effect default) and a checkerboard (60.2) both render strongly. 8
 *  sits just above the known-invisible band and well below anything that has ever worked. */
export const RELIEF_FLAT_THRESHOLD = 8

/** Mean absolute per-pixel gradient of an already-height-converted buffer (red channel —
 *  toHeightPixels writes the same value into R/G/B, so any one channel represents the
 *  height field). Bump mapping perturbs normals from the LOCAL DERIVATIVE of the height
 *  field, not its range, so a height map can span the full 0–255 range and still be
 *  invisible if it varies smoothly (e.g. a depth-model vignette) rather than sharply.
 *  Interior pixels only — edges have no symmetric left/right or up/down neighbour. */
export function heightGradient(rgba: Uint8ClampedArray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0
  let sum = 0
  let count = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4
      const left = rgba[i - 4]!
      const right = rgba[i + 4]!
      const up = rgba[i - width * 4]!
      const down = rgba[i + width * 4]!
      sum += Math.abs(left - right) + Math.abs(up - down)
      count++
    }
  }
  return count === 0 ? 0 : sum / count
}
