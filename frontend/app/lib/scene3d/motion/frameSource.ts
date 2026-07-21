// frontend/app/lib/scene3d/motion/frameSource.ts
// Adapt Scene3D's engine to the cross-studio StudioFrameSource contract.
//
// Mirrors spacetype/frameSource.ts: getters read the live clock each pull so a
// downstream Frame always sees the latest duration/fps/size. `getFrame` delegates
// to `renderAt` and throws if it returns null.
//
// Dependencies are injected so the module stays unit-testable with no WebGL
// context and no Vue component around it.

import type { StudioFrameSource } from '~/lib/studio/frameSource'

export interface Scene3DFrameSourceDeps {
  getClock: () => { duration: number; fps: number; width: number; height: number }
  /** Render at normalized loop time t01 (0..1) and return the canvas, or null if the engine is not ready. */
  renderAt: (t01: number, w: number, h: number) => HTMLCanvasElement | null
}

/** Live frame puller for a 3D Studio node — mirrors spacetype/frameSource.ts.
 *  Getters read the current clock each pull so a downstream Frame always sees
 *  the latest duration/fps/size. */
export function makeScene3DFrameSource(deps: Scene3DFrameSourceDeps): StudioFrameSource {
  return {
    // Getters, not captured values: the studio's config is edited live, so a
    // snapshot taken at registration time would go stale immediately.
    get duration() { return deps.getClock().duration },
    get fps() { return deps.getClock().fps },
    get width() { return deps.getClock().width },
    get height() { return deps.getClock().height },
    getFrame: async (t01, w, h) => {
      const surface = deps.renderAt(t01, w, h)
      // Fail loudly here rather than returning null: a not-yet-mounted engine
      // would otherwise surface several frames later as an opaque WebGL
      // "invalid texture source" error at the consumer's upload call.
      if (!surface) throw new Error('scene3d frame source: engine not ready')
      return surface as unknown as TexImageSource
    },
  }
}
