import type { ControlSpec } from '~/lib/spacetype/effect'
import { postControls, POST_SECTIONS } from '~/lib/studio/post/controls'
import {
  MATERIAL_TYPES, MATERIAL_DEFAULTS, DEFAULT_MATERIAL, LIGHTING_PRESETS, ENVIRONMENT_KINDS, defaultDoc,
  type SceneDoc, type SceneObject, type MaterialType,
} from './config'

/**
 * The single declarative description of Scene3D (3D Studio)'s parameters.
 *
 * Source for the agent's vocabulary and for Collection variable binding / sweeps
 * (`lib/collection/studioControls.ts`), same seam Shape/Gradient use. Keys are dotted
 * paths resolved by `makeConfigParams`, so each one must address a real leaf on
 * `SceneDoc` (doc-level groups: Lighting/Camera/Post) or on the ACTIVE object (the
 * `object.` prefix, mirroring Gradient's `layer.` — resolved by Task 2/3's studioControls
 * wiring, not by this file).
 *
 * It is a SUPERSET, but each consumer is opt-OUT, not opt-in: a new slider is
 * agent-visible and motion-animatable by default. `agent: false` withholds a control
 * from the agent; `animatable: false` (or an explicit `{min,max}` widening) governs
 * motion. `summary` is the opposite polarity — opt-IN, absent means never shown on the
 * collapsed node capsule; only the two lowest ranks render.
 *
 * Keys are FROZEN: persisted Collection bindings are `params.<key>`.
 *
 * ## Booleans (read before adding a toggle)
 * `ControlSpec` DOES have a `switch` kind now (`~/lib/spacetype/effect.ts`) — it was
 * added for the shared post stack's effect enables, which are booleans. Never model a
 * boolean as a two-option `select('on'|'off')`: that writes the STRING `'on'` into a
 * BOOLEAN field, and `makeConfigParams` writes straight through the proxy with no
 * coercion, corrupting the document. Use `switch`.
 *
 * Scene3D's post-processing block is now DERIVED from the shared manifest
 * (`postControls({ host: 'three-depth' })`, spliced in below) rather than hand-declared,
 * matching Gradient/Shape/Texture — so every `post.*` effect enable (bloom/color/duotone/
 * chroma/blur/film/halftone/dotScreen/glitch/grain/vignette/gtao) IS an agent- and
 * inspector-reachable `switch` control, not a gap.
 *
 * `material.unlit` now joins the schema too (`object.material.unlit`, gated to
 * shaderFill exactly like the surface's own Unlit switch) — so the agent can flip
 * lit↔unlit on a shaderFill material, not just tune its roughness while stuck one way.
 * `material.relief.invert` has since joined too — the inspector always drew it — as an
 * `agent: false` switch: declared for the inspector, still withheld from the agent.
 * `GlbObject.materialOverride` remains hand-omitted.
 *
 * `showFloor` (scene-level, doc.showFloor) also joins here, under a new 'Background'
 * group — the grid + shadow-catcher ground toggle from the surface's Background panel.
 *
 * ## Deliberately NOT in this schema
 * - GLB `url` (an asset reference, not a tunable) and `GlbObject.materialOverride`
 *   (boolean — see the booleans note above; whether it's ON gates every `object.material.*`
 *   control via `when`, but the flag itself isn't a control).
 * - The primitive modifier stack (`primParams.ts` MODIFIER_SPECS) and per-primitive
 *   geometry `params` — a distinct, already-parametric system with its own key space.
 * - Light-specific properties (`LightObject.color/intensity/distance/decay/angle/
 *   penumbra/width/height/castShadow`) — lights are a third object kind with no
 *   Collection/agent story yet; folding them in here would need the same `object.`
 *   addressing but pointed at fields this schema doesn't otherwise touch.
 * - Per-object motion presets (`ObjectMotion` — loop/in/out/offset) and camera motion
 *   presets — these are their own editor (`app/lib/scene3d/motion/`), not param sliders.
 * - `background` (the colour/transparency value itself — a stateful proxy with
 *   last-colour memory over `doc.background === 'transparent'`, Scene3DStudioSurface.vue:
 *   475-483, not a plain doc leaf) and `output.width/height` — outside the "at minimum"
 *   list this schema was scoped to; add them here in a follow-on if the agent/Collection
 *   story needs them.
 *
 * Must stay free of `three` imports — this module is dynamically imported by the
 * Collection control resolver (see shapefx/controls.ts's identical constraint).
 */
