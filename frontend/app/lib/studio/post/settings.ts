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
 * KNOWN GAP, deliberately left as-is: this now counts `grain || vignette || duotone`,
 * which the shared 2D chain (~/lib/studio/post/chain.ts) renders but the three-based
 * `PostChain` (./post.ts) has no pass for. Scene3D (scene3d/engine.ts) and Space Type
 * (spacetype/engine.ts) gate their EffectComposer route on this function, so a document
 * with ONLY one of those three set pays a full composer round-trip that adds nothing to
 * the picture. Neither studio's UI can produce such a document today — their panels
 * expose no switch for any of the three — but `parsePost` round-trips the fields, so a
 * hand-edited or imported document can reach it.
 *
 * Not "fixed" by narrowing the predicate: it is the honest answer to "is any post effect
 * on", and the three hosts that DO render those effects (Gradient/Texture/Shape) need it
 * to keep saying yes. The real close is either a pass for the three in ./post.ts or
 * migrating those hosts onto the shared chain — both out of scope where this was found.
 */
export function postEnabled(p: PostSettings): boolean {
  return !!(p.bloom || p.color || p.chroma || p.blur || p.film || p.halftone
    || p.dotScreen || p.glitch || p.gtao || p.grain || p.vignette || p.duotone)
}
