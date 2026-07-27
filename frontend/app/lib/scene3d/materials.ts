// Material factory for 3D Studio primitives. One module owns creation, in-place
// update, and disposal for every material type, so the engine stays lean and
// the Selection UI can share the same defaults (config.MATERIAL_DEFAULTS).
//
// Node-safety: matcap textures and picker thumbnails need a canvas; in non-DOM
// environments (vitest) those degrade to null/'' while the material classes and
// update logic stay fully testable.
import * as THREE from 'three'
// Every colour below comes from a StudioColor picker, which can emit 8-digit #rrggbbaa.
// THREE.Color has no alpha channel and renders 8-digit hex as WHITE (a console warning, no
// throw), so each one is stripped to 6 digits — an effect that doesn't implement transparency
// degrades to opaque rather than turning the object white.
import { stripAlpha } from '~/lib/color/convert'
import {
  MATERIAL_DEFAULTS, gradientAngles, gradientDirection, gradientStopsOf,
  type GradientStop, type SceneMaterial,
} from './config'
// The field module — the ONLY place a ShaderSpec becomes pixels (see its ownership contract).
// Scene3D is a second, independent consumer alongside Space Type/Shape Studio's
// ~/lib/spacetype/fills.ts: it never routes through `Fill`/`FILL_TYPES` (SceneMaterial has no
// such concept), just resolveField/beginFieldFrame directly, with its OWN per-engine ownership
// scoping below (shaderFillMaterials + refreshSceneShaderFields) — deliberately not reusing
// fills.ts's `_shaderFieldCache`/`withShaderFillContext`, so Scene3D's live-field ceiling and
// frozen count can never pool with, or be walked by, Space Type's or the Compositor's.
import { resolveField, withFieldFrame, type FieldRequest } from '~/lib/shaderfill/field'
import { DEFAULT_SHADER_SPEC, type ShaderSpec } from '~/lib/spacetype/fillTile'

const hasDOM = typeof document !== 'undefined'

// ── Matcaps: runtime-generated set (no bundled assets) ───────────────────────
export const MATCAP_IDS = ['chrome', 'clay', 'pearl', 'gold', 'carbon']

interface MatcapSpec { inner: string; mid: string; outer: string; highlight: number }
const MATCAP_SPECS: Record<string, MatcapSpec> = {
  chrome: { inner: '#f8fafc', mid: '#94a3b8', outer: '#1e293b', highlight: 0.9 },
  clay:   { inner: '#e7e2da', mid: '#b6aa99', outer: '#57503f', highlight: 0.25 },
  pearl:  { inner: '#fff7fb', mid: '#dcc8e8', outer: '#8e7a9d', highlight: 0.55 },
  gold:   { inner: '#fff3c4', mid: '#d9a441', outer: '#5c3a10', highlight: 0.8 },
  carbon: { inner: '#4b5563', mid: '#1f2937', outer: '#030712', highlight: 0.35 },
}

function drawMatcap(spec: MatcapSpec, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  // Sphere-shaded radial gradient, light from upper-left (matcap convention).
  const g = ctx.createRadialGradient(size * 0.38, size * 0.35, size * 0.05, size * 0.5, size * 0.5, size * 0.55)
  g.addColorStop(0, spec.inner)
  g.addColorStop(0.55, spec.mid)
  g.addColorStop(1, spec.outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  // Specular highlight dot.
  const h = ctx.createRadialGradient(size * 0.36, size * 0.32, 0, size * 0.36, size * 0.32, size * 0.16)
  h.addColorStop(0, `rgba(255,255,255,${spec.highlight})`)
  h.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = h
  ctx.fillRect(0, 0, size, size)
  return c
}

const matcapCache = new Map<string, THREE.Texture>()
/** Module-lifetime singleton textures — shared across materials, never disposed. */
function getMatcap(id: string): THREE.Texture | null {
  if (!hasDOM) return null
  const key = MATCAP_SPECS[id] ? id : MATCAP_IDS[0]!
  let t = matcapCache.get(key)
  if (!t) {
    t = new THREE.CanvasTexture(drawMatcap(MATCAP_SPECS[key]!, 256))
    t.colorSpace = THREE.SRGBColorSpace
    matcapCache.set(key, t)
  }
  return t
}

const thumbCache = new Map<string, string>()
export function matcapThumb(id: string): string {
  if (!hasDOM) return ''
  const key = MATCAP_SPECS[id] ? id : MATCAP_IDS[0]!
  let u = thumbCache.get(key)
  if (!u) { u = drawMatcap(MATCAP_SPECS[key]!, 64).toDataURL('image/png'); thumbCache.set(key, u) }
  return u
}

// ── Toon step ramp (per-material, disposed with it) ──────────────────────────
function toonRamp(steps: number): THREE.DataTexture {
  const n = Math.max(2, Math.min(5, Math.round(steps)))
  const data = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const v = Math.round((i / (n - 1)) * 255)
    data.set([v, v, v, 255], i * 4)
  }
  const t = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat)
  t.magFilter = t.minFilter = THREE.NearestFilter
  t.needsUpdate = true
  return t
}