export type SceneControl = ControlSpec & {
  when?: (doc: SceneDoc, obj?: SceneObject) => boolean
}

/** Emission order; a control whose group is not listed here is silently dropped by
 *  visibleSceneControls. POST_SECTIONS ('Effects', 'Effects/Bloom', ...) is appended so
 *  the shared post stack's nested sections land after the hand-declared groups — mirrors
 *  texturefx/sections.ts's `...POST_SECTIONS` append. */
export const SCENE_SECTIONS = ['Material', 'Lighting', 'Camera', 'Background', 'Transform', ...POST_SECTIONS] as const

// ── `when` predicates ────────────────────────────────────────────────────────────
// Material controls only make sense on an object that actually renders `.material`:
// a primitive always does, a GLB only once `materialOverride` is on, and a light never
// does (LightObject carries a dummy DEFAULT_MATERIAL — see config.ts's sceneHasShaderFill
// doc — that is never fed to a real THREE material). Mirrors the inspector panel's own
// `editable` rule (lib/scene3d/panelPresentation.ts). No active object (`obj` undefined,
// e.g. a Collection binding evaluated without a live selection) defaults to visible —
// the schema still needs to describe what the control WOULD do.
const isEditableMaterial = (_doc: SceneDoc, obj?: SceneObject): boolean =>
  !obj || obj.kind === 'primitive' || (obj.kind === 'glb' && obj.materialOverride === true)

const materialTypeOf = (obj?: SceneObject): MaterialType =>
  obj && obj.kind !== 'light' ? obj.material.type : DEFAULT_MATERIAL.type

// Mirrors the Surface/Coat/Glow/Transparency/Iridescence/Reflection block, which the
// inspector only renders for standard + glass.
const isPhysicalMaterial = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && (materialTypeOf(obj) === 'standard' || materialTypeOf(obj) === 'glass')

// Phong's own specular/shininess model — deliberately distinct from the PBR types, see
// MaterialType's doc in config.ts.
const isPhongMaterial = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && materialTypeOf(obj) === 'phong'

// The Unlit switch itself only exists inside the shaderFill branch — every other material
// type has no MeshBasicMaterial-vs-MeshStandardMaterial choice at all.
const isShaderFillMaterial = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && materialTypeOf(obj) === 'shaderFill'

// roughness/metalness apply to standard, glass and image (all PBR-lit) and to shaderFill
// only while it isn't unlit (a MeshBasicMaterial has no roughness/metalness slot at all).
// Mirrors the inspector's per-branch rows for these two keys.
const hasPbrSurface = (doc: SceneDoc, obj?: SceneObject): boolean => {
  if (!isEditableMaterial(doc, obj)) return false
  const t = materialTypeOf(obj)
  if (t === 'standard' || t === 'glass' || t === 'image' || t === 'opalescent') return true
  if (t === 'shaderFill') return !(obj && obj.kind !== 'light' && obj.material.unlit === true)
  return false
}

// Opalescent (thin-film / holographic) — its own spectral block. Mirrors the inspector's
// opalescent branch.
const isOpalMaterial = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && materialTypeOf(obj) === 'opalescent'

// The glossy-coat / reflection knobs (clearcoat, coat roughness, reflection intensity) apply to
// the physical materials AND to opalescent (now a MeshPhysicalMaterial) — matte soap-bubble at
// clearcoat 0, wet chrome-holo as it rises. NOT the whole physical block (sheen/transmission/etc
// stay standard+glass only), just these three.
const hasReflectiveCoat = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isPhysicalMaterial(doc, obj) || isOpalMaterial(doc, obj)

// Base `color` reads on standard/glass/phong/toon/fresnel and as the opalescent lit substrate
// tint; matcap/gradient/image/shaderFill materials each drive colour a different way (matcap id,
// gradient ramp, uploaded texture, catalog effect) and never read `.color` in the UI.
const COLOR_TYPES: MaterialType[] = ['standard', 'glass', 'phong', 'toon', 'fresnel', 'opalescent']
const hasBaseColor = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && COLOR_TYPES.includes(materialTypeOf(obj))

