import type { ControlSpec } from '~/lib/spacetype/effect'
import { DEFAULT_POST } from '~/lib/spacetype/postSettings'
import {
  MATERIAL_TYPES, MATERIAL_DEFAULTS, DEFAULT_MATERIAL, LIGHTING_PRESETS, defaultDoc,
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
 * Scene3D's OWN booleans are still hand-omitted from this schema: every `post.*` effect
 * enable (bloom/color/chroma/blur/film/halftone/dotScreen/glitch/gtao), plus
 * `material.unlit`, `GlbObject.materialOverride` and `material.relief.invert`. So the
 * agent can tune `post.bloomStrength` but cannot switch bloom on, and can tune
 * `object.material.relief.scale` but cannot flip `relief.invert`. That is now a gap in
 * THIS file, not in the shared schema — declaring them as `switch` controls is the fix
 * whenever someone wants it, and would fold naturally into a migration of Scene3D onto
 * the shared post manifest (`~/lib/studio/post/manifest.ts`), which already declares
 * every one of those post enables.
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
 * - `background`, `showFloor`, `output.width/height` — scene-level settings outside the
 *   "at minimum" list this schema was scoped to; add them here in a follow-on if the
 *   agent/Collection story needs them.
 * - Every `post.*` boolean enable, `material.unlit`, `material.relief.invert` — see the
 *   booleans note above.
 *
 * Must stay free of `three` imports — this module is dynamically imported by the
 * Collection control resolver (see shapefx/controls.ts's identical constraint).
 */
export type SceneControl = ControlSpec & {
  when?: (doc: SceneDoc, obj?: SceneObject) => boolean
}

/** Emission order; a control whose group is not listed here is silently dropped by
 *  visibleSceneControls. */
export const SCENE_SECTIONS = ['Material', 'Lighting', 'Camera', 'Post', 'Transform'] as const

// ── `when` predicates ────────────────────────────────────────────────────────────
// Material controls only make sense on an object that actually renders `.material`:
// a primitive always does, a GLB only once `materialOverride` is on, and a light never
// does (LightObject carries a dummy DEFAULT_MATERIAL — see config.ts's sceneHasShaderFill
// doc — that is never fed to a real THREE material). Mirrors the Selection UI's own
// `matEditable` computed (Scene3DStudioSurface.vue). No active object (`obj` undefined,
// e.g. a Collection binding evaluated without a live selection) defaults to visible —
// the schema still needs to describe what the control WOULD do.
const isEditableMaterial = (_doc: SceneDoc, obj?: SceneObject): boolean =>
  !obj || obj.kind === 'primitive' || (obj.kind === 'glb' && obj.materialOverride === true)

const materialTypeOf = (obj?: SceneObject): MaterialType =>
  obj && obj.kind !== 'light' ? obj.material.type : DEFAULT_MATERIAL.type

// Mirrors the Surface/Coat/Glow/Transparency/Iridescence/Reflection block, which the
// surface only renders for standard + glass (Scene3DStudioSurface.vue:1959).
const isPhysicalMaterial = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && (materialTypeOf(obj) === 'standard' || materialTypeOf(obj) === 'glass')

// Phong's own specular/shininess model — deliberately distinct from the PBR types, see
// MaterialType's doc in config.ts. Mirrors Scene3DStudioSurface.vue:2031.
const isPhongMaterial = (doc: SceneDoc, obj?: SceneObject): boolean =>
  isEditableMaterial(doc, obj) && materialTypeOf(obj) === 'phong'

// roughness/metalness apply to standard, glass and image (all PBR-lit) and to shaderFill
// only while it isn't unlit (a MeshBasicMaterial has no roughness/metalness slot at all).
// Mirrors the surface's per-branch StudioSlider calls for these two keys.
const hasPbrSurface = (doc: SceneDoc, obj?: SceneObject): boolean => {
  if (!isEditableMaterial(doc, obj)) return false
  const t = materialTypeOf(obj)
  if (t === 'standard' || t === 'glass' || t === 'image' || t === 'opalescent') return true
  if (t === 'shaderFill') return !(obj && obj.kind !== 'light' && obj.material.unlit === true)
  return false
}

// Opalescent (thin-film / holographic) — its own spectral block. Mirrors the surface's
// `matType === 'opalescent'` branch.
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
// shaderFill (a MeshBasicMaterial has no bump slot at all — Scene3DStudioSurface.vue's
// `reliefAvailable`).
const reliefApplies = (doc: SceneDoc, obj?: SceneObject): boolean => {
  if (!isEditableMaterial(doc, obj)) return false
  if (materialTypeOf(obj) === 'shaderFill' && obj && obj.kind !== 'light' && obj.material.unlit === true) return false
  return true
}

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
    'How matte or glossy the surface is', { when: hasPbrSurface, summary: 2 }),
  slider('object.material.metalness', 'Metalness', 0, 1, 0.01, 'Material', DEFAULT_MATERIAL.metalness,
    'Blends between plastic-like and metal reflections', { when: hasPbrSurface }),
  select('object.material.type', 'Material type', [...MATERIAL_TYPES], DEFAULT_MATERIAL.type, 'Material', undefined,
    { when: isEditableMaterial, summary: 1 }),

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

  // --- Lighting (doc-level; no active object needed) -------------------------------
  select('lighting.preset', 'Lighting preset', [...LIGHTING_PRESETS], D.lighting.preset, 'Lighting'),
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

  // --- Post (doc-level; numeric only — see the boolean-gap doc above) --------------
  slider('post.bloomStrength', 'Bloom strength', 0, 3, 0.05, 'Post', DEFAULT_POST.bloomStrength, 'How strong the glow is'),
  slider('post.bloomRadius', 'Bloom radius', 0, 1, 0.05, 'Post', DEFAULT_POST.bloomRadius, 'How far the glow spreads'),
  slider('post.bloomThreshold', 'Bloom threshold', 0, 1, 0.05, 'Post', DEFAULT_POST.bloomThreshold,
    'How bright a pixel must be before it blooms'),
  slider('post.gtaoRadius', 'GTAO radius', 0.05, 3, 0.05, 'Post', DEFAULT_POST.gtaoRadius,
    'How far around each point to check for blockers, in scene units'),
  slider('post.gtaoIntensity', 'GTAO intensity', 0, 2, 0.05, 'Post', DEFAULT_POST.gtaoIntensity,
    'How dark the occluded areas get'),
  slider('post.gtaoThickness', 'GTAO thickness', 0.05, 2, 0.05, 'Post', DEFAULT_POST.gtaoThickness,
    'How solid nearby surfaces are treated as blockers'),
  slider('post.filmIntensity', 'Film grain intensity', 0, 1, 0.01, 'Post', DEFAULT_POST.filmIntensity, 'How strong the grain is'),
  slider('post.halftoneRadius', 'Halftone radius', 1, 20, 0.5, 'Post', DEFAULT_POST.halftoneRadius, 'Size of the print dots'),
  slider('post.halftoneScatter', 'Halftone scatter', 0, 1, 0.02, 'Post', DEFAULT_POST.halftoneScatter,
    'Randomises dot placement'),
  slider('post.dotScreenScale', 'Dot screen scale', 0.2, 4, 0.1, 'Post', DEFAULT_POST.dotScreenScale, 'Size of the dot pattern'),
  slider('post.dotScreenAngle', 'Dot screen angle', -3.14, 3.14, 0.05, 'Post', DEFAULT_POST.dotScreenAngle, 'Rotates the dot grid'),
  slider('post.exposure', 'Exposure', 0.2, 2, 0.05, 'Post', DEFAULT_POST.exposure, 'Overall brightness'),
  slider('post.contrast', 'Contrast', 0, 2, 0.05, 'Post', DEFAULT_POST.contrast, 'Difference between darks and lights'),
  slider('post.saturation', 'Saturation', 0, 2, 0.05, 'Post', DEFAULT_POST.saturation, 'How vivid the colours are'),
  slider('post.hue', 'Hue', -3.14, 3.14, 0.05, 'Post', DEFAULT_POST.hue, 'Rotates every colour around the wheel'),
  slider('post.chromaAmount', 'Chroma amount', 0, 1.5, 0.02, 'Post', DEFAULT_POST.chromaAmount, 'Colour fringing at the edges'),
  slider('post.blurAmount', 'Blur amount', 0, 0.04, 0.002, 'Post', DEFAULT_POST.blurAmount, 'Soft bokeh-style blur'),

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