// ── Image textures (cached per filename; failures broadcast to the UI) ───────
const imageCache = new Map<string, THREE.Texture>()
const errorSubs = new Set<(filename: string) => void>()
export function onTextureError(cb: (filename: string) => void): () => void {
  errorSubs.add(cb)
  return () => errorSubs.delete(cb)
}
/** Materials currently holding an image texture — used to drop `map` on load failure. */
const imageMaterials = new Set<THREE.MeshStandardMaterial>()

// ── Shader-fill field textures (object anchor only) ──────────────────────────
// A live request is clamped to this square regardless of the mesh's actual screen size —
// matches resolveField's own LIVE_FIELD_PX ceiling (~/lib/shaderfill/field.ts), so live
// requests never get upscaled past what resolveField would hand back anyway.
const SHADER_FIELD_PX = 512
/** Placeholder ownerId for a `materialFor` call made with no engine in scope (unit tests,
 *  stray callers) — every field built under it shares one bucket, same fallback shape as
 *  fills.ts's UNOWNED. Real callers (SceneEngine) always pass their own stable `id`. */
const UNOWNED_SCENE3D = '__scene3d_unowned__'

/** Every live shaderFill material, across every open Scene3D engine — filtered by
 *  `userData.shaderOwnerId` in `refreshSceneShaderFields` so each engine's live-field ceiling
 *  and frozen count (via `beginFieldFrame`) apply per-engine, never pooled across engines and
 *  never touching Space Type/Shape Studio's separate cache in ~/lib/spacetype/fills.ts. Each
 *  entry also carries its current ShaderSpec in `userData.shaderSpec` (kept live by
 *  `updateMaterial`, read every frame by the refresh below) and owns exactly one
 *  THREE.CanvasTexture, reused for the material's whole lifetime — never reallocated per frame,
 *  per resolveField's ownership contract (its canvas is bound directly as `.image`, never
 *  copied). */
const shaderFillMaterials = new Set<THREE.Material>()
function getImageTexture(filename: string): THREE.Texture | null {
  if (!hasDOM || !filename) return null
  let t = imageCache.get(filename)
  if (!t) {
    const tex = new THREE.TextureLoader().load(
      `/view?${new URLSearchParams({ filename, type: 'input' })}`,
      undefined,
      undefined,
      () => {
        imageCache.delete(filename)
        errorSubs.forEach((cb) => cb(filename))
        imageMaterials.forEach((mat) => {
          if (mat.map === tex) { mat.map = null; mat.needsUpdate = true }
        })
      },
    )
    t = tex
    t.colorSpace = THREE.SRGBColorSpace
    imageCache.set(filename, t)
  }
  return t
}

// ── Fresnel / gradient: LIT materials (Spline-style layers over lighting) ────
// Both are MeshStandardMaterials with onBeforeCompile injections, so the full
// standard pipeline (sun, env, shadows, tone mapping) applies. An unlit
// ShaderMaterial flattens the surface — that was the original gradient bug.

// Fresnel: base colour is the lit albedo; the rim is added as emissive glow so
// it reads over any lighting (like Spline's Fresnel layer).
const FRESNEL_FRAG_DECL = /* glsl */ `#include <common>
uniform vec3 uRim; uniform float uPower;`
const FRESNEL_FRAG_BODY = /* glsl */ `#include <emissivemap_fragment>
{
  float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uPower);
  totalEmissiveRadiance += uRim * rim;
}`

