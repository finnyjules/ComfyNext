// Material factory for 3D Studio primitives. One module owns creation, in-place
// update, and disposal for every material type, so the engine stays lean and
// the Selection UI can share the same defaults (config.MATERIAL_DEFAULTS).
//
// Node-safety: matcap textures and picker thumbnails need a canvas; in non-DOM
// environments (vitest) those degrade to null/'' while the material classes and
// update logic stay fully testable.
import * as THREE from 'three'
import { MATERIAL_DEFAULTS, type SceneMaterial } from './config'

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

// Gradient: object-space colour ramp driving the albedo. `vGradFlat` is a
// `flat` varying — for the faceted mode each triangle takes its provoking
// vertex's value, giving one flat ramp tone per facet (low-poly look). Three's
// GLSL3 prefix turns `varying` into in/out, and the `flat` qualifier rides
// along verbatim.
const GRADIENT_VERT_DECL = /* glsl */ `#include <common>
varying vec3 vGradPos;
flat varying vec3 vGradFlat;`
const GRADIENT_VERT_BODY = /* glsl */ `#include <begin_vertex>
vGradPos = position;
vGradFlat = position;`
const GRADIENT_FRAG_DECL = /* glsl */ `#include <common>
uniform vec3 uColorA; uniform vec3 uColorB;
uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform int uAxis; uniform float uFacet;
varying vec3 vGradPos;
flat varying vec3 vGradFlat;`
const GRADIENT_FRAG_BODY = /* glsl */ `#include <color_fragment>
{
  vec3 gp  = mix(vGradPos, vGradFlat, uFacet);
  float p  = uAxis == 0 ? gp.x       : (uAxis == 1 ? gp.y       : gp.z);
  float lo = uAxis == 0 ? uBoxMin.x  : (uAxis == 1 ? uBoxMin.y  : uBoxMin.z);
  float hi = uAxis == 0 ? uBoxMax.x  : (uAxis == 1 ? uBoxMax.y  : uBoxMax.z);
  float t = clamp((p - lo) / max(hi - lo, 1e-5), 0.0, 1.0);
  diffuseColor.rgb = mix(uColorA, uColorB, t);
}`

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const

// ── Factory ──────────────────────────────────────────────────────────────────
export function materialFor(mat: SceneMaterial, geometry?: THREE.BufferGeometry): THREE.Material {
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
    case 'glass': {
      m = new THREE.MeshPhysicalMaterial({
        color: mat.color,
        roughness: mat.roughness,
        metalness: 0,
        transmission: mat.transmission ?? MATERIAL_DEFAULTS.transmission,
        ior: mat.ior ?? MATERIAL_DEFAULTS.ior,
        thickness: mat.thickness ?? MATERIAL_DEFAULTS.thickness,
      })
      break
    }
    case 'fresnel': {
      // Lit fresnel: base colour is standard albedo, rim added as emissive.
      const fresnelUniforms = {
        uRim: { value: new THREE.Color(mat.fresnelColor ?? MATERIAL_DEFAULTS.fresnelColor) },
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
      const gradUniforms = {
        uColorA: { value: new THREE.Color(mat.color) },
        uColorB: { value: new THREE.Color(mat.gradientB ?? MATERIAL_DEFAULTS.gradientB) },
        uBoxMin: { value: boxMin },
        uBoxMax: { value: boxMax },
        uAxis: { value: AXIS_INDEX[mat.gradientAxis ?? MATERIAL_DEFAULTS.gradientAxis] },
        // 0 = smooth per-pixel ramp; 1 = flat per-facet tone (low-poly look).
        uFacet: { value: (mat.gradientShading ?? MATERIAL_DEFAULTS.gradientShading) === 'faceted' ? 1 : 0 },
      }
      const g = new THREE.MeshStandardMaterial({ roughness: mat.roughness, metalness: mat.metalness })
      g.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, gradUniforms)
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', GRADIENT_VERT_DECL)
          .replace('#include <begin_vertex>', GRADIENT_VERT_BODY)
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', GRADIENT_FRAG_DECL)
          .replace('#include <color_fragment>', GRADIENT_FRAG_BODY)
      }
      // All gradient materials share one program (uniforms differ per material);
      // without this key, three would reuse the plain-standard program and skip
      // our injection — or recompile per material.
      g.customProgramCacheKey = () => 'scene3d-gradient'
      g.userData.gradUniforms = gradUniforms
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
    case 'standard':
    default:
      m = new THREE.MeshStandardMaterial({ color: mat.color, roughness: mat.roughness, metalness: mat.metalness })
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
    default: return mat.type
  }
}

export function updateMaterial(m: THREE.Material, mat: SceneMaterial): boolean {
  if (m.userData.matType !== mat.type || m.userData.identity !== identityKey(mat)) return false
  switch (mat.type) {
    case 'standard': {
      const s = m as THREE.MeshStandardMaterial
      s.color.set(mat.color); s.roughness = mat.roughness; s.metalness = mat.metalness
      return true
    }
    case 'toon': {
      (m as THREE.MeshToonMaterial).color.set(mat.color)
      return true
    }
    case 'matcap':
      return true // nothing tweakable in place; id changes rebuild via identity
    case 'glass': {
      const g = m as THREE.MeshPhysicalMaterial
      g.color.set(mat.color); g.roughness = mat.roughness
      g.ior = mat.ior ?? MATERIAL_DEFAULTS.ior
      g.transmission = mat.transmission ?? MATERIAL_DEFAULTS.transmission
      g.thickness = mat.thickness ?? MATERIAL_DEFAULTS.thickness
      return true
    }
    case 'fresnel': {
      // Lit fresnel: base colour on the material, rim/power in injected uniforms.
      const f = m as THREE.MeshStandardMaterial
      f.color.set(mat.color); f.roughness = mat.roughness; f.metalness = mat.metalness
      const u = m.userData.fresnelUniforms as { uRim: { value: THREE.Color }; uPower: { value: number } }
      u.uRim.value.set(mat.fresnelColor ?? MATERIAL_DEFAULTS.fresnelColor)
      u.uPower.value = mat.fresnelPower ?? MATERIAL_DEFAULTS.fresnelPower
      return true
    }
    case 'gradient': {
      // Lit gradient: the ramp lives in injected uniforms (userData.gradUniforms),
      // shared by reference with the compiled program — mutate and done.
      const u = m.userData.gradUniforms as {
        uColorA: { value: THREE.Color }; uColorB: { value: THREE.Color }
        uAxis: { value: number }; uFacet: { value: number }
      }
      u.uColorA.value.set(mat.color)
      u.uColorB.value.set(mat.gradientB ?? MATERIAL_DEFAULTS.gradientB)
      u.uAxis.value = AXIS_INDEX[mat.gradientAxis ?? MATERIAL_DEFAULTS.gradientAxis]
      u.uFacet.value = (mat.gradientShading ?? MATERIAL_DEFAULTS.gradientShading) === 'faceted' ? 1 : 0
      return true
    }
    case 'image': {
      const s = m as THREE.MeshStandardMaterial
      s.roughness = mat.roughness; s.metalness = mat.metalness
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
  const map = (m as THREE.MeshStandardMaterial).map
  if (map) { map.dispose(); if (m.userData.identity?.startsWith('image:')) imageCache.delete(m.userData.identity.slice(6)) }
  m.dispose()
}
