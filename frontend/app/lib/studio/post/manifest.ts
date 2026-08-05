import type { PostSettings } from './settings'

// Discriminated because duotone's shadow/highlight are hex colours, which have no
// min/max/step. The catalog's duotone.frag already stores hex (type: "color"),
// so the shared stack and the catalog agree without translation.
//
// `uniform: null` means this param has no shader uniform to bind to — a render
// consumer wiring this manifest to GL state must skip it rather than write to it.
export type PostParamDef =
  | {
      kind: 'slider'; uniform: string | null; settingsKey: keyof PostSettings; label: string
      min: number; max: number; step: number; hint: string
      /** Convert the stored setting into the shader's own units. Absent = identity.
       *  Sailor's slider ranges are settled and users' saved values sit inside them,
       *  so the range gap between a setting and its catalog uniform is closed HERE
       *  rather than by moving either range. */
      toUniform?: (v: number) => number
    }
  | { kind: 'color'; uniform: string | null; settingsKey: keyof PostSettings; label: string; hint: string }

export interface PostEffectDef {
  id: string
  label: string
  enableKey: keyof PostSettings
  /** Catalog effect id in shader_effects/, or null for effects with no frag
   *  (ambient occlusion renders from depth+normal buffers in EffectComposer). */
  frag: string | null
  /** Depth/normal-buffer effects. Withheld from every non-3D host.
   *  FORWARD WORK, not a live capability: nothing ships a 3D host on this
   *  manifest yet — Scene3D still hand-writes its own 21 post sliders (see
   *  scene3d/controls.ts). This flag, `postControls({ threeD: true })`'s branch
   *  and the "3D hosts keep uniform: null params" rule are called only from
   *  tests, and exist so a future Scene3D migration onto the shared stack has
   *  the withholding rule already declared here rather than rediscovering it. */
  threeDOnly?: boolean
  /** Catalog uniforms pinned to a constant this stack needs but no user control
   *  owns. Applied by chain.ts BETWEEN the catalog-defaults seed and the params
   *  loop, so the precedence is: catalog default → fixed → user param.
   *
   *  Exists because a catalog uniform previously had exactly two possible fates —
   *  be a user-facing control, or sit at whatever the catalog declared — with no
   *  way to say "this shader is used here for one part of what it does". */
  fixed?: Record<string, number>
  /** Documentation only — the frag itself (currently just post_grain.frag) is
   *  the one that gates unconditionally on its own input's `src.a`, so its
   *  contribution never lands on transparent background in ANY consumer, not
   *  only this chain. Nothing here reads this flag to set a uniform; it exists
   *  so a reader of POST_EFFECTS can see which effects have that property
   *  without opening every frag. Replaces Gradient's `cover` plumbing. */
  alphaGated?: boolean
  params: PostParamDef[]
}