// Gradient: object-space colour ramp driving the albedo. Two program variants:
//  - smooth: one ramp across the whole object (per-pixel, object bbox range).
//  - facet:  runs on the engine's flat-shaded geometry variant, which carries
//    per-face extent attributes (aFaceMin/aFaceMax). uMode picks between
//    faceted (1: one flat tone per facet, sampled at the provoking vertex) and
//    prismatic (2: the FULL ramp swept across each facet individually — the
//    ShapeStudio cut-gem look). `flat` varyings ride through three's GLSL3
//    prefix (`varying` → in/out) verbatim.
const GRADIENT_SMOOTH_VERT_DECL = /* glsl */ `#include <common>
varying vec3 vGradPos;`
const GRADIENT_SMOOTH_VERT_BODY = /* glsl */ `#include <begin_vertex>
vGradPos = position;`
// Shared ramp maths. `t` is normalised over the bounding box *projected onto the
// ramp direction*: r = dot(|dir|, halfExtent) is the box's half-width along dir,
// so t = (dot(p - centre, dir) + r) / 2r spans exactly 0..1 across the shape.
// For a unit axis this is algebraically identical to the old per-axis
// (p - lo) / (hi - lo) — numerator and denominator both, guard included — so the
// x/y/z presets reproduce the previous look bit for bit.
const GRADIENT_RAMP_FN = /* glsl */ `
float gradT(vec3 p, vec3 bmin, vec3 bmax) {
  vec3 centre = (bmin + bmax) * 0.5;
  vec3 halfExt = (bmax - bmin) * 0.5;
  float t;
  if (uType == 1) {
    t = length(p - centre) / max(length(halfExt), 1e-5);
  } else {
    float r = dot(abs(uDir), halfExt);
    t = (dot(p - centre, uDir) + r) / max(2.0 * r, 1e-5);
  }
  return clamp(t, 0.0, 1.0);
}
vec3 gradSample(float t) {
  return texture2D(uRamp, vec2(clamp((t - 0.5) / uSpread + 0.5 - uOffset, 0.0, 1.0), 0.5)).rgb;
}`

const GRADIENT_UNIFORM_DECL = /* glsl */ `
uniform sampler2D uRamp;
uniform vec3 uBoxMin; uniform vec3 uBoxMax;
uniform vec3 uDir; uniform int uType;
uniform float uOffset; uniform float uSpread;`

const GRADIENT_SMOOTH_FRAG_DECL = /* glsl */ `#include <common>
${GRADIENT_UNIFORM_DECL}
varying vec3 vGradPos;
${GRADIENT_RAMP_FN}`
const GRADIENT_SMOOTH_FRAG_BODY = /* glsl */ `#include <color_fragment>
{
  diffuseColor.rgb = gradSample(gradT(vGradPos, uBoxMin, uBoxMax));
}`

const GRADIENT_FACET_VERT_DECL = /* glsl */ `#include <common>
attribute vec3 aFaceMin;
attribute vec3 aFaceMax;
varying vec3 vGradPos;
flat varying vec3 vGradFlat;
flat varying vec3 vFaceMin;
flat varying vec3 vFaceMax;`
const GRADIENT_FACET_VERT_BODY = /* glsl */ `#include <begin_vertex>
vGradPos = position;
vGradFlat = position;
vFaceMin = aFaceMin;
vFaceMax = aFaceMax;`
const GRADIENT_FACET_FRAG_DECL = /* glsl */ `#include <common>
${GRADIENT_UNIFORM_DECL}
uniform int uMode;
varying vec3 vGradPos;
flat varying vec3 vGradFlat;
flat varying vec3 vFaceMin;
flat varying vec3 vFaceMax;
${GRADIENT_RAMP_FN}`
const GRADIENT_FACET_FRAG_BODY = /* glsl */ `#include <color_fragment>
{
  // Prismatic (2): normalise within THIS face's own extent → the full ramp per
  // facet. Faceted (1): one flat tone per face, sampled at the provoking vertex
  // against the whole-object box. Both project the same way.
  float t = uMode == 2
    ? gradT(vGradPos, vFaceMin, vFaceMax)
    : gradT(vGradFlat, uBoxMin, uBoxMax);
  diffuseColor.rgb = gradSample(t);
}`

// ── Gradient ramp LUT ────────────────────────────────────────────────────────
const RAMP_WIDTH = 256

/** Build the 256×1 sRGB LUT the gradient shader samples. Colours interpolate in
 *  sRGB between adjacent stops — the same space a CSS `linear-gradient` uses, so
 *  the ramp editor's preview and the rendered object agree. Beyond the outermost
 *  stops the edge colour floods.
 *
 *  Input need NOT be sorted: the endpoint flood and the monotonic `seg` walk
 *  below both assume ascending `pos`, so an unsorted array would render a
 *  glitched ramp. The ramp editor deliberately keeps its working array
 *  unsorted mid-drag (sorting live would make the dragged handle jump under
 *  the cursor), and that array reaches here on every pointermove. Sorting a
 *  copy here — at most 8 entries — makes this self-defending rather than
 *  leaving a precondition every future caller has to remember. */
