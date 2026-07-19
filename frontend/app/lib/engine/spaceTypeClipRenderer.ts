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
import { loopMultiplier } from '~/lib/spacetype/loop'
import { texOptsFromState, dimsFromKey } from '~/lib/spacetype/state'
import { spaceTypeSourceFrameCount } from '~/composables/timelineSpaceTypeClip'
import { getSpaceTypeEngine, structuralKey, type SpaceTypeEngineHandle } from './spaceTypeEnginePool'

/** k, the number of loops needed for every motion rate to close cleanly.
 *  Shared by sourceT01 (below, drives live preview) and spaceTypeClipBake.ts
 *  (drives the export bake) so the two time models cannot drift — both must
 *  agree on where one seamless cycle ends. */
export function spaceTypeLoopMultiplier(clip: SpaceTypeClip): number {
  const effect = getEffect(clip.state.effectId)
  const rates = effect.loopRates?.(clip.state.params) ?? []
  return loopMultiplier(rates)
}

/** SOURCE frame → loop-cycle time, honouring looping.
 *
 *  `sourceFrame` must already be source-mapped — in_frame (and speed/reverse,
 *  for clips that use them) already folded in, the same way every other
 *  FrameSource.getFrame(n) receives n: buildDrawList computes it once via
 *  sourceFrameAt() (shared/timeline/sourceFrame.ts) and both compositors
 *  (WebGLPreviewRenderer → SpaceTypeSource, and the Canvas2D branch in
 *  usePlaybackEngine.ts) pass that same value through unchanged. This
 *  function must NOT add clip.in_frame itself — doing so double-counts it for
 *  callers that already source-mapped their input (Critical bug: a trimmed
 *  clip previewed at 2× its actual in-point offset in the WebGL path). The
 *  parameter used to be called `localFrame`, which invited exactly that bug;
 *  it is a source frame, not a clip-local one.
 *
 *  The clip's true seamless cycle is k WHOLE LOOPS (k = spaceTypeLoopMultiplier),
 *  not one loop — wrapping at T (one loop's frame count) would silently replay
 *  loop 1 forever for any effect with k > 1 (e.g. an off-grid spin/wave rate).
 *  So we wrap at k·T frames, THEN divide by T: the result ranges over [0, k),
 *  matching what engine.renderFrameAt expects for a multi-loop cycle (see its
 *  docstring — t01 may exceed 1). At k = 1 this reduces exactly to wrapping at
 *  T, i.e. today's behaviour, unchanged.
 *
 *  Pure: the same (clip, sourceFrame) pair always yields the same t01, which
 *  is what makes random-access scrubbing correct. */
export function sourceT01(clip: SpaceTypeClip, sourceFrame: number): number {
  const T = spaceTypeSourceFrameCount(clip)
  const k = spaceTypeLoopMultiplier(clip)
  const cycle = T * k
  const loop = clip.loop !== false
  const f = loop
    ? ((sourceFrame % cycle) + cycle) % cycle
    : Math.min(Math.max(0, sourceFrame), cycle - 1)
  return f / T
}

/** Render the clip at a SOURCE frame (in_frame/speed/reverse already applied —
 *  see sourceT01's doc comment above for the contract) into the shared
 *  engine's canvas. Returns null when the engine is unavailable — a null
 *  handle (WebGL2 permanently absent), or transiently unavailable this frame
 *  — so callers draw nothing rather than failing.
 *  A non-null `handle` must already be acquired (see spaceTypeEnginePool.ts);
 *  this function only calls getSpaceTypeEngine(), never acquire/release. */
export function renderSpaceTypeClipToCanvas(
  handle: SpaceTypeEngineHandle | null,
  clip: SpaceTypeClip,
  sourceFrame: number,
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
    engine.renderFrameAt(sourceT01(clip, sourceFrame), clip.state.params)
  } catch (e) {
    console.warn(`spaceTypeClipRenderer: render failed for clip ${clip.id}`, e)
    return null
  }
  return engine.renderer.domElement
}

/** Canvas2D-path draw: render, then blit the engine canvas aspect-fit (letterboxed,
 *  centered) into ctx — matching how usePlaybackEngine.ts aspect-fits every other
 *  clip kind. The clip's own dimensions (from dimsKey) need not match the project
 *  canvas, so a naive full-rect stretch would visibly squash the output.
 *
 *  `sourceFrame` must already be source-mapped (in_frame/speed/reverse applied
 *  via sourceFrameAt) — see sourceT01's doc comment. The caller (usePlaybackEngine.ts)
 *  computes it the same way the WebGL compositor does, so both paths agree. */
export function drawSpaceTypeClip(
  handle: SpaceTypeEngineHandle | null,
  ctx: CanvasRenderingContext2D,
  clip: SpaceTypeClip,
  sourceFrame: number,
  canvasW: number,
  canvasH: number,
  fps: number,
): void {
  const src = renderSpaceTypeClipToCanvas(handle, clip, sourceFrame, fps)
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
