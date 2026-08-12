/**
 * Dataset image sizing for the style/character trainer.
 *
 * The trainers are 1024x1024 native and square-crop remotely, so a 24MP camera
 * original carries ~20x more pixels than training ever reads. Shipping the
 * originals cost upload time and heap for nothing, and pushed real datasets
 * past Replicate's 100 MB files cap. Shrink to native resolution first.
 */
export const TRAIN_MAX_EDGE = 1024

/** JPEG quality for re-encoded dataset images — visually lossless at 1024. */
export const TRAIN_JPEG_QUALITY = 0.92

export interface Fit {
  width: number
  height: number
  /** False when the source already fits — caller should keep the original bytes. */
  scaled: boolean
}

/** Fit `width`x`height` inside `maxEdge` on its long side, never upscaling. */
export function fitWithin(width: number, height: number, maxEdge = TRAIN_MAX_EDGE): Fit {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height, scaled: false }

  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  }
}
