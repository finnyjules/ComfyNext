import type { SceneEngine } from '~/lib/scene3d/engine'
import { type SceneDoc, sceneHasShaderFill } from '~/lib/scene3d/config'
import { applyMotionToDoc } from './apply'

export function sceneHasMotion(doc: SceneDoc): boolean {
  for (const o of doc.objects) {
    if (o.kind === 'light' || o.kind === 'decal') continue
    const m = o.motion
    if (m && ((m.loop && m.loop.kind !== 'none') || m.in || m.out)) return true
  }
  return !!(doc.camera.motion && doc.camera.motion.preset !== 'none')
}

/** Compose home∘motion(t01) into the live engine and render one beauty frame.
 *  Returns the engine's canvas (valid until the next call — upload before re-pulling).
 *
 *  Item 3 fix (final review, residual Critical): this never refreshed the engine's
 *  shaderFill field(s) at all — `materialFor` only ever built one at BUILD time
 *  (materials.ts), so a card/Frame that first builds before the shader-fx catalog has
 *  resolved got `map: null` (not even a gradient fallback, a plain white mesh) and
 *  NOTHING healed it: `refreshSceneShaderFields`'s heal branch only ever runs from
 *  `Scene3DStudioSurface`'s own modal rAF loop or `passes.ts`'s bake — neither of which
 *  this frame source or the node card's `renderPreview`/frame-source `renderAt` path
 *  (both go through `renderMotionFrame`) ever touches. `t01 * doc.motion.duration`
 *  gives real elapsed seconds within the motion loop, matching
 *  `SpaceTypeEngine.renderFrameAt`'s identical `t01 * loopDuration` convention — the
 *  shaderFill's own animation clock is independent of the OBJECT motion `t01` drives
 *  (see `SceneEngine.refreshShaderFields`'s doc), it just needs SOME real, moving
 *  value to animate against and to give the heal branch a canvas to swap in once the
 *  catalog resolves. Gated on `sceneHasShaderFill` so an ordinary (non-shaderFill)
 *  scene's frame pull pays nothing new — same cost-gate convention every other
 *  Scene3D call site uses. */
export function renderMotionFrame(engine: SceneEngine, doc: SceneDoc, t01: number): HTMLCanvasElement {
  const { doc: sampled, opacities } = applyMotionToDoc(doc, t01)
  engine.syncFromDoc(sampled)
  engine.applyCameraFromDoc(sampled)
  engine.applyObjectOpacities(opacities)
  if (sceneHasShaderFill(doc)) engine.refreshShaderFields(t01 * doc.motion.duration, false)
  engine.render()
  return engine.renderer.domElement as HTMLCanvasElement
}
