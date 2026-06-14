/** Headless bake of a timeline Motion clip → an alpha PNG sequence, plus the
 *  source-key cache. Baking runs the SAME renderMotionClip that drives preview,
 *  so export parity is inherent. */
import type { MotionClip, MotionBake } from '~~/shared/timeline/types'
import { renderMotionClip } from './motionClipRenderer'

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

/** Render every clip-local frame to an offscreen canvas (transparent bg) and
 *  collect alpha PNG blobs. Caller must ensure fonts are loaded first. */
export async function bakeMotionClipFrames(
  clip: MotionClip, W: number, H: number, fps: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob[]> {
  const total = Math.max(1, Math.round(clip.length))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(W))
  canvas.height = Math.max(1, Math.round(H))
  const ctx = canvas.getContext('2d')!
  const blobs: Blob[] = []
  for (let i = 0; i < total; i++) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height) // transparent background
    renderMotionClip(ctx, clip, i, canvas.width, canvas.height, fps)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error(`motion bake: frame ${i} produced no blob`)
    blobs.push(blob)
    onProgress?.(i + 1, total)
  }
  return blobs
}

/** Ensure `clip.motion_bake` is fresh for this canvas; bake + upload if stale.
 *  Mutates and returns clip.motion_bake. Fonts must be ensured by the caller. */
export async function ensureMotionBake(
  clip: MotionClip, W: number, H: number, fps: number,
  onProgress?: (done: number, total: number) => void,
): Promise<MotionBake> {
  const key = motionClipSourceKey(clip, W, H, fps)
  const wanted = Math.max(1, Math.round(clip.length))
  const cached = clip.motion_bake
  if (cached && cached.source_key === key && cached.frames.length === wanted) {
    return cached
  }
  const blobs = await bakeMotionClipFrames(clip, W, H, fps, onProgress)
  const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
  const frames = await uploadFrameBatch(blobs, 'motionclip')
  if (frames.length !== blobs.length) {
    throw new Error(`motion bake: uploaded ${frames.length}/${blobs.length} frames — retry`)
  }
  const bake: MotionBake = { source_key: key, frames, fps }
  clip.motion_bake = bake
  return bake
}