export function buildRampTexture(stops: GradientStop[]): THREE.DataTexture {
  // getHex(SRGBColorSpace) undoes three's sRGB→linear ingest, giving back the
  // authored 8-bit channels; the texture's colorSpace re-decodes them on sample.
  const srgb = [...stops].sort((a, b) => a.pos - b.pos).map((s) => {
    const hex = new THREE.Color(stripAlpha(s.color)).getHex(THREE.SRGBColorSpace)
    return { pos: s.pos, r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 }
  })
  const data = new Uint8Array(RAMP_WIDTH * 4)
  const first = srgb[0]!
  const last = srgb[srgb.length - 1]!
  let seg = 0
  for (let i = 0; i < RAMP_WIDTH; i++) {
    const x = i / (RAMP_WIDTH - 1)
    let r: number, g: number, b: number
    if (x <= first.pos) { r = first.r; g = first.g; b = first.b }
    else if (x >= last.pos) { r = last.r; g = last.g; b = last.b }
    else {
      while (seg < srgb.length - 2 && x > srgb[seg + 1]!.pos) seg++
      const a = srgb[seg]!, c = srgb[seg + 1]!
      const span = c.pos - a.pos
      const f = span > 0 ? (x - a.pos) / span : 1
      r = a.r + (c.r - a.r) * f
      g = a.g + (c.g - a.g) * f
      b = a.b + (c.b - a.b) * f
    }
    data.set([Math.round(r), Math.round(g), Math.round(b), 255], i * 4)
  }
  const t = new THREE.DataTexture(data, RAMP_WIDTH, 1, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = t.minFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

/** Cheap change detector: the LUT is rebuilt only when this string moves. */
function rampSignature(stops: GradientStop[]): string {
  return stops.map((s) => `${s.pos}:${s.color}`).join('|')
}

// ── Physical surface (standard + glass share one builder) ────────────────────
/** Apply every physical-surface param from the doc onto a MeshPhysicalMaterial.
 *  Shared by creation and in-place update so the two can never drift. */
function applyPhysical(p: THREE.MeshPhysicalMaterial, mat: SceneMaterial): void {
  const isGlass = mat.type === 'glass'
  p.color.set(stripAlpha(mat.color))
  p.roughness = mat.roughness
  p.metalness = mat.metalness
  p.transmission = mat.transmission ?? (isGlass ? MATERIAL_DEFAULTS.transmission : 0)
  p.ior = mat.ior ?? MATERIAL_DEFAULTS.ior
  p.thickness = mat.thickness ?? MATERIAL_DEFAULTS.thickness
  // Transmissive surfaces render double-sided so refraction reaches the object's
  // own back walls and interior facets — a solid glass gem rather than a hollow
  // shell. Opaque surfaces stay single-sided (alpha opacity is a flat front-face
  // fade by design; Transmission is the physical see-through path).
  p.side = p.transmission > 0 ? THREE.DoubleSide : THREE.FrontSide
  p.clearcoat = mat.clearcoat ?? MATERIAL_DEFAULTS.clearcoat
  p.clearcoatRoughness = mat.clearcoatRoughness ?? MATERIAL_DEFAULTS.clearcoatRoughness
  p.sheen = mat.sheen ?? MATERIAL_DEFAULTS.sheen
  p.sheenColor.set(stripAlpha(mat.sheenColor ?? MATERIAL_DEFAULTS.sheenColor))
  p.emissive.set(stripAlpha(mat.emissive ?? MATERIAL_DEFAULTS.emissive))
  p.emissiveIntensity = mat.emissiveIntensity ?? MATERIAL_DEFAULTS.emissiveIntensity
  p.opacity = mat.opacity ?? MATERIAL_DEFAULTS.opacity
  p.transparent = p.opacity < 1
  p.dispersion = mat.dispersion ?? MATERIAL_DEFAULTS.dispersion
  p.attenuationColor.set(stripAlpha(mat.attenuationColor ?? MATERIAL_DEFAULTS.attenuationColor))
  const att = mat.attenuationDistance ?? MATERIAL_DEFAULTS.attenuationDistance
  p.attenuationDistance = att > 0 ? att : Infinity
  p.iridescence = mat.iridescence ?? MATERIAL_DEFAULTS.iridescence
  p.iridescenceIOR = mat.iridescenceIOR ?? MATERIAL_DEFAULTS.iridescenceIOR
  p.envMapIntensity = mat.envMapIntensity ?? MATERIAL_DEFAULTS.envMapIntensity
}

// ── Factory ──────────────────────────────────────────────────────────────────
/** `ownerId` scopes a `shaderFill` material's live field to the calling engine (see
 *  `shaderFillMaterials`'s doc) — SceneEngine always passes its own stable `id`; callers with
 *  no engine in scope (unit tests) fall back to a shared UNOWNED bucket. Ignored by every other
 *  material type. */
export function materialFor(mat: SceneMaterial, geometry?: THREE.BufferGeometry, ownerId: string = UNOWNED_SCENE3D): THREE.Material {
  let m: THREE.Material
  switch (mat.type) {
    case 'toon': {
      const t = new THREE.MeshToonMaterial({ color: mat.color })
      t.gradientMap = toonRamp(mat.toonSteps ?? MATERIAL_DEFAULTS.toonSteps)
      m = t
      break
    }
    case 'matcap': {
      const t = new THREE.MeshMatcapMaterial()
      const tex = getMatcap(mat.matcap ?? MATERIAL_DEFAULTS.matcap)
      if (tex) t.matcap = tex
      m = t
      break
    }
    case 'fresnel': {
      // Lit fresnel: base colour is standard albedo, rim added as emissive.
      const fresnelUniforms = {
        uRim: { value: new THREE.Color(stripAlpha(mat.fresnelColor ?? MATERIAL_DEFAULTS.fresnelColor)) },
        uPower: { value: mat.fresnelPower ?? MATERIAL_DEFAULTS.fresnelPower },
      }
      const f = new THREE.MeshStandardMaterial({ color: mat.color, roughness: mat.roughness, metalness: mat.metalness })
      f.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, fresnelUniforms)
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', FRESNEL_FRAG_DECL)
          .replace('#include <emissivemap_fragment>', FRESNEL_FRAG_BODY)
      }
      f.customProgramCacheKey = () => 'scene3d-fresnel'
      f.userData.fresnelUniforms = fresnelUniforms
      m = f
      break
    }
    case 'gradient': {
      // Bounding range comes from the geometry so the ramp always spans the
      // shape exactly; falls back to the unit-ish primitive envelope.
      let boxMin = new THREE.Vector3(-0.55, -0.55, -0.55)
      let boxMax = new THREE.Vector3(0.55, 0.55, 0.55)
      if (geometry) {
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (geometry.boundingBox) { boxMin = geometry.boundingBox.min.clone(); boxMax = geometry.boundingBox.max.clone() }
      }
      // Uniform objects live outside the compile closure: onBeforeCompile wires
      // these same objects into the program, so updateMaterial can mutate
      // .value at any time (before or after first compile) and it just works.
      const shading = mat.gradientShading ?? MATERIAL_DEFAULTS.gradientShading
      // Program split: 'smooth' runs on plain geometry; 'faceted'/'prismatic'
      // share the facet program, which reads the engine's per-face extent
      // attributes (aFaceMin/aFaceMax on the flat-shaded geometry variant) and
      // switches between them with the uMode uniform (in-place). Crossing the
      // smooth↔facet boundary rebuilds via identityKey.
      const facetProgram = shading !== 'smooth'
      const stops = gradientStopsOf(mat)
      const { yaw, pitch } = gradientAngles(mat)
      const gradUniforms: Record<string, { value: unknown }> = {
        uRamp: { value: buildRampTexture(stops) },
        uBoxMin: { value: boxMin },
        uBoxMax: { value: boxMax },
        uDir: { value: new THREE.Vector3(...gradientDirection(yaw, pitch)) },
        uType: { value: (mat.gradientType ?? MATERIAL_DEFAULTS.gradientType) === 'radial' ? 1 : 0 },
        uOffset: { value: mat.gradientOffset ?? MATERIAL_DEFAULTS.gradientOffset },
        uSpread: { value: mat.gradientSpread ?? MATERIAL_DEFAULTS.gradientSpread },
      }
      if (facetProgram) gradUniforms.uMode = { value: shading === 'prismatic' ? 2 : 1 }
      const g = new THREE.MeshStandardMaterial({ roughness: mat.roughness, metalness: mat.metalness })
      g.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, gradUniforms)
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', facetProgram ? GRADIENT_FACET_VERT_DECL : GRADIENT_SMOOTH_VERT_DECL)
          .replace('#include <begin_vertex>', facetProgram ? GRADIENT_FACET_VERT_BODY : GRADIENT_SMOOTH_VERT_BODY)
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', facetProgram ? GRADIENT_FACET_FRAG_DECL : GRADIENT_SMOOTH_FRAG_DECL)
          .replace('#include <color_fragment>', facetProgram ? GRADIENT_FACET_FRAG_BODY : GRADIENT_SMOOTH_FRAG_BODY)
      }
      // Same-variant gradient materials share one program (uniforms differ per
      // material); without a key, three would reuse the plain-standard program
      // and skip our injection — or recompile per material.
      g.customProgramCacheKey = () => (facetProgram ? 'scene3d-gradient-facet' : 'scene3d-gradient-smooth')
      g.userData.gradUniforms = gradUniforms
      g.userData.rampSig = rampSignature(stops)
      m = g
      break
    }
    case 'image': {
      const t = new THREE.MeshStandardMaterial({
        // White base so the texture shows untinted (the doc's colour is ignored
        // for image materials — there is no colour control in the image UI).
        color: '#ffffff',
        roughness: mat.roughness,
        metalness: mat.metalness,
      })
      const tex = getImageTexture(mat.image ?? '')
      if (tex) t.map = tex
      imageMaterials.add(t)
      m = t
      break
    }
    case 'shaderFill': {
      // Object anchor only (Scene3D's whole scope — see the field's doc on SceneMaterial.shader
      // in config.ts): `.map` samples through the mesh's own UV attribute exactly like `image`
      // above, so `spec.anchor` is never read here — a `frame`-anchored spec (frame anchor needs
      // onBeforeCompile screen-space injection, like `fresnel`'s rim above — a later task) just
      // renders as `object`, silently and correctly per the brief.
      const spec = mat.shader ?? DEFAULT_SHADER_SPEC
      const canvas = resolveField({ spec, w: SHADER_FIELD_PX, h: SHADER_FIELD_PX, t: 0, fps: 30 })
      const tex2 = canvas ? new THREE.CanvasTexture(canvas) : null
      if (tex2) { tex2.colorSpace = THREE.SRGBColorSpace; tex2.wrapS = tex2.wrapT = THREE.ClampToEdgeWrapping }
      const unlit = mat.unlit === true
      // Unlit uses Basic so the field glows flat (no scene-light shading, the point of the
      // toggle for a self-lit look); otherwise Standard so scene lights shade the field like
      // any other surface.
      const t: THREE.Material = unlit
        ? new THREE.MeshBasicMaterial({ color: '#ffffff', map: tex2 })
        : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: mat.roughness, metalness: mat.metalness, map: tex2 })
      t.userData.shaderSpec = spec
      t.userData.shaderOwnerId = ownerId
      shaderFillMaterials.add(t)
      m = t
      break
    }
    case 'glass':
    case 'standard':
    default: {
      const p = new THREE.MeshPhysicalMaterial()
      applyPhysical(p, mat)
      m = p
      break
    }
  }
  m.userData.matType = mat.type
  m.userData.identity = identityKey(mat)
  return m
}

