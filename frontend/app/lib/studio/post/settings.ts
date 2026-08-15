// Plain post-processing settings data + logic, deliberately three-free: this is the shared home
// for post settings across every studio (Space Type, 3D, and beyond), not a Space Type detail.
// Three-free consumers (e.g. scene3d/config.ts, whose import graph the Collection resolver
// dynamically imports and therefore must never drag in three — see collection/studioControls.ts
// and shapefx/controls.ts) can reach DEFAULT_POST/postEnabled without pulling in post.ts's
// EffectComposer stack. post.ts re-exports both so every existing importer keeps working
// unchanged; the PostChain class (which DOES need three) stays in post.ts.
import type { PostSettings } from '~~/shared/spacetype/state'

export type { PostSettings } from '~~/shared/spacetype/state'

export const DEFAULT_POST: PostSettings = {
  bloom: false, bloomStrength: 0.6, bloomRadius: 0.4, bloomThreshold: 0.8,
  color: false, exposure: 1, contrast: 1, saturation: 1, hue: 0,
  chroma: false, chromaAmount: 0.25,
  blur: false, blurAmount: 0.01,
  distort: false, distortAmount: 0.3,
  film: false, filmIntensity: 0.35, filmGrayscale: false,
  halftone: false, halftoneRadius: 4, halftoneScatter: 0,
  dotScreen: false, dotScreenScale: 1, dotScreenAngle: 1.57,
  glitch: false,
  grain: false, grainAmount: 0.25, grainSize: 2,
  vignette: false, vignetteAmount: 0.4, vignetteRadius: 0.6, vignetteSoftness: 0.5,
  duotone: false, duotoneShadow: '#1a1a2e', duotoneHighlight: '#f5f0e8', duotoneMix: 1,
  gtao: false, gtaoRadius: 0.5, gtaoIntensity: 0.5, gtaoThickness: 0.25,
}

/**
 * True when ANY post effect is on — the engine renders through the composer only then.
 *
 * Counts all thirteen effects, including `grain || vignette || duotone`: as of
 * the effects-unification work, the three-based `PostChain` (./post.ts, via
 * threePasses.ts's makeGrainPass/makeVignettePass/makeDuotonePass) has a pass for
 * all three, and both three.js studios' UIs expose the switches — Space Type
 * (spacetype/engine.ts) and Scene3D (scene3d/engine.ts, via the shared post panel
 * from ./controls.ts) alike. Narrowing this predicate to drop any of the thirteen
 * would silently stop those studios from opening the composer for a document that
 * needs it.
 */
export function postEnabled(p: PostSettings): boolean {
  return !!(p.bloom || p.color || p.chroma || p.blur || p.distort || p.film || p.halftone
    || p.dotScreen || p.glitch || p.gtao || p.grain || p.vignette || p.duotone)
}
