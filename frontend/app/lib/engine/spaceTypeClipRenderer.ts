// frontend/app/lib/engine/spaceTypeClipRenderer.ts
/** The single Space Type draw used by BOTH compositors — the WebGL source and
 *  the Canvas2D fallback — mirroring motionClipRenderer.ts. One implementation,
 *  two consumers: the reason renderMotionClip is the one render path in this
 *  codebase that has not drifted across surfaces.
 *
 *  Callers must hold a `SpaceTypeEngineHandle` acquired from
 *  spaceTypeEnginePool.ts (see that file's ownership contract) — acquire it
 *  once at construction, release it once at disposal, and pass it into
 *  renderSpaceTypeClipToCanvas/drawSpaceTypeClip on every frame.
 *
 *  A null handle is legitimate, not a caller error: acquireSpaceTypeEngine()
 *  returns null when WebGL2 is permanently unavailable. Both functions accept
 *  it and draw nothing, so callers can pass the handle straight through without
 *  their own guard. */
import type { SpaceTypeClip } from '~~/shared/timeline/types'
import { getEffect } from '~/lib/spacetype/effects/index'
import { texOptsFromState, dimsFromKey } from '~/lib/spacetype/state'
import { spaceTypeSourceFrameCount } from '~/composables/timelineSpaceTypeClip'
import { getSpaceTypeEngine, structuralKey, type SpaceTypeEngineHandle } from './spaceTypeEnginePool'

/** Clip-local frame → normalized loop time, honouring in_frame and looping.
 *  Pure: the same frame always yields the same t01, which is what makes random
 *  access scrubbing correct. */
export function sourceT01(clip: SpaceTypeClip, localFrame: number): number {
  const total = spaceTypeSourceFrameCount(clip)
  const raw = (clip.in_frame ?? 0) + localFrame
  const loop = clip.loop !== false
  const f = loop
    ? ((raw % total) + total) % total
    : Math.min(Math.max(0, raw), total - 1)
  return f / total
}

/** Render the clip at a clip-local frame into the shared engine's canvas.
 *  Returns null when the engine is unavailable — a null handle (WebGL2
 *  permanently absent), or transiently unavailable this frame — so callers
 *  draw nothing rather than failing.
 *  A non-null `handle` must already be acquired (see spaceTypeEnginePool.ts);
 *  this function only calls getSpaceTypeEngine(), never acquire/release. */
export function renderSpaceTypeClipToCanvas(
  handle: SpaceTypeEngineHandle | null,
  clip: SpaceTypeClip,
  localFrame: number,
  _fps: number,
): HTMLCanvasElement | null {
  if (!handle) return null
  const [W, H] = dimsFromKey(clip.state.dimsKey)
  const engine = getSpaceTypeEngine(handle, W, H)
  if (!engine) return null

  const effect = getEffect(clip.state.effectId)
  try {
    engine.setBackground(clip.state.transparent, clip.state.bgColor)
    engine.setLoopDuration(clip.state.loopDuration)
    engine.setFps(clip.state.fps)
    if (clip.state.projection) engine.setProjection(clip.state.projection)
    engine.setPan(clip.state.panX ?? 0, clip.state.panY ?? 0)
    engine.buildKeyed(structuralKey(clip.state), effect, clip.state.params, texOptsFromState(clip.state))
    engine.renderFrameAt(sourceT01(clip, localFrame), clip.state.params)
  } catch (e) {
    console.warn(`spaceTypeClipRenderer: render failed for clip ${clip.id}`, e)
    return null
  }
  return engine.renderer.domElement
}

/** Canvas2D-path draw: render, then blit the engine canvas aspect-fit (letterboxed,
 *  centered) into ctx — matching how usePlaybackEngine.ts aspect-fits every other
 *  clip kind. The clip's own dimensions (from dimsKey) need not match the project
 *  canvas, so a naive full-rect stretch would visibly squash the output. */
export function drawSpaceTypeClip(
  handle: SpaceTypeEngineHandle | null,
  ctx: CanvasRenderingContext2D,
  clip: SpaceTypeClip,
  localFrame: number,
  canvasW: number,
  canvasH: number,
  fps: number,
): void {
  const src = renderSpaceTypeClipToCanvas(handle, clip, localFrame, fps)
  if (!src) return
  const sw = src.width, sh = src.height
  if (!sw || !sh || !canvasW || !canvasH) return

  const cAspect = canvasW / canvasH
  const sAspect = sw / sh
  let dw: number, dh: number
  if (sAspect > cAspect) {
    dw = canvasW
    dh = canvasW / sAspect
  } else {
    dh = canvasH
    dw = canvasH * sAspect
  }
  const dx = (canvasW - dw) / 2
  const dy = (canvasH - dh) / 2

  try {
    ctx.drawImage(src, dx, dy, dw, dh)
  } catch { /* best-effort, matches other clip-kind draw paths */ }
}