/** Params that require a rebuild when they change (texture/ramp identity). */
function identityKey(mat: SceneMaterial): string {
  switch (mat.type) {
    case 'toon': return `toon:${mat.toonSteps ?? MATERIAL_DEFAULTS.toonSteps}`
    case 'matcap': return `matcap:${mat.matcap ?? MATERIAL_DEFAULTS.matcap}`
    case 'image': return `image:${mat.image ?? ''}`
    // `unlit` picks the THREE material CLASS (Basic vs Standard) — that boundary needs a
    // rebuild; the effect/params/speed/input inside `shader` are refreshed in place every
    // frame by refreshSceneShaderFields, never through this identity (see updateMaterial).
    case 'shaderFill': return `shaderFill:${mat.unlit === true ? 1 : 0}`
    // Program variant boundary: smooth vs facet (faceted/prismatic share the
    // facet program and switch via the uMode uniform in place).
    case 'gradient':
      return `gradient:${(mat.gradientShading ?? MATERIAL_DEFAULTS.gradientShading) === 'smooth' ? 'smooth' : 'facet'}`
    default: return mat.type
  }
}

export function updateMaterial(m: THREE.Material, mat: SceneMaterial): boolean {
  if (m.userData.matType !== mat.type || m.userData.identity !== identityKey(mat)) return false
  switch (mat.type) {
    case 'standard':
    case 'glass': {
      const p = m as THREE.MeshPhysicalMaterial
      const wasTransparent = p.transparent
      applyPhysical(p, mat)
      // Recompile only on define-boundary crossings. three's MeshPhysicalMaterial
      // setters self-recompile when a feature define toggles across zero
      // (transmission/clearcoat/sheen/iridescence/dispersion), so we must NOT
      // re-bump those. The one define-affecting property three does NOT manage is
      // `transparent` (a base Material field, toggled here by opacity < 1), which
      // swaps the render list — bump it ourselves. Plain slider movement within an
      // enabled range never recompiles (per-tick jank).
      if (p.transparent !== wasTransparent) p.needsUpdate = true
      // NB: `side` (set in applyPhysical) flips DoubleSide↔FrontSide exactly as
      // transmission crosses zero — the same crossing at which three's transmission
      // setter self-recompiles — so that recompile already picks up the new side
      // define. No extra needsUpdate bump here, or the crossing would recompile twice.
      return true
    }
    case 'toon': {
      (m as THREE.MeshToonMaterial).color.set(stripAlpha(mat.color))
      return true
    }
    case 'matcap':
      return true // nothing tweakable in place; id changes rebuild via identity
    case 'fresnel': {
      // Lit fresnel: base colour on the material, rim/power in injected uniforms.
      const f = m as THREE.MeshStandardMaterial
      f.color.set(stripAlpha(mat.color)); f.roughness = mat.roughness; f.metalness = mat.metalness
      const u = m.userData.fresnelUniforms as { uRim: { value: THREE.Color }; uPower: { value: number } }
      u.uRim.value.set(stripAlpha(mat.fresnelColor ?? MATERIAL_DEFAULTS.fresnelColor))
      u.uPower.value = mat.fresnelPower ?? MATERIAL_DEFAULTS.fresnelPower
      return true
    }
    case 'gradient': {
      // Lit gradient: the ramp lives in injected uniforms (userData.gradUniforms),
      // shared by reference with the compiled program — mutate and done.
      // (identityKey already forced a rebuild if the smooth↔facet program
      // boundary was crossed, so uMode only exists when it's mutable.)
      const u = m.userData.gradUniforms as {
        uRamp: { value: THREE.DataTexture }
        uDir: { value: THREE.Vector3 }
        uType: { value: number }; uOffset: { value: number }; uSpread: { value: number }
        uMode?: { value: number }
      }
      // The LUT is the only expensive part — rebuild it only when the stops
      // actually moved, and dispose the texture we're replacing.
      const sig = rampSignature(gradientStopsOf(mat))
      if (sig !== m.userData.rampSig) {
        u.uRamp.value?.dispose()
        u.uRamp.value = buildRampTexture(gradientStopsOf(mat))
        m.userData.rampSig = sig
      }
      const { yaw, pitch } = gradientAngles(mat)
      u.uDir.value.set(...gradientDirection(yaw, pitch))
      u.uType.value = (mat.gradientType ?? MATERIAL_DEFAULTS.gradientType) === 'radial' ? 1 : 0
      u.uOffset.value = mat.gradientOffset ?? MATERIAL_DEFAULTS.gradientOffset
      u.uSpread.value = mat.gradientSpread ?? MATERIAL_DEFAULTS.gradientSpread
      if (u.uMode) u.uMode.value = (mat.gradientShading ?? MATERIAL_DEFAULTS.gradientShading) === 'prismatic' ? 2 : 1
      return true
    }
    case 'image': {
      const s = m as THREE.MeshStandardMaterial
      s.roughness = mat.roughness; s.metalness = mat.metalness
      return true
    }
    case 'shaderFill': {
      // Re-stamp the live spec so the NEXT refreshSceneShaderFields call (the surface's
      // per-frame loop) picks up an effect/param/speed/input edit without a material rebuild —
      // the identity boundary above is `unlit` only, so we're guaranteed still holding the
      // right THREE class here. roughness/metalness only exist on the Standard (lit) variant.
      m.userData.shaderSpec = mat.shader ?? DEFAULT_SHADER_SPEC
      if (mat.unlit !== true) {
        const s = m as THREE.MeshStandardMaterial
        s.roughness = mat.roughness; s.metalness = mat.metalness
      }
      return true
    }
  }
  return false
}

