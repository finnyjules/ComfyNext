/** Headless bake of a timeline Motion clip → an alpha PNG sequence, plus the
 *  source-key cache. Baking runs the SAME renderMotionClip that drives preview,
 *  so export parity is inherent. */
import type { MotionClip, MotionBake } from '~~/shared/timeline/types'
// imports for renderMotionClip and uploadFrameBatch added in Task 3

/** FNV-1a over everything that affects the BAKED pixels: the layer spec, the
 *  clip's frame count, fps, and canvas dims. The clip-level transform / opacity
 *  / keyframes are applied at COMPOSITE time (export), not baked, so they are
 *  deliberately excluded — moving or fading the clip must not invalidate the bake. */
export function motionClipSourceKey(clip: MotionClip, W: number, H: number, fps: number): string {
  const s = JSON.stringify({ layer: clip.layer, length: clip.length, fps, W, H })
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
