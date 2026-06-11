// frontend/app/lib/motion/paint.ts
/**
 * Bridges the pure evaluator to the Canvas2D layer renderer. Whole-layer
 * motion folds into a transformed CLONE of the layer (so drawLocalLayer's
 * own translate/rotate/effects pipeline applies unchanged); per-char text
 * motion routes to drawAnimatedTextLayer. Scale applies as a ctx transform
 * around the effective center because LocalLayers have no uniform scale field.
 */
import type { LocalLayer, TextLayer } from '~/composables/useCompositorLayers'
import { drawLocalLayer, localLayerBox, _registerMotionPainter } from '~/composables/useCompositorLayers'
import type { FrameMotion } from './types'
import type { LayerMotionState } from './evaluate'
import { evaluateAnimation, IDENTITY_UNIT } from './evaluate'
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

/** State for a static layer drawn during motion (always visible, at rest). */
export function identityState(): LayerMotionState {
  return { visible: true, layer: IDENTITY_UNIT }
}

/** Fold whole-layer motion into a layer clone (transform + opacity).
 *  Keyframe (state.layer) dx/dy are canvas-normalized; per-unit dx/dy for
 *  NON-text layers use the layer's own box height (width-normalized, like all
 *  geometry here) as the unit box. boxH is width-normalized but `y` is
 *  consumed ×H by the renderer, so dy converts via W/H to stay aspect-true. */
export function composeEffectiveLayer(layer: LocalLayer, st: LayerMotionState, W: number, H: number): LocalLayer {
  const whole = st.units && st.units.length === 1 ? st.units[0] : null
  const boxH = 'h' in layer && typeof (layer as { h?: number }).h === 'number'
    ? (layer as { h: number }).h
    : 'bbox' in layer
    ? (layer as { bbox: { h: number }; scale?: number }).bbox.h * ((layer as { scale?: number }).scale || 1)
    : layer.kind === 'text' ? (layer as TextLayer).fontSize : 0.1
  const k = st.layer
  const dx = k.dx + (whole ? whole.dx * boxH : 0)
  const dy = k.dy + (whole ? whole.dy * boxH * (W / H) : 0) // boxH is width-normalized; y is consumed ×H
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
  const eff = composeEffectiveLayer(layer, st, W, H)
  const effMask = maskLayer
    ? (maskState ? composeEffectiveLayer(maskLayer, maskState, W, H) : maskLayer)
    : null
  // Whole-unit clip (mask-up/down presets on non-per-char layers): clip a
  // canvas-space rect anchored at the layer's REST position while the glyph
  // slides under it — same fixed-edge reveal as the per-char path. Pad 25%
  // each side for stroke/shadow overhang; unrotated-space clip is an
  // approximation for rotated layers (documented v1 limitation).
  const whole = st.units && st.units.length === 1 ? st.units[0] : null
  let needsClipRestore = false
  if (whole?.clip && whole.clip.amount > 0.001) {
    const rest = composeEffectiveLayer(layer, { ...st, units: undefined }, W, H)
    const box = localLayerBox(ctx, rest, W, H)
    const a = Math.min(1, Math.max(0, whole.clip.amount))
    const cxp = rest.x * W, cyp = rest.y * H
    let cx = cxp - box.w * 0.75, cy = cyp - box.h / 2, cw = box.w * 1.5, ch = box.h
    if (whole.clip.side === 'top') { cy += ch * a; ch *= (1 - a) }
    else if (whole.clip.side === 'bottom') { ch *= (1 - a) }
    else if (whole.clip.side === 'left') { cx += cw * a; cw *= (1 - a) }
    else { cw *= (1 - a) }
    ctx.save()
    ctx.beginPath()
    ctx.rect(cx, cy, Math.max(0, cw), Math.max(0, ch))
    ctx.clip()
    needsClipRestore = true
  }
  const scale = motionScale(st)
  const needScale = Math.abs(scale - 1) > 1e-4
  if (needScale) {
    ctx.save()
    ctx.translate(eff.x * W, eff.y * H)
    ctx.scale(Math.max(0.001, scale), Math.max(0.001, scale))
    ctx.translate(-eff.x * W, -eff.y * H)
  }
  // At-rest units are the FROZEN IDENTITY_UNIT by reference (hold phase and
  // fallback both build `Array.from({length:n}, () => IDENTITY_UNIT)`) —
  // identity-by-reference is the contract. At rest we route static so the
  // full drawLocalLayer pipeline (effects, blend, mask) applies during hold.
  const atRest = !st.units || st.units.every(u => u === IDENTITY_UNIT)
  if (eff.kind === 'text' && st.units && st.units.length > 1 && !atRest) {
    // Per-char path. Layer masks (maskedById) on per-char animated text are
    // not composited in v1 — drawAnimatedTextLayer draws unmasked (documented
    // limitation; whole-layer text animation still supports masks).
    drawAnimatedTextLayer(ctx, eff as TextLayer, W, H, st.units)
  } else {
    drawLocalLayer(ctx, eff, W, H, effMask)
  }
  if (needScale) ctx.restore()
  if (needsClipRestore) ctx.restore()
}

// Register with useCompositorLayers so paintLayerStack(t) can reach these
// without a static import cycle. Importing '~/lib/motion/paint' anywhere
// guarantees registration.
_registerMotionPainter({ motionStateFor, drawLayerWithMotion, identityState })