export function disposeMaterial(m: THREE.Material): void {
  // Dispose textures the material exclusively owns. Matcaps are shared
  // module-lifetime singletons — skip them.
  if ((m as THREE.MeshToonMaterial).isMaterial && (m as any).gradientMap) (m as any).gradientMap.dispose()
  if (m.userData.matType === 'image') imageMaterials.delete(m as THREE.MeshStandardMaterial)
  if (m.userData.matType === 'shaderFill') shaderFillMaterials.delete(m)
  // The gradient ramp LUT is owned by exactly one material.
  const ramp = (m.userData.gradUniforms as { uRamp?: { value?: THREE.Texture } } | undefined)?.uRamp?.value
  if (ramp) ramp.dispose()
  const map = (m as THREE.MeshStandardMaterial).map
  if (map) { map.dispose(); if (m.userData.identity?.startsWith('image:')) imageCache.delete(m.userData.identity.slice(6)) }
  m.dispose()
}

/** Advance every shaderFill material OWNED BY `ownerId` (one Scene3D engine instance) to time
 *  `t` seconds, reusing each material's SAME `THREE.CanvasTexture` — set `.image`/`needsUpdate`
 *  in place, never allocate a new CanvasTexture per frame, per resolveField's ownership
 *  contract (~/lib/shaderfill/field.ts). Call once per host frame, BEFORE `engine.render()`,
 *  and only when the current doc actually has a shaderFill material (see `sceneHasShaderFill`
 *  in config.ts) — an owner with no shaderFill materials is a cheap no-op below regardless, this
 *  is so an ordinary scene's frame loop never starts paying new per-frame cost it never paid.
 *
 *  Mirrors `refreshLiveShaderFills` in ~/lib/spacetype/fills.ts (same beginFieldFrame/
 *  resolveField pairing, same "per-owner ceiling" shape) but is a SEPARATE cache/scope —
 *  `beginFieldFrame` is called here with ONLY this owner's requests, so its LIVE_FIELD_CEILING
 *  and the frozen count it returns apply per Scene3D engine, never pooled with (or walkable by)
 *  Space Type's or the Compositor's fields, which live entirely in that other module.
 *
 *  Returns the frozen-field count so the surface can show a hint when a field is capped at a
 *  still frame instead of animating — no silent caps, same rule as every other surface.
 *
 *  `bake`/`w`/`h` (Important 5 of the final review): a still export (renderPasses) wants the
 *  ACTUAL output resolution, unclamped — before this, every caller left `bake` at its default
 *  `false` and `w`/`h` at the fixed `SHADER_FIELD_PX` (== resolveField's own LIVE_FIELD_PX
 *  clamp), so passing `bake: true` here was inert: `fieldSize()` in field.ts only skips its
 *  clamp when `bake` is true AND w/h differ from the clamp size, and they never did. `w`/`h`
 *  default to `SHADER_FIELD_PX` so every existing (live-preview) call site is unaffected. */
