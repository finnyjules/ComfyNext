// frontend/app/lib/engine/motionClipRenderer.ts
/** Render a timeline Motion clip's text layer at a clip-local frame, through
 *  the shared lib/motion engine: evaluate the per-char animation, interpolate
 *  variable-font axes, and draw. One text layer in v1. */
import type { MotionClip, MotionTextLayer } from '~~/shared/timeline/types'
import { createTextLayer, type TextLayer } from '~/composables/useCompositorLayers'
import { evaluateAnimation } from '~/lib/motion/evaluate'
import { drawAnimatedTextLayer } from '~/lib/motion/animatedText'
import { interpolateAxes, axesToVariationSettings } from '~/lib/motion/axes'

const IDENTITY_ANIM = { offset: 0 } // no in/out/loop ⇒ always-visible, static units

/** Build a lib/motion TextLayer from the MotionTextLayer spec. */
function toTextLayer(l: MotionTextLayer): TextLayer {
  return createTextLayer({
    text: l.text,
    fontFamily: l.fontFamily,
    fontWeight: l.fontWeight ?? 700,
    fontSize: l.fontSize,
    color: l.color,
    align: l.align ?? 'center',
    lineHeight: l.lineHeight ?? 1.1,
    strokeColor: l.strokeColor ?? '#000000',
    strokeWidth: l.strokeWidth ?? 0,
    x: l.x ?? 0.5,
    y: l.y ?? 0.5,
    opacity: 1,
    rotation: 0,
  })
}

export function renderMotionClip(
  ctx: CanvasRenderingContext2D,
  clip: MotionClip,
  localFrame: number,
  canvasW: number,
  canvasH: number,
  fps: number,
): void {
  const l = clip.layer
  const duration = Math.max(0.01, clip.length / fps)
  const t = localFrame / fps
  const motion = { fps, duration }
  const n = Math.max(1, [...l.text].filter(c => c.trim()).length)

  const state = evaluateAnimation((l.animation ?? IDENTITY_ANIM) as any, t, motion, n)
  if (!state.visible || !state.units) return

  // Variable-font axes: base values, interpolated over normalized clip time.
  const base = l.axes ?? {}
  const axes = interpolateAxes((l.axisKeyframes ?? []) as any, duration > 0 ? t / duration : 0, base)
  const variation = axesToVariationSettings(axes)
  ;(ctx as any).fontVariationSettings = variation || 'normal'

  drawAnimatedTextLayer(ctx, toTextLayer(l), canvasW, canvasH, state.units)
}
