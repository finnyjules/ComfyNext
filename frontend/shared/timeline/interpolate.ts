import type { BaseClip, Keyframe } from './types'

// Shared keyframe interpolation for the Timeline. The transform of a clip at a
// given clip-local frame: with no keyframes it returns the static scalars
// (back-compat); otherwise it lerps between the bracketing keyframes.
//
// This is mirrored 1:1 in Python (comfy_extras/nodes_timeline.py) so the editor
// preview, the FFmpeg export, and the node run all agree — same approach the
// blend modes already take.

export interface ClipTransform {
  x: number
  y: number
  rotation: number
  scale: number
  opacity: number
}

function staticTransform(clip: Partial<BaseClip>): ClipTransform {
  return {
    x: clip.x ?? 0,
    y: clip.y ?? 0,
    rotation: clip.rotation ?? 0,
    scale: clip.scale ?? 1,
    opacity: clip.opacity ?? 1,
  }
}

function snapshot(k: Keyframe): ClipTransform {
  return { x: k.x, y: k.y, rotation: k.rotation, scale: k.scale, opacity: k.opacity }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function applyEase(t: number, ease?: Keyframe['ease']): number {
  // smoothstep for easeInOut; linear otherwise.
  return ease === 'easeInOut' ? t * t * (3 - 2 * t) : t
}

export function interpolateClipAt(clip: Partial<BaseClip>, localFrame: number): ClipTransform {
  const kfs = clip.keyframes
  if (!kfs || kfs.length === 0) return staticTransform(clip)

  const sorted = kfs.length > 1 ? [...kfs].sort((a, b) => a.frame - b.frame) : kfs
  if (localFrame <= sorted[0].frame) return snapshot(sorted[0])
  const last = sorted[sorted.length - 1]
  if (localFrame >= last.frame) return snapshot(last)

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (localFrame >= a.frame && localFrame <= b.frame) {
      const span = b.frame - a.frame
      const t = span > 0 ? applyEase((localFrame - a.frame) / span, a.ease) : 0
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        rotation: lerp(a.rotation, b.rotation, t),
        scale: lerp(a.scale, b.scale, t),
        opacity: lerp(a.opacity, b.opacity, t),
      }
    }
  }
  return snapshot(last)
}
