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