// Relief sits after the per-type chain and applies to every branch EXCEPT an unlit
// shaderFill (a MeshBasicMaterial has no bump slot at all — the panel draws a "turn off
// Unlit to use it" notice in that state instead).
const reliefApplies = (doc: SceneDoc, obj?: SceneObject): boolean => {
  if (!isEditableMaterial(doc, obj)) return false
  if (materialTypeOf(obj) === 'shaderFill' && obj && obj.kind !== 'light' && obj.material.unlit === true) return false
  return true
}

// Per-type branches the inspector draws but the schema had never described. Each is
// `agent: false` AND `animatable: false`: declaring a control so the INSPECTOR can draw it
// must not silently widen what the model may change, nor what the motion picker offers.
// The two flags move together for an inspector-only entry — and four of these are gated
// by `showIf`, which the motion picker does not evaluate, so they would have listed
// themselves as targets in states where the row itself is not even on screen.
const isToonMaterial = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && materialTypeOf(obj) === 'toon'

const isFresnelMaterial = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && materialTypeOf(obj) === 'fresnel'

const isGradientMaterial = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && materialTypeOf(obj) === 'gradient'

// Faceted/prismatic shading needs the per-face extent attributes only primitive
// geometry bakes; an imported GLB always ramps smooth. Mirrors the template's
// `v-if="selectedIsPrimitive"` on the Shading row inside the gradient branch.
const isGradientPrimitive = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isGradientMaterial(doc, obj) && (!obj || obj.kind === 'primitive')

const PALETTE_MODES = ['manual', 'harmony'] as const
const GRADIENT_TYPES = ['linear', 'radial'] as const
const GRADIENT_SHADINGS = ['smooth', 'faceted', 'prismatic', 'scatter', 'ombre'] as const

const RELIEF_SOURCES = ['none', 'shader', 'image'] as const

// ── Local builders (mirrors shapefx/controls.ts's slider/select/color helpers) ──────
const slider = (
  key: string, label: string, min: number, max: number, step: number, group: string,
  def: number, hint?: string, extra: Partial<SceneControl> = {},
): SceneControl =>
  ({ key, label, kind: 'slider', min, max, step, default: def, group, ...(hint ? { hint } : {}), ...extra } as SceneControl)

const select = (
  key: string, label: string, options: string[], def: string, group: string,
  hint?: string, extra: Partial<SceneControl> = {},
): SceneControl =>
  ({ key, label, kind: 'select', options, default: def, group, ...(hint ? { hint } : {}), ...extra } as SceneControl)

const color = (key: string, label: string, def: string, group: string, extra: Partial<SceneControl> = {}): SceneControl =>
  ({ key, label, kind: 'color', default: def, group, ...extra } as SceneControl)

const D = defaultDoc()

