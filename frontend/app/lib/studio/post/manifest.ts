import type { PostSettings } from './settings'

// Discriminated because duotone's shadow/highlight are hex colours, which have no
// min/max/step. The catalog's duotone.frag already stores hex (type: "color"),
// so the shared stack and the catalog agree without translation.
//
// `uniform: null` means this param has no shader uniform to bind to — a render
// consumer wiring this manifest to GL state must skip it rather than write to it.
export type PostParamDef =
  | { kind: 'slider'; uniform: string | null; settingsKey: keyof PostSettings; label: string; min: number; max: number; step: number; hint: string }
  | { kind: 'color'; uniform: string | null; settingsKey: keyof PostSettings; label: string; hint: string }

export interface PostEffectDef {
  id: string
  label: string
  enableKey: keyof PostSettings
  /** Catalog effect id in shader_effects/, or null for effects with no frag
   *  (ambient occlusion renders from depth+normal buffers in EffectComposer). */
  frag: string | null
  /** Depth/normal-buffer effects. Withheld from every non-3D host. */
  threeDOnly?: boolean
  /** Multiply the effect's contribution by the frame's alpha, so it never lands
   *  on transparent background. Replaces Gradient's `cover` plumbing. */
  alphaGated?: boolean
  params: PostParamDef[]
}