export function refreshSceneShaderFields(
  ownerId: string, t: number, fps: number, bake = false, w = SHADER_FIELD_PX, h = SHADER_FIELD_PX,
): { frozenCount: number } {
  const entries: THREE.Material[] = []
  for (const m of shaderFillMaterials) if (m.userData.shaderOwnerId === ownerId) entries.push(m)
  if (entries.length === 0) return { frozenCount: 0 }
  const requests: FieldRequest[] = entries.map((m) => ({
    spec: m.userData.shaderSpec as ShaderSpec, w, h, t, fps, bake,
  }))
  // withFieldFrame owns the begin/end pairing in a try/finally (see its doc in
  // ~/lib/shaderfill/field.ts) — a throw anywhere in the loop below can no longer leave
  // the module-global field-frame span stuck open.
  return withFieldFrame(requests, (frozenCount, token) => {
    for (let i = 0; i < entries.length; i++) {
      const canvas = resolveField(requests[i]!, token)
      if (!canvas) continue                          // keep showing the last good frame
      const mat = entries[i] as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
      const tex = mat.map as THREE.CanvasTexture | null
      if (tex) {
        // CRITICAL 2 fix: the common case — a texture already exists (materialFor built it
        // successfully), just repoint it at the newest canvas in place, per resolveField's
        // ownership contract (bind directly, never copy).
        if (tex.image !== canvas) { tex.image = canvas; tex.needsUpdate = true }
      } else {
        // materialFor's `tex2 = canvas ? new THREE.CanvasTexture(canvas) : null` raced the
        // catalog fetch (or a transient WebGL failure) at material-creation time and got
        // null — `.map` was left null FOREVER, because this branch used to be `if (tex &&
        // ...)` and silently no-op on a null map. Heal it now that a canvas is available:
        // create the texture the material creation call couldn't, so the object recovers
        // without needing an unrelated edit (or an `unlit` toggle) to force a rebuild.
        const newTex = new THREE.CanvasTexture(canvas)
        newTex.colorSpace = THREE.SRGBColorSpace
        newTex.wrapS = newTex.wrapT = THREE.ClampToEdgeWrapping
        mat.map = newTex
        mat.needsUpdate = true
      }
    }
    return { frozenCount }
  })
}