export const POST_EFFECTS: PostEffectDef[] = [
  {
    id: 'bloom', label: 'Bloom', enableKey: 'bloom', frag: 'bloom',
    params: [
      // u_intensity's catalog range is 0..3, same as bloomStrength — identity.
      { kind: 'slider', uniform: 'u_intensity', settingsKey: 'bloomStrength', label: 'Bloom strength', min: 0, max: 3, step: 0.05, hint: 'How strong the glow is' },
      // bloomRadius 0..1 -> catalog u_radius 0.004..0.06. bloom.frag's blur kernel
      // is capped at 24 taps, so passing 0..1 straight through would undersample
      // into a broken/aliased blur well before reaching Sailor's max.
      { kind: 'slider', uniform: 'u_radius', settingsKey: 'bloomRadius', label: 'Bloom radius', min: 0, max: 1, step: 0.05, hint: 'How far the glow spreads', toUniform: v => 0.004 + v * 0.056 },
      // u_threshold's catalog range is 0..1, same as bloomThreshold — identity.
      { kind: 'slider', uniform: 'u_threshold', settingsKey: 'bloomThreshold', label: 'Bloom threshold', min: 0, max: 1, step: 0.05, hint: 'How bright a pixel must be before it blooms' },
    ],
  },
  {
    // post_adjust.frag ships with Task 4 (shader_effects/post_adjust.frag),
    // registered in shader_effects/manifest.json as "post_adjust".
    id: 'color', label: 'Color', enableKey: 'color', frag: 'post_adjust',
    params: [
      // exposure/contrast/saturation: catalog range is 0..3 with 1 = neutral,
      // same units as Sailor's. Sailor's range is a narrower, safe SUBSET of the
      // catalog's — identity preserves the shared "1 = neutral" anchor exactly;
      // scaling it would shift neutral off of 1 and change the picture at the
      // slider's rest position.
      { kind: 'slider', uniform: 'u_exposure', settingsKey: 'exposure', label: 'Exposure', min: 0.2, max: 2, step: 0.05, hint: 'Overall brightness' },
      { kind: 'slider', uniform: 'u_contrast', settingsKey: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.05, hint: 'Difference between darks and lights' },
      { kind: 'slider', uniform: 'u_saturation', settingsKey: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.05, hint: 'How vivid the colours are' },
      // hue -3.14..3.14 RADIANS -> catalog u_hue -1..1 TURNS (post_adjust.frag's
      // hueRotate multiplies by 2*PI itself). A genuine unit mismatch, not just a
      // range one — passing radians straight through would rotate by radians-as-
      // turns, i.e. roughly 6x too far.
      { kind: 'slider', uniform: 'u_hue', settingsKey: 'hue', label: 'Hue', min: -3.14, max: 3.14, step: 0.05, hint: 'Rotates every colour around the wheel', toUniform: v => v / (2 * Math.PI) },
    ],
  },
  {
    id: 'duotone', label: 'Duotone', enableKey: 'duotone', frag: 'duotone',
    params: [
      { kind: 'color', uniform: 'u_shadow', settingsKey: 'duotoneShadow', label: 'Duotone shadow', hint: 'Colour the darkest tones become' },
      { kind: 'color', uniform: 'u_highlight', settingsKey: 'duotoneHighlight', label: 'Duotone highlight', hint: 'Colour the brightest tones become' },
      // duotoneMix 0..1 -> catalog u_contrast 0..2. Range differs but both are
      // 0-anchored on the same axis (duotone.frag's own luminance-contrast curve)
      // and 0..1 stays well inside the shader's working range with no overdrive —
      // unlike halftoneRadius/chromaAmount below, identity wouldn't misbehave.
      // Sailor's slider simply doesn't reach the catalog's most extreme setting.
      { kind: 'slider', uniform: 'u_contrast', settingsKey: 'duotoneMix', label: 'Duotone mix', min: 0, max: 1, step: 0.05, hint: 'How much of the duotone shows through' },
    ],
  },
  {
    // chromatic_aberration.frag also exposes u_centerX/u_centerY (a fixed radial
    // origin); PostSettings has no field for it. chain.ts seeds every catalog
    // uniform an effect doesn't map here from shader_effects/manifest.json's
    // own "default" record (0.5, 0.5 — centred) before applying these params,
    // so it stays centred rather than sitting at GL's implicit 0 for an unset
    // uniform. Only the amount is user-facing.
    id: 'chroma', label: 'Chroma', enableKey: 'chroma', frag: 'chromatic_aberration',
    params: [
      // chromaAmount 0..1.5 -> catalog u_amount 0..0.08. Passing 1.5 straight
      // through overdrives the RGB split ~19x — see the Task 3 correction.
      { kind: 'slider', uniform: 'u_amount', settingsKey: 'chromaAmount', label: 'Chroma amount', min: 0, max: 1.5, step: 0.02, hint: 'Colour fringing at the edges', toUniform: v => (v / 1.5) * 0.08 },
    ],
  },
  {
    id: 'blur', label: 'Blur', enableKey: 'blur', frag: 'gaussian_blur',
    params: [
      // blurAmount 0..0.04 -> catalog u_radius 0.002..0.08: same unit (UV-space
      // blur radius), Sailor's range is a safe subset that never undersamples the
      // 24-tap kernel — identity, no toUniform.
      { kind: 'slider', uniform: 'u_radius', settingsKey: 'blurAmount', label: 'Blur amount', min: 0, max: 0.04, step: 0.002, hint: 'Soft bokeh-style blur' },
    ],
  },
  {
    // "Film" is the existing FilmPass-driven scanline/screen look (see
    // spacetype/post.ts), which crt_scanlines.frag is the catalog's equivalent
    // of — NOT film_grain.frag (that one covers the separate `grain` effect
    // below). filmIntensity drives u_scanline, the frag's single "how strong"
    // knob. u_lineSize stays at the catalog default (0.008); u_curvature and
    // u_vignette are PINNED TO 0 rather than left at their catalog defaults
    // (0.3 / 0.4), because crt_scanlines.frag does more than scanlines: it
    // barrel-warps the frame, hard-blacks every pixel the warp pushes outside
    // [0,1], and applies a vignette of its own. Off the shelf, then, this
    // effect would geometrically distort the picture, clip the corners to
    // black, and double up with the shared Vignette effect when both are on —
    // none of which "Film" means in this product. Pinned to 0, what is left is
    // the scanline + aperture-grille look FilmPass gives 3D Studio under the
    // same name. filmGrayscale has no catalog counterpart (no param kind for
    // booleans) and is therefore not represented here.
    id: 'film', label: 'Film', enableKey: 'film', frag: 'crt_scanlines',
    fixed: { u_curvature: 0, u_vignette: 0 },
    params: [
      // u_scanline's catalog range is 0..1, same as filmIntensity — identity.
      //
      // HINT DEVIATES DELIBERATELY from scene3d/controls.ts (a future
      // consistency sweep should not "fix" it back): every other pre-existing
      // effect's hint here is copied verbatim from Scene3D's so both studios
      // show identical tooltips, which assumed the same effect sat behind both
      // labels. Scene3D's Film is three's FilmPass — scanlines PLUS noise, and
      // its hint says "How strong the grain is". This one is crt_scanlines.frag,
      // which produces no grain at all (grain is its own effect below), so the
      // Scene3D wording would describe a knob that does something else.
      { kind: 'slider', uniform: 'u_scanline', settingsKey: 'filmIntensity', label: 'Film intensity', min: 0, max: 1, step: 0.01, hint: 'How strong the scanlines are' },
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
      // halftoneRadius 1..20 -> catalog u_size 0.004..0.1. u_size is a divisor of
      // a UV-space grid, so passing 1..20 straight through is off by ~200x — see
      // the Task 3 correction.
      { kind: 'slider', uniform: 'u_size', settingsKey: 'halftoneRadius', label: 'Halftone radius', min: 1, max: 20, step: 0.5, hint: 'Size of the print dots', toUniform: v => 0.004 + ((v - 1) / 19) * (0.1 - 0.004) },
      { kind: 'slider', uniform: null, settingsKey: 'halftoneScatter', label: 'Halftone scatter', min: 0, max: 1, step: 0.02, hint: 'Randomises dot placement' },
    ],
  },
  {
    id: 'dotScreen', label: 'Dot screen', enableKey: 'dotScreen', frag: 'dot_screen',
    params: [
      // dotScreenScale 0.2..4 -> catalog u_size 0.004..0.06: same divisor-of-a-
      // UV-grid role as halftoneRadius above, off by ~67x uncorrected.
      { kind: 'slider', uniform: 'u_size', settingsKey: 'dotScreenScale', label: 'Dot screen scale', min: 0.2, max: 4, step: 0.1, hint: 'Size of the dot pattern', toUniform: v => 0.004 + ((v - 0.2) / 3.8) * (0.06 - 0.004) },
      // dotScreenAngle -3.14..3.14 RADIANS -> catalog u_angle 0..90 DEGREES
      // (dot_screen.frag calls radians(u_angle) itself). A unit mismatch, not a
      // range one — radians passed straight through as degrees rotate ~57x too
      // little.
      { kind: 'slider', uniform: 'u_angle', settingsKey: 'dotScreenAngle', label: 'Dot screen angle', min: -3.14, max: 3.14, step: 0.05, hint: 'Rotates the dot grid', toUniform: v => v * (180 / Math.PI) },
    ],
  },
  {
    // rgb_glitch.frag exposes u_amount/u_blocks/u_chroma/u_speed, but
    // PostSettings only ever grew a bare on/off (see Scene3DStudioSurface.vue's
    // glitch switch) — no Sailor param maps to any of them, so this effect
    // contributes only its enable switch. GLSL itself has no such thing as a
    // "built-in" uniform default — an unset uniform simply reads back 0, which
    // used to make this effect a byte-exact no-op. chain.ts now seeds every
    // catalog uniform an effect doesn't map from shader_effects/manifest.json's
    // own declared default (u_amount 0.08, u_blocks 28, u_chroma 0.012,
    // u_speed 1.5) before applying params, so glitch renders at those values.
    id: 'glitch', label: 'Glitch', enableKey: 'glitch', frag: 'rgb_glitch',
    params: [],
  },
  {
    // film_grain.frag exists on disk but is UNTRACKED and unregistered — it
    // belongs to another session's in-flight work (verified at Task 3 HEAD).
    // Task 4 writes and registers its own shader_effects/post_grain.frag instead
    // (uniforms u_amount/u_size, both ranges matching Sailor's 1:1 — no
    // toUniform needed), so this feature's rendering never hinges on someone
    // else's uncommitted file.
    id: 'grain', label: 'Grain', enableKey: 'grain', frag: 'post_grain', alphaGated: true,
    params: [
      { kind: 'slider', uniform: 'u_amount', settingsKey: 'grainAmount', label: 'Grain amount', min: 0, max: 1, step: 0.02, hint: 'How strong the grain is' },
      { kind: 'slider', uniform: 'u_size', settingsKey: 'grainSize', label: 'Grain size', min: 1, max: 8, step: 0.5, hint: 'How coarse the grain is' },
    ],
  },
  {
    // No settled Sailor UI range exists for vignette (unlike the nine in
    // scene3d/controls.ts); all three ranges below are lifted straight from the
    // catalog's own vignette.frag ranges, so they match exactly — identity, no
    // toUniform needed for any of them.
    id: 'vignette', label: 'Vignette', enableKey: 'vignette', frag: 'vignette',
    params: [
      { kind: 'slider', uniform: 'u_amount', settingsKey: 'vignetteAmount', label: 'Vignette amount', min: 0, max: 1, step: 0.02, hint: 'How dark the corners get' },
      { kind: 'slider', uniform: 'u_radius', settingsKey: 'vignetteRadius', label: 'Vignette radius', min: 0.3, max: 1.4, step: 0.02, hint: 'How far in the vignette starts to darken' },
      { kind: 'slider', uniform: 'u_softness', settingsKey: 'vignetteSoftness', label: 'Vignette softness', min: 0.05, max: 0.8, step: 0.02, hint: "How gradual the vignette's edge is" },
    ],
  },
  {
    // No frag: ambient occlusion reads depth+normal buffers and renders in
    // EffectComposer. Declared here only so 3D hosts derive its controls from the
    // same source as everything else.
    id: 'gtao', label: 'Ambient occlusion', enableKey: 'gtao', frag: null, threeDOnly: true,
    params: [
      { kind: 'slider', uniform: null, settingsKey: 'gtaoRadius', label: 'GTAO radius', min: 0.05, max: 3, step: 0.05, hint: 'How far around each point to check for blockers, in scene units' },
      { kind: 'slider', uniform: null, settingsKey: 'gtaoIntensity', label: 'GTAO intensity', min: 0, max: 2, step: 0.05, hint: 'How dark the occluded areas get' },
      { kind: 'slider', uniform: null, settingsKey: 'gtaoThickness', label: 'GTAO thickness', min: 0.05, max: 2, step: 0.05, hint: 'How solid nearby surfaces are treated as blockers' },
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
