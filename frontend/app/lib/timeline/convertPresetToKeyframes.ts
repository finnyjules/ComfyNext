import type { MotionAxisKeyframe } from '~~/shared/timeline/types'

/** Normalize a layer's axis keyframes into an explicit, editable set: clamp t to
 *  [0,1], sort, and fill a default ease so every keyframe is fully specified.
 *  This is the seam the dock's "Convert preset → keyframes" action calls; richer
 *  preset expansion (in/out/loop → keyframes) can grow here later. */
export function normalizeAxisKeyframes(kfs: MotionAxisKeyframe[] | undefined): MotionAxisKeyframe[] {
  if (!kfs || !kfs.length) return []
  return kfs
    .map(k => ({ t: Math.max(0, Math.min(1, k.t)), axes: { ...k.axes }, ease: k.ease ?? 'linear' }))
    .sort((a, b) => a.t - b.t)
}
