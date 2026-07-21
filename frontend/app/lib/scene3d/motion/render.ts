import type { SceneEngine } from '~/lib/scene3d/engine'
import type { SceneDoc } from '~/lib/scene3d/config'
import { applyMotionToDoc } from './apply'

export function sceneHasMotion(doc: SceneDoc): boolean {
  for (const o of doc.objects) {
    if (o.kind === 'light') continue
    const m = o.motion
    if (m && ((m.loop && m.loop.kind !== 'none') || m.in || m.out)) return true
  }
  return !!(doc.camera.motion && doc.camera.motion.preset !== 'none')
}

/** Compose home∘motion(t01) into the live engine and render one beauty frame.
 *  Returns the engine's canvas (valid until the next call — upload before re-pulling). */
export function renderMotionFrame(engine: SceneEngine, doc: SceneDoc, t01: number): HTMLCanvasElement {
  const { doc: sampled, opacities } = applyMotionToDoc(doc, t01)
  engine.syncFromDoc(sampled)
  engine.applyCameraFromDoc(sampled)
  engine.applyObjectOpacities(opacities)
  engine.render()
  return engine.renderer.domElement as HTMLCanvasElement
}