export const POST_EFFECTS: PostEffectDef[] = [
  {
    id: 'bloom', label: 'Bloom', enableKey: 'bloom', frag: 'bloom',
    params: [
      { kind: 'slider', uniform: 'u_intensity', settingsKey: 'bloomStrength', label: 'Strength', min: 0, max: 3, step: 0.05, hint: 'How strong the glow is' },
      { kind: 'slider', uniform: 'u_radius', settingsKey: 'bloomRadius', label: 'Radius', min: 0, max: 1, step: 0.05, hint: 'How far the glow spreads' },
      { kind: 'slider', uniform: 'u_threshold', settingsKey: 'bloomThreshold', label: 'Threshold', min: 0, max: 1, step: 0.05, hint: 'How bright a pixel must be before it blooms' },
    ],
  },
  {
    // The catalog has no colour-grading frag yet — post_adjust ships in Task 4.
    // Declared now so the manifest (and this control surface) already accounts
    // for it; the frag lookup will start resolving the moment Task 4 lands.
    // Uniform names are a convention (u_ + camelCase, matching every other
    // catalog frag) chosen for Task 4 to implement against, not verified here.
    id: 'color', label: 'Color', enableKey: 'color', frag: 'post_adjust',
    params: [
      { kind: 'slider', uniform: 'u_exposure', settingsKey: 'exposure', label: 'Exposure', min: 0.2, max: 2, step: 0.05, hint: 'Overall brightness' },
      { kind: 'slider', uniform: 'u_contrast', settingsKey: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.05, hint: 'Difference between darks and lights' },
      { kind: 'slider', uniform: 'u_saturation', settingsKey: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.05, hint: 'How vivid the colours are' },
      { kind: 'slider', uniform: 'u_hue', settingsKey: 'hue', label: 'Hue', min: -3.14, max: 3.14, step: 0.05, hint: 'Rotates every colour around the wheel' },
    ],
  },
  {
    id: 'duotone', label: 'Duotone', enableKey: 'duotone', frag: 'duotone',
    params: [
      { kind: 'color', uniform: 'u_shadow', settingsKey: 'duotoneShadow', label: 'Shadow', hint: 'Colour the darkest tones become' },
      { kind: 'color', uniform: 'u_highlight', settingsKey: 'duotoneHighlight', label: 'Highlight', hint: 'Colour the brightest tones become' },
      { kind: 'slider', uniform: 'u_contrast', settingsKey: 'duotoneMix', label: 'Mix', min: 0, max: 1, step: 0.05, hint: 'How much of the duotone shows through' },
    ],
  },
  {
    // chromatic_aberration.frag also exposes u_centerX/u_centerY (a fixed radial
    // origin); PostSettings has no field for it, so it stays at the catalog's
    // centred default and only the amount is user-facing.
    id: 'chroma', label: 'Chroma', enableKey: 'chroma', frag: 'chromatic_aberration',
    params: [
      { kind: 'slider', uniform: 'u_amount', settingsKey: 'chromaAmount', label: 'Amount', min: 0, max: 1.5, step: 0.02, hint: 'Colour fringing at the edges' },
    ],
  },
  {
    id: 'blur', label: 'Blur', enableKey: 'blur', frag: 'gaussian_blur',
    params: [
      { kind: 'slider', uniform: 'u_radius', settingsKey: 'blurAmount', label: 'Amount', min: 0, max: 0.04, step: 0.002, hint: 'Soft bokeh-style blur' },
    ],
  },
  {
    // "Film" is the existing FilmPass-driven scanline/screen look (see
    // spacetype/post.ts), which crt_scanlines.frag is the catalog's equivalent
    // of — NOT film_grain.frag (that one covers the separate `grain` effect
    // below). filmIntensity drives u_scanline, the frag's single "how strong"
    // knob; u_lineSize/u_curvature stay at the catalog defaults, unexposed.
    // filmGrayscale has no catalog counterpart (no param kind for booleans) and
    // is therefore not represented here.
    id: 'film', label: 'Film', enableKey: 'film', frag: 'crt_scanlines',
    params: [
      { kind: 'slider', uniform: 'u_scanline', settingsKey: 'filmIntensity', label: 'Intensity', min: 0, max: 1, step: 0.01, hint: 'How strong the grain is' },
    ],
  },
  {
    // halftone.frag has no scatter/jitter uniform — u_size and u_angle are its
    // only spatial controls, and u_softness only blurs each dot's own edge.
    // halftoneScatter has nothing to bind to in the catalog today, so its
    // uniform is null (same convention as gtao below) rather than silently
    // wired to the wrong knob.
    id: 'halftone', label: 'Halftone', enableKey: 'halftone', frag: 'halftone',
    params: [
      { kind: 'slider', uniform: 'u_size', settingsKey: 'halftoneRadius', label: 'Radius', min: 1, max: 20, step: 0.5, hint: 'Size of the print dots' },
      { kind: 'slider', uniform: null, settingsKey: 'halftoneScatter', label: 'Scatter', min: 0, max: 1, step: 0.02, hint: 'Randomises dot placement' },
    ],
  },
  {
    id: 'dotScreen', label: 'Dot screen', enableKey: 'dotScreen', frag: 'dot_screen',
    params: [
      { kind: 'slider', uniform: 'u_size', settingsKey: 'dotScreenScale', label: 'Scale', min: 0.2, max: 4, step: 0.1, hint: 'Size of the dot pattern' },
      { kind: 'slider', uniform: 'u_angle', settingsKey: 'dotScreenAngle', label: 'Angle', min: -3.14, max: 3.14, step: 0.05, hint: 'Rotates the dot grid' },
    ],
  },
  {
    // rgb_glitch.frag exposes u_amount/u_blocks/u_chroma/u_speed, but
    // PostSettings only ever grew a bare on/off (see Scene3DStudioSurface.vue's
    // glitch switch) — no Sailor param maps to any of them, so this effect
    // contributes only its enable switch, at the catalog's built-in defaults.
    id: 'glitch', label: 'Glitch', enableKey: 'glitch', frag: 'rgb_glitch',
    params: [],
  },
  {
    // film_grain.frag exists on disk but is NOT yet registered in
    // shader_effects/manifest.json (verified at HEAD — load_catalog() would
    // simply never see it), so this resolves the moment it's added, same as
    // `color` above. Its real uniforms are u_grain/u_grainSize (plus
    // u_halation/u_threshold/u_vignette, unexposed) — NOT u_amount/u_size.
    id: 'grain', label: 'Grain', enableKey: 'grain', frag: 'film_grain', alphaGated: true,
    params: [
      { kind: 'slider', uniform: 'u_grain', settingsKey: 'grainAmount', label: 'Amount', min: 0, max: 1, step: 0.02, hint: 'How strong the grain is' },
      { kind: 'slider', uniform: 'u_grainSize', settingsKey: 'grainSize', label: 'Size', min: 1, max: 8, step: 0.5, hint: 'How coarse the grain is' },
    ],
  },
  {
    // No settled Sailor UI range exists for vignette (unlike the nine in
    // scene3d/controls.ts); the catalog's own vignette.frag ranges are used
    // directly since DEFAULT_POST's values already sit inside them.
    id: 'vignette', label: 'Vignette', enableKey: 'vignette', frag: 'vignette',
    params: [
      { kind: 'slider', uniform: 'u_amount', settingsKey: 'vignetteAmount', label: 'Amount', min: 0, max: 1, step: 0.02, hint: 'How dark the corners get' },
      { kind: 'slider', uniform: 'u_radius', settingsKey: 'vignetteRadius', label: 'Radius', min: 0.3, max: 1.4, step: 0.02, hint: 'How far in the vignette starts to darken' },
      { kind: 'slider', uniform: 'u_softness', settingsKey: 'vignetteSoftness', label: 'Softness', min: 0.05, max: 0.8, step: 0.02, hint: "How gradual the vignette's edge is" },
    ],
  },
  {
    // No frag: ambient occlusion reads depth+normal buffers and renders in
    // EffectComposer. Declared here only so 3D hosts derive its controls from the
    // same source as everything else.
    id: 'gtao', label: 'Ambient occlusion', enableKey: 'gtao', frag: null, threeDOnly: true,
    params: [
      { kind: 'slider', uniform: null, settingsKey: 'gtaoRadius', label: 'Radius', min: 0.05, max: 3, step: 0.05, hint: 'How far around each point to check for blockers, in scene units' },
      { kind: 'slider', uniform: null, settingsKey: 'gtaoIntensity', label: 'Intensity', min: 0, max: 2, step: 0.05, hint: 'How dark the occluded areas get' },
      { kind: 'slider', uniform: null, settingsKey: 'gtaoThickness', label: 'Thickness', min: 0.05, max: 2, step: 0.05, hint: 'How solid nearby surfaces are treated as blockers' },
    ],
  },
]

/** Fixed render order — the single source of truth, in the spirit of
 *  compositor/postEffects.ts:8. Colour grading first so later effects screen
 *  the graded image; grain and vignette last because they are on the film and
 *  the barrel, not in the scene. */
export const POST_CHAIN_ORDER = [
  'gtao', 'color', 'duotone', 'bloom', 'chroma', 'blur',
  'halftone', 'dotScreen', 'glitch', 'film', 'vignette', 'grain',
]
