// frontend/app/lib/engine/spaceTypeClipRenderer.ts
/** The single Space Type draw used by BOTH compositors — the WebGL source and
 *  the Canvas2D fallback — mirroring motionClipRenderer.ts. One implementation,
 *  two consumers: the reason renderMotionClip is the one render path in this
 *  codebase that has not drifted across surfaces. */
import type { SpaceTypeClip } from '~~/shared/timeline/types'
import { getEffect } from '~/lib/spacetype/effects/index'
import { texOptsFromState, dimsFromKey } from '~/lib/spacetype/state'
import { spaceTypeSourceFrameCount } from '~/composables/timelineSpaceTypeClip'
import { acquireSpaceTypeEngine, structuralKey } from './spaceTypeEnginePool'

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
 *  Returns null when the engine is unavailable (no WebGL2) — callers draw
 *  nothing rather than failing. */
export function renderSpaceTypeClipToCanvas(
  clip: SpaceTypeClip,
  localFrame: number,
  _fps: number,
): HTMLCanvasElement | null {
  const [W, H] = dimsFromKey(clip.state.dimsKey)
  const engine = acquireSpaceTypeEngine(W, H)
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

/** Canvas2D-path draw: render, then blit the engine canvas aspect-fit into ctx.
 *  A WebGL canvas is a valid drawImage source, which is why one engine serves
 *  both compositors. */
export function drawSpaceTypeClip(
  ctx: CanvasRenderingContext2D,
  clip: SpaceTypeClip,
  localFrame: number,
  canvasW: number,
  canvasH: number,
  fps: number,
): void {
  const src = renderSpaceTypeClipToCanvas(clip, localFrame, fps)
  if (!src) return
  ctx.drawImage(src, 0, 0, canvasW, canvasH)
}
