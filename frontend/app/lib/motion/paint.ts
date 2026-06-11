// frontend/app/lib/motion/paint.ts
/**
 * Bridges the pure evaluator to the Canvas2D layer renderer. Whole-layer
 * motion folds into a transformed CLONE of the layer (so drawLocalLayer's
 * own translate/rotate/effects pipeline applies unchanged); per-char text
 * motion routes to drawAnimatedTextLayer. Scale applies as a ctx transform
 * around the effective center because LocalLayers have no uniform scale field.
 */
import type { LocalLayer, TextLayer } from '~/composables/useCompositorLayers'
import { drawLocalLayer, _registerMotionPainter } from '~/composables/useCompositorLayers'
import type { FrameMotion } from './types'
import type { LayerMotionState } from './evaluate'
import { evaluateAnimation } from './evaluate'
import { drawAnimatedTextLayer } from './animatedText'

/** Evaluate a layer at t. Layers without animation are static and visible. */
export function motionStateFor(
  layer: LocalLayer,
  t: number,
  motion: FrameMotion,
): LayerMotionState | null {
  if (!layer.animation) return null
  const n = layer.kind === 'text'
    ? Math.max(1, [...(layer as TextLayer).text].filter(c => c.trim()).length)
    : 1
  return evaluateAnimation(layer.animation, t, motion, n)
}

/** Fold whole-layer motion into a layer clone (transform + opacity).
 *  Keyframe (state.layer) dx/dy are canvas-normalized; per-unit dx/dy for
 *  NON-text layers use the layer's own box height (width-normalized, like all
 *  geometry here) as the unit box. */
export function composeEffectiveLayer(layer: LocalLayer, st: LayerMotionState): LocalLayer {
  const whole = st.units && st.units.length === 1 ? st.units[0] : null
  const boxH = 'h' in layer && typeof (layer as { h?: number }).h === 'number'
    ? (layer as { h: number }).h
    : 'bbox' in layer ? (layer as { bbox: { h: number } }).bbox.h
    : layer.kind === 'text' ? (layer as TextLayer).fontSize : 0.1
  const k = st.layer
  const dx = k.dx + (whole ? whole.dx * boxH : 0)
  const dy = k.dy + (whole ? whole.dy * boxH : 0)
  return {
    ...layer,
    x: layer.x + dx,
    y: layer.y + dy,
    rotation: layer.rotation + k.rotation + (whole?.rotation ?? 0),
    opacity: layer.opacity * k.opacity * (whole?.opacity ?? 1),
  }
}

function motionScale(st: LayerMotionState): number {
  const whole = st.units && st.units.length === 1 ? st.units[0] : null
  return st.layer.scale * (whole?.scale ?? 1)
}

/** Draw one local layer at motion state `st` (already evaluated, visible). */
export function drawLayerWithMotion(
  ctx: CanvasRenderingContext2D,
  layer: LocalLayer,
  W: number,
  H: number,
  maskLayer: LocalLayer | null,
  st: LayerMotionState,
  maskState: LayerMotionState | null,
): void {
  const eff = composeEffectiveLayer(layer, st)
  const effMask = maskLayer
    ? (maskState ? composeEffectiveLayer(maskLayer, maskState) : maskLayer)
    : null
  const scale = motionScale(st)
  const needScale = Math.abs(scale - 1) > 1e-4
  if (needScale) {
    ctx.save()
    ctx.translate(eff.x * W, eff.y * H)
    ctx.scale(Math.max(0.001, scale), Math.max(0.001, scale))
    ctx.translate(-eff.x * W, -eff.y * H)
  }
  if (eff.kind === 'text' && st.units && st.units.length > 1) {
    // Per-char path. Layer masks (maskedById) on per-char animated text are
    // not composited in v1 — drawAnimatedTextLayer draws unmasked (documented
    // limitation; whole-layer text animation still supports masks).
    drawAnimatedTextLayer(ctx, eff as TextLayer, W, H, st.units)
  } else {
    drawLocalLayer(ctx, eff, W, H, effMask)
  }
  if (needScale) ctx.restore()
}

// Register with useCompositorLayers so paintLayerStack(t) can reach these
// without a static import cycle. Importing '~/lib/motion/paint' anywhere
// guarantees registration.
_registerMotionPainter({ motionStateFor, drawLayerWithMotion })