export const SCENE_CONTROLS: SceneControl[] = [
  // --- Material (prefix object.material.) ----------------------------------------
  color('object.material.color', 'Color', DEFAULT_MATERIAL.color, 'Material', { when: hasBaseColor }),
  slider('object.material.roughness', 'Roughness', 0, 1, 0.01, 'Material', DEFAULT_MATERIAL.roughness,
    'How matte or glossy the surface is', {
      when: hasPbrSurface, summary: 2,
      // Mirrors the inspector's own withholding of the Roughness row once Unlit is on.
      // `notEquals: true`, NOT `equals: false`: `unlit` is
      // absent (undefined) on every material type but shaderFill, and showIfVisible compares
      // with `===` — `equals: false` would read undefined !== false and wrongly hide this row
      // for standard/glass/image/opalescent, which `hasPbrSurface` already keeps visible and
      // have no unlit concept at all. `notEquals: true` reads undefined !== true → stays
      // visible, and true !== true → hides only once unlit is actually flipped on.
      showIf: { key: 'object.material.unlit', notEquals: true },
    }),
  slider('object.material.metalness', 'Metalness', 0, 1, 0.01, 'Material', DEFAULT_MATERIAL.metalness,
    'Blends between plastic-like and metal reflections', {
      when: hasPbrSurface,
      showIf: { key: 'object.material.unlit', notEquals: true },
    }),
  select('object.material.type', 'Material type', [...MATERIAL_TYPES], DEFAULT_MATERIAL.type, 'Material', undefined,
    { when: isEditableMaterial, summary: 1 }),
  {
    key: 'object.material.unlit', label: 'Unlit', kind: 'switch', default: MATERIAL_DEFAULTS.unlit, group: 'Material',
    hint: 'Glows flat instead of being shaded by scene lights',
    when: isShaderFillMaterial,
  } as SceneControl,

  // Physical block — standard + glass only.
  slider('object.material.clearcoat', 'Clearcoat', 0, 1, 0.01, 'Material', MATERIAL_DEFAULTS.clearcoat,
    'Adds a thin glossy varnish layer on top', { when: hasReflectiveCoat }),
  slider('object.material.clearcoatRoughness', 'Coat roughness', 0, 1, 0.01, 'Material', MATERIAL_DEFAULTS.clearcoatRoughness,
    'How blurred or sharp that varnish coat looks', { when: hasReflectiveCoat }),
  slider('object.material.sheen', 'Sheen', 0, 1, 0.01, 'Material', MATERIAL_DEFAULTS.sheen,
    'Soft fabric-like edge highlight', { when: isPhysicalMaterial }),
  color('object.material.sheenColor', 'Sheen colour', MATERIAL_DEFAULTS.sheenColor, 'Material', { when: isPhysicalMaterial }),
  color('object.material.emissive', 'Emissive', MATERIAL_DEFAULTS.emissive, 'Material', { when: isPhysicalMaterial }),
  slider('object.material.emissiveIntensity', 'Emissive intensity', 0, 5, 0.05, 'Material', MATERIAL_DEFAULTS.emissiveIntensity,
    'How brightly the material glows on its own', { when: isPhysicalMaterial }),
  slider('object.material.opacity', 'Opacity', 0, 1, 0.01, 'Material', MATERIAL_DEFAULTS.opacity,
    'How see-through the whole surface is', { when: isPhysicalMaterial }),
  slider('object.material.iridescence', 'Iridescence', 0, 1, 0.01, 'Material', MATERIAL_DEFAULTS.iridescence,
    'Strength of the soap-bubble colour shift', { when: isPhysicalMaterial }),
  slider('object.material.iridescenceIOR', 'Iridescence IOR', 1, 2.33, 0.01, 'Material', MATERIAL_DEFAULTS.iridescenceIOR,
    'Tunes which colours the bubble film shifts to', { when: isPhysicalMaterial }),
  slider('object.material.envMapIntensity', 'Reflection intensity', 0, 3, 0.05, 'Material', MATERIAL_DEFAULTS.envMapIntensity,
    'How strongly reflections from the surroundings show', { when: hasReflectiveCoat }),
  slider('object.material.ior', 'IOR', 1, 2.33, 0.01, 'Material', MATERIAL_DEFAULTS.ior,
    'How strongly light bends passing through', { when: isPhysicalMaterial }),
  slider('object.material.transmission', 'Transmission', 0, 1, 0.01, 'Material', MATERIAL_DEFAULTS.transmission,
    'Lets light pass through, like glass', { when: isPhysicalMaterial }),
  slider('object.material.thickness', 'Thickness', 0, 2, 0.05, 'Material', MATERIAL_DEFAULTS.thickness,
    'How solid the glass feels as light travels in', { when: isPhysicalMaterial }),

  // Phong — its own specular/shininess model, no roughness/metalness equivalent.
  slider('object.material.shininess', 'Shininess', 0, 200, 1, 'Material', MATERIAL_DEFAULTS.shininess,
    'How tight and glossy the highlight is — higher is sharper', { when: isPhongMaterial }),
  color('object.material.specular', 'Specular', MATERIAL_DEFAULTS.specular, 'Material', { when: isPhongMaterial }),

  // Opalescent — thin-film / holographic. The spectrum itself is the shared `gradientStops`
  // ramp (edited in the surface's stop editor, like the gradient material); these five scalars
  // steer how it maps onto the surface and are the agent-/motion-animatable knobs.
  slider('object.material.opalHueShift', 'Hue shift', 0, 360, 1, 'Material', MATERIAL_DEFAULTS.opalHueShift!,
    'Rotates the whole rainbow around the colour wheel', { when: isOpalMaterial, summary: 2 }),
  slider('object.material.opalFrequency', 'Spectrum bands', 0.5, 5, 0.05, 'Material', MATERIAL_DEFAULTS.opalFrequency!,
    'How many rainbow bands wrap the surface', { when: isOpalMaterial }),
  slider('object.material.opalAngleMix', 'Angle response', 0, 1, 0.01, 'Material', MATERIAL_DEFAULTS.opalAngleMix!,
    'Blends the flow from surface-shape-driven to viewing-angle-driven', { when: isOpalMaterial }),
  slider('object.material.opalFlowSpeed', 'Flow speed', 0, 2, 0.01, 'Material', MATERIAL_DEFAULTS.opalFlowSpeed!,
    'Animates the spectrum over time — 0 keeps it still', { when: isOpalMaterial }),
  slider('object.material.opalStrength', 'Rainbow strength', 0, 1, 0.01, 'Material', MATERIAL_DEFAULTS.opalStrength!,
    'How much rainbow shows over the base colour', { when: isOpalMaterial, summary: 1 }),

  // Surface relief — a grayscale height field perturbing the lit normal (see config.ts's
  // ReliefSpec doc). `source` picks the origin; scale/contrast/tiling tune it. Orthogonal
  // to material type, so gated only by reliefApplies (isEditableMaterial + not-unlit-
  // shaderFill), not by isPhysicalMaterial/isPhongMaterial.
  select('object.material.relief.source', 'Relief source', [...RELIEF_SOURCES], 'none', 'Material',
    'Where the height field comes from — a catalog effect or an uploaded image', { when: reliefApplies }),
  slider('object.material.relief.scale', 'Relief scale', 0, 4, 0.01, 'Material', MATERIAL_DEFAULTS.reliefScale,
    'How raised or recessed the surface detail looks', { when: reliefApplies }),
  slider('object.material.relief.contrast', 'Relief contrast', 1, 6, 0.1, 'Material', MATERIAL_DEFAULTS.reliefContrast,
    'Deepens the light and dark areas so the relief catches the light', { when: reliefApplies }),
  slider('object.material.relief.tiling', 'Relief tiling', 0.25, 12, 0.25, 'Material', MATERIAL_DEFAULTS.reliefTiling,
    'How many times the pattern repeats across the surface — higher is finer', { when: reliefApplies }),

  // Glass extras the Transparency block drew: dispersion + the attenuation pair.
  slider('object.material.dispersion', 'Dispersion', 0, 5, 0.05, 'Material', MATERIAL_DEFAULTS.dispersion,
    'Splits refracted light into rainbow fringes', { when: isPhysicalMaterial, agent: false, animatable: false }),
  color('object.material.attenuationColor', 'Attenuation', MATERIAL_DEFAULTS.attenuationColor, 'Material',
    { when: isPhysicalMaterial, agent: false }),
  slider('object.material.attenuationDistance', 'Attenuation dist', 0, 10, 0.1, 'Material', MATERIAL_DEFAULTS.attenuationDistance,
    'How deep light travels before tinting (0 = off)', { when: isPhysicalMaterial, agent: false, animatable: false }),

  // Toon — cel bands.
  slider('object.material.toonSteps', 'Steps', 2, 5, 1, 'Material', MATERIAL_DEFAULTS.toonSteps,
    'Number of flat cel-shading bands', { when: isToonMaterial, agent: false, animatable: false }),

  // Fresnel — rim glow.
  color('object.material.fresnelColor', 'Rim colour', MATERIAL_DEFAULTS.fresnelColor, 'Material',
    { when: isFresnelMaterial, agent: false }),
  slider('object.material.fresnelPower', 'Power', 1, 8, 0.1, 'Material', MATERIAL_DEFAULTS.fresnelPower,
    'How tightly the rim glow hugs the edges', { when: isFresnelMaterial, agent: false, animatable: false }),

  // Gradient — palette source, ramp direction and mapping. The ramp/stop editors and the
  // harmony scheme picker stay bespoke widgets (the inspector's own blocks); these are the
  // scalar/enum rows around them. `paletteHarmony` is deliberately absent: its options carry
  // display labels (HARMONY_LABELS) a bare `select` row cannot show.
  select('object.material.paletteMode', 'Palette', [...PALETTE_MODES], MATERIAL_DEFAULTS.paletteMode, 'Material', undefined,
    { when: isGradientMaterial, agent: false }),
  slider('object.material.paletteHue', 'Hue', 0, 360, 1, 'Material', MATERIAL_DEFAULTS.paletteHue,
    'Seed hue the harmony scheme is built from',
    { when: isGradientMaterial, agent: false, animatable: false, showIf: { key: 'object.material.paletteMode', equals: 'harmony' } }),
  slider('object.material.paletteSat', 'Saturation', 0, 1, 0.01, 'Material', MATERIAL_DEFAULTS.paletteSat,
    'How vivid the generated colours are',
    { when: isGradientMaterial, agent: false, animatable: false, showIf: { key: 'object.material.paletteMode', equals: 'harmony' } }),
  slider('object.material.paletteLight', 'Lightness', 0.2, 0.9, 0.01, 'Material', MATERIAL_DEFAULTS.paletteLight,
    'How light or dark the generated colours are',
    { when: isGradientMaterial, agent: false, animatable: false, showIf: { key: 'object.material.paletteMode', equals: 'harmony' } }),
  select('object.material.gradientType', 'Type', [...GRADIENT_TYPES], MATERIAL_DEFAULTS.gradientType, 'Material', undefined,
    { when: isGradientMaterial, agent: false }),
  slider('object.material.gradientYaw', 'Yaw', 0, 360, 1, 'Material', MATERIAL_DEFAULTS.gradientYaw,
    'Ramp direction around the Y axis',
    { when: isGradientMaterial, agent: false, animatable: false, showIf: { key: 'object.material.gradientType', equals: 'linear' } }),
  slider('object.material.gradientPitch', 'Pitch', -90, 90, 1, 'Material', MATERIAL_DEFAULTS.gradientPitch,
    'Ramp direction elevation, up or down',
    { when: isGradientMaterial, agent: false, animatable: false, showIf: { key: 'object.material.gradientType', equals: 'linear' } }),
  slider('object.material.gradientOffset', 'Offset', -1, 1, 0.01, 'Material', MATERIAL_DEFAULTS.gradientOffset,
    'Slides the ramp along its direction', { when: isGradientMaterial, agent: false, animatable: false }),
  slider('object.material.gradientSpread', 'Spread', 0.1, 3, 0.01, 'Material', MATERIAL_DEFAULTS.gradientSpread,
    'Compresses (<1) or stretches (>1) the ramp', { when: isGradientMaterial, agent: false, animatable: false }),
  select('object.material.gradientShading', 'Shading', [...GRADIENT_SHADINGS], MATERIAL_DEFAULTS.gradientShading, 'Material', undefined,
    { when: isGradientPrimitive, agent: false }),

  // Relief invert — the surface's own Invert switch. Was hand-omitted (see this module's
  // "Deliberately NOT in this schema" note, now one item shorter): it is a plain boolean on
  // ReliefSpec, so `switch` models it correctly.
  {
    key: 'object.material.relief.invert', label: 'Invert', kind: 'switch', default: false, group: 'Material',
    when: reliefApplies, agent: false,
  } as SceneControl,

  // --- Lighting (doc-level; no active object needed) -------------------------------
  select('lighting.preset', 'Lighting preset', [...LIGHTING_PRESETS], D.lighting.preset, 'Lighting'),
  select('lighting.environment', 'Environment', [...ENVIRONMENT_KINDS], D.lighting.environment, 'Lighting'),
  slider('lighting.sunAzimuth', 'Sun azimuth', 0, 360, 1, 'Lighting', D.lighting.sunAzimuth,
    'Compass direction the sunlight comes from'),
  slider('lighting.sunElevation', 'Sun elevation', 5, 90, 1, 'Lighting', D.lighting.sunElevation,
    'How high the sun sits above the horizon'),
  slider('lighting.sunIntensity', 'Sun intensity', 0, 3, 0.05, 'Lighting', D.lighting.sunIntensity,
    'How bright the main sunlight is'),
  slider('lighting.ambient', 'Ambient', 0, 2, 0.05, 'Lighting', D.lighting.ambient,
    'Soft fill light that lifts the shadows'),

  // --- Camera (doc-level) -----------------------------------------------------------
  slider('camera.fov', 'Field of view', 15, 100, 1, 'Camera', D.camera.fov,
    'Camera field of view — how wide the lens sees'),

  // --- Background (doc-level) -------------------------------------------------------
  // `background` itself (colour/transparent) stays a bespoke row — see this module's
  // doc for why (a stateful proxy, not a plain doc leaf). `showFloor` IS one: a plain
  // boolean on SceneDoc (config.ts), so it joins here as a switch.
  {
    key: 'showFloor', label: 'Floor', kind: 'switch', default: D.showFloor, group: 'Background',
    hint: 'Grid + shadow-catcher ground — off gives a clean floating look',
  } as SceneControl,

  // --- Post (doc-level; derived from the shared manifest, not hand-declared) -------
  // Includes ambient occlusion (gtao needs a depth buffer — `three-depth` is the only
  // host that asks for it) plus every other shared effect (bloom/color/duotone/chroma/
  // blur/film/halftone/dotScreen/glitch/grain/vignette), each with its own `switch`
  // enable now that the agent/inspector read from this manifest instead of a hand-list.
  ...postControls({ host: 'three-depth' }),

  // --- Transform (prefix object.) ---------------------------------------------------
  // NOT animatable: Scene3D's existing ObjectMotion preset system (app/lib/scene3d/
  // motion/) already owns transforms, composing per-frame deltas onto the home
  // transform read at bake time. A second system (motion tracks driven off THIS
  // schema) writing the same position/rotation/scale would fight it. Ranges are
  // intentionally generous (not per-object) since this is a general-purpose control,
  // not a per-primitive-kind one. Rotation is stored in radians (SceneObjectBase.
  // rotation), NOT the degrees the Selection UI displays — the UI's rotX/rotY/rotZ
  // computed props convert at the edge; this schema addresses the underlying radian
  // value makeConfigParams writes straight through.
  //
  // Keys use numeric array indices (e.g., `object.position.0` not `.x`) because
  // Vec3 is a plain array `[number, number, number]` with no `.x/.y/.z` properties.
  // The path resolver (lib/studio/path.ts) reads these via `o[k]` which works for
  // numeric string keys on arrays. Labels stay human-readable ("Position X", etc.);
  // keys are dotted paths addressing the data, nothing else.
  slider('object.position.0', 'Position X', -20, 20, 0.1, 'Transform', 0, undefined, { animatable: false }),
  slider('object.position.1', 'Position Y', -20, 20, 0.1, 'Transform', 0, undefined, { animatable: false }),
  slider('object.position.2', 'Position Z', -20, 20, 0.1, 'Transform', 0, undefined, { animatable: false }),
  slider('object.rotation.0', 'Rotation X', -Math.PI, Math.PI, 0.01, 'Transform', 0, 'Radians', { animatable: false }),
  slider('object.rotation.1', 'Rotation Y', -Math.PI, Math.PI, 0.01, 'Transform', 0, 'Radians', { animatable: false }),
  slider('object.rotation.2', 'Rotation Z', -Math.PI, Math.PI, 0.01, 'Transform', 0, 'Radians', { animatable: false }),
  slider('object.scale.0', 'Scale X', 0.05, 10, 0.05, 'Transform', 1, undefined, { animatable: false }),
  slider('object.scale.1', 'Scale Y', 0.05, 10, 0.05, 'Transform', 1, undefined, { animatable: false }),
  slider('object.scale.2', 'Scale Z', 0.05, 10, 0.05, 'Transform', 1, undefined, { animatable: false }),
]

/** Controls applicable to `doc`/`obj`, in SCENE_SECTIONS order — the single gate
 *  everything downstream (agent vocabulary, Collection binding UI, motion targets)
 *  derives from. `obj` is the active/selected SceneObject, if any. */
export function visibleSceneControls(doc: SceneDoc, obj?: SceneObject): SceneControl[] {
  const out: SceneControl[] = []
  for (const section of SCENE_SECTIONS) {
    for (const c of SCENE_CONTROLS) {
      if (c.group !== section) continue
      if (c.when && !c.when(doc, obj)) continue
      out.push(c)
    }
  }
  return out
}
