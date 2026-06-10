import type { EditState, Clip, BlendMode } from '~~/shared/timeline/types'
import { interpolateClipAt } from '~~/shared/timeline/interpolate'

// Pure draw-list derivation for the WebGL engine — the TS twin of the per-frame
// logic in comfy_extras/nodes_timeline.py::render_frame_np + _transform_and_alpha.
// Every quantization here exists to match the Python renderer's integer math;
// change them only together with the Python side (the golden gate enforces it).
//
// Known residual divergence (accepted, covered by the calibrated WebGL golden
// tolerance): PIL pastes at integer top-left corners, so odd-sized layers sit
// 0.5 px off a true center; PIL BILINEAR resampling ≠ GPU linear filtering on
// rotated/scaled edges.

export interface DrawEntry {
  clipId: string
  /** Fetchable source URL (the clip's `path` as provided in the state). */
  url: string
  /** Layer size in px after aspect-fit + scale, pre-rotation (Python dw/dh). */
  widthPx: number
  heightPx: number
  /** Layer center in canvas px (Python W//2 + round(x*W), H//2 + round(y*H)). */
  centerX: number
  centerY: number
  rotationDeg: number
  /** opacity × fade, clamped [0,1] (Python: tf.opacity * fade). */
  alpha: number
  blend: BlendMode
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? '')
  if (!m) return [0, 0, 0]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** Mirror of render_frame_np's fade math (nodes_timeline.py — fade_in: local/fi
 *  while local < fi; fade_out: (length-local)/fo while local > length-fo). */
function fadeAt(localF: number, length: number, fadeIn: number, fadeOut: number): number {
  let fade = 1
  if (fadeIn > 0 && localF < fadeIn) fade *= localF / fadeIn
  if (fadeOut > 0 && localF > length - fadeOut) fade *= (length - localF) / fadeOut
  return Math.max(0, Math.min(1, fade))
}

/** Mirror of _transform_and_alpha's aspect-fit + scale quantization. */
function fittedSize(srcW: number, srcH: number, W: number, H: number, scale: number): [number, number] {
  const cAspect = W / H
  const sAspect = srcW / srcH
  let fitW: number, fitH: number
  if (sAspect > cAspect) {
    fitW = W
    fitH = Math.max(1, Math.round(W / sAspect))
  } else {
    fitH = H
    fitW = Math.max(1, Math.round(H * sAspect))
  }
  const s = Math.max(0.01, scale)
  if (s === 1) return [fitW, fitH]
  return [Math.max(1, Math.round(fitW * s)), Math.max(1, Math.round(fitH * s))]
}

/**
 * Visible image layers at `frame`, in paint order (track order, clip order
 * within track — later entries on top), with all scalar math resolved.
 * `srcDims` maps clip id → natural source pixel size (known after load()).
 * Non-image clips and clips without a path/dims are skipped (M1 scope).
 */
export function buildDrawList(
  state: EditState,
  frame: number,
  srcDims: Map<string, { w: number; h: number }>,
): DrawEntry[] {
  const W = Math.max(1, Math.trunc(state.canvas.width))
  const H = Math.max(1, Math.trunc(state.canvas.height))
  const out: DrawEntry[] = []

  for (const track of state.tracks) {
    if (track.muted || track.kind === 'audio') continue
    for (const clip of track.clips as Clip[]) {
      if (clip.kind !== 'image') continue // M1: images only (matches golden fixtures)
      const url = clip.path
      const dims = srcDims.get(clip.id)
      if (!url || !dims) continue

      const length = Math.max(1, clip.length)
      const start = clip.start_frame
      if (frame < start || frame >= start + length) continue
      const localF = frame - start

      const tf = interpolateClipAt(clip, localF)
      const fade = fadeAt(localF, length, clip.fade_in ?? 0, clip.fade_out ?? 0)
      const [dw, dh] = fittedSize(dims.w, dims.h, W, H, tf.scale)

      out.push({
        clipId: clip.id,
        url,
        widthPx: dw,
        heightPx: dh,
        centerX: Math.floor(W / 2) + Math.round(tf.x * W),
        centerY: Math.floor(H / 2) + Math.round(tf.y * H),
        rotationDeg: tf.rotation,
        alpha: Math.max(0, Math.min(1, tf.opacity * fade)),
        blend: clip.blend ?? 'normal',
      })
    }
  }
  return out
}
