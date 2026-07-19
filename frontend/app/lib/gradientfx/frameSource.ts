// frontend/app/lib/gradientfx/frameSource.ts
// Adapt Gradient Studio's renderer to the cross-studio StudioFrameSource contract.
// gradientFx.render(cfg, w, h, time) already returns a canvas, so this is mostly a
// parameter reorder plus the normalized-time conversion.
//
// `render` is injected so this stays unit-testable with no WebGL context.

import type { StudioFrameSource } from '~/lib/studio/frameSource'
import { aspectRatio } from '~/lib/gradientfx/types'

export interface GradientFrameDeps {
  getConfig: () => any
  render: (cfg: any, w: number, h: number, time: number) => TexImageSource
}

/**
 * Gradient Studio animates two independent ways, and either one makes it a real
 * clock: motion tracks, and flow.speed (a domain-warp churn that loops seamlessly
 * over motion.duration — see renderer.ts:234-245). With neither, it is a still and
 * reports duration 0 per the registry's `duration <= 0` rule.
 */
export function makeGradientFrameSource(deps: GradientFrameDeps): StudioFrameSource {
  const clock = () => {
    const cfg = deps.getConfig()
    const m = cfg?.motion ?? {}
    const hasTracks = (m.tracks?.length ?? 0) > 0
    const hasFlow = (cfg?.flow?.speed ?? 0) > 0
    if (!hasTracks && !hasFlow) return { duration: 0, fps: m.fps ?? 30 }
    return { duration: m.duration ?? 4, fps: m.fps ?? 30 }
  }

  return {
    // Getters, not captured values: the studio's config is edited live, so a
    // snapshot taken at registration time would go stale immediately.
    get duration() { return clock().duration },
    get fps() { return clock().fps },
    get width() { return deps.getConfig()?.motion?.size ?? 1080 },
    // aspectRatio() takes a string and calls .split on it — cfg.canvas may be
    // partial/absent on a fresh or migrating config, so guard the argument
    // (not just the result) before it ever reaches that call.
    get height() {
      const size = deps.getConfig()?.motion?.size ?? 1080
      const ar = aspectRatio(deps.getConfig()?.canvas?.aspect ?? '1:1') || 1
      return Math.max(1, Math.round(size / ar))
    },
    getFrame: async (t01, w, h) => {
      const cfg = deps.getConfig()
      // The registry speaks normalized 0..1; the renderer takes absolute seconds.
      const { duration } = clock()
      return deps.render(cfg, w, h, t01 * (duration || 0))
    },
  }
}
