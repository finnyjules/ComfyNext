// Doc-driven Three.js engine for the 3D Studio. The editor never touches Three
// objects directly: it mutates a SceneDoc and calls syncFromDoc(), which diffs
// the document into the Three graph. (Same philosophy as shapefx/engine.ts,
// grown to a multi-object scene.)
import * as THREE from 'three'
// StudioColor can emit 8-digit #rrggbbaa. THREE.Color has no alpha channel and renders
// 8-digit hex as WHITE (console warning, no throw), so picker colours are stripped to 6
// digits here — surfaces without transparency degrade to opaque rather than going white.
import { stripAlpha } from '~/lib/color/convert'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { roundedLatheGeometry, roundedPolyGeometry, roundedHullGeometry } from '~/lib/scene3d/roundedGeometry'
import type { SceneDoc, SceneObject, Vec3, LightingPreset, PrimitiveKind, PrimitiveObject, LightObject } from './config'
import { LIGHT_DEFAULTS } from './config'
import { loadGlb } from './glb'
import { materialFor, updateMaterial, disposeMaterial } from './materials'
import { applyModifiers } from '~/lib/scene3d/modifiers'
import { PRIMITIVE_PARAMS, paramValue, MODIFIER_SPECS, modifierValue } from '~/lib/scene3d/primParams'

/** Unit vector toward the sun for azimuth (deg, around Y) / elevation (deg above horizon). */
export function sunDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]
}

/** Build a primitive's geometry from its parameters. Defaults reproduce the
 *  pre-parametric geometry exactly — the engine unit test pins that against the
 *  original three.js calls. */
export function geometryFor(kind: PrimitiveKind, params?: Record<string, number>): THREE.BufferGeometry {
  const p = (key: string): number => paramValue(kind, params, key)
  const rad = (deg: number): number => (deg * Math.PI) / 180
  switch (kind) {
    case 'box': {
      const r = p('cornerRadius')
      // RoundedBoxGeometry degenerates at radius 0, so a square box stays a BoxGeometry.
      return r <= 0 ? new THREE.BoxGeometry(1, 1, 1) : new RoundedBoxGeometry(1, 1, 1, p('cornerSides'), r)
    }
    case 'sphere': {
      const d = p('detail')
      // Height segments track width at the original 32:48 ratio.
      return new THREE.SphereGeometry(0.5, d, Math.max(2, Math.round((d * 2) / 3)), 0, rad(p('arc')), 0, rad(p('sweep')))
    }
    case 'cylinder':
    case 'cone': {
      const cr = p('cornerRadius')
      // Rounding needs a cap to round against, so an open-ended tube stays plain.
      if (cr > 0 && p('openEnded') <= 0.5) {
        return roundedLatheGeometry(p('radiusTop'), p('radiusBottom'), cr, p('cornerSides'), p('detail'), rad(p('arc')))
      }
      return new THREE.CylinderGeometry(
        p('radiusTop'), p('radiusBottom'), 1, p('detail'), 1, p('openEnded') > 0.5, 0, rad(p('arc')),
      )
    }
    case 'torus':
      return new THREE.TorusGeometry(0.5, p('tube'), Math.max(3, Math.round(p('detail') * 0.375)), p('detail'), rad(p('arc')))
    case 'plane':
      return new THREE.PlaneGeometry(2, 2, p('detail'), p('detail')).rotateX(-Math.PI / 2)
    case 'capsule': {
      const d = p('detail')
      return new THREE.CapsuleGeometry(p('radius'), p('length'), Math.max(2, Math.round(d / 3)), d)
    }
    // 4-sided cone = pyramid; the quarter turn keeps the square footprint
    // axis-aligned and stays applied at every side count for continuity.
    case 'pyramid': {
      const cr = p('cornerRadius')
      // Rounding drops the taper (and the apex): a rounded pyramid is a rounded
      // 4-gon prism. baseAngle keeps the square footprint axis-aligned.
      if (cr > 0) return roundedPolyGeometry(p('detail'), 0.55, cr, p('cornerSides'), Math.PI / 2 + Math.PI / 4)
      return new THREE.CylinderGeometry(p('radiusTop'), 0.55, 1, p('detail'), 1).rotateY(Math.PI / 4)
    }
    case 'prism': {
      const cr = p('cornerRadius')
      if (cr > 0) return roundedPolyGeometry(p('detail'), 0.5, cr, p('cornerSides'), Math.PI / 2)
      return new THREE.CylinderGeometry(p('radiusTop'), 0.5, 1, p('detail'))
    }
    case 'icosahedron': {
      const base = new THREE.IcosahedronGeometry(0.55, p('detail'))
      const cr = p('cornerRadius')
      if (cr <= 0) return base
      const hull = roundedHullGeometry(base, cr, p('cornerSides'))
      base.dispose()
      return hull
    }
    case 'octahedron': {
      const base = new THREE.OctahedronGeometry(0.55, p('detail'))
      const cr = p('cornerRadius')
      if (cr <= 0) return base
      const hull = roundedHullGeometry(base, cr, p('cornerSides'))
      base.dispose()
      return hull
    }
    case 'dodecahedron': {
      const base = new THREE.DodecahedronGeometry(0.55, p('detail'))
      const cr = p('cornerRadius')
      if (cr <= 0) return base
      const hull = roundedHullGeometry(base, cr, p('cornerSides'))
      base.dispose()
      return hull
    }
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(0.4, p('tube'), p('detail'), Math.max(3, Math.round(p('detail') / 8)), p('p'), p('q'))
    case 'ring':
      return new THREE.RingGeometry(p('innerRadius'), 0.5, p('detail'), 1, 0, rad(p('arc'))).rotateX(-Math.PI / 2)
  }
}

/** Build the THREE light for a LightObject (color/intensity/type params applied;
 *  position/rotation/shadow handled by the caller in syncObject). Pure + testable. */
export function lightFor(obj: LightObject): THREE.Light {
  const color = new THREE.Color(stripAlpha(obj.color))
  const intensity = obj.intensity
  if (obj.light === 'rect') {
    const l = new THREE.RectAreaLight(color, intensity, obj.width ?? LIGHT_DEFAULTS.width, obj.height ?? LIGHT_DEFAULTS.height)
    return l
  }
  if (obj.light === 'spot') {
    const l = new THREE.SpotLight(color, intensity, obj.distance ?? 0, obj.angle ?? LIGHT_DEFAULTS.angle, obj.penumbra ?? LIGHT_DEFAULTS.penumbra, obj.decay ?? LIGHT_DEFAULTS.decay)
    return l
  }
  const l = new THREE.PointLight(color, intensity, obj.distance ?? 0, obj.decay ?? LIGHT_DEFAULTS.decay)
  return l
}

/** Unscaled bounding dimensions of a primitive at the given params and
 *  modifiers — the Size row multiplies these by the object's scale, so an array
 *  or a bend must widen it. Pure: builds, measures, disposes. */
export function baseSizeFor(
  kind: PrimitiveKind,
  params?: Record<string, number>,
  modifiers?: Record<string, number>,
): [number, number, number] {
  const geo = buildGeometry(kind, params, modifiers, 'smooth')
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  const size: [number, number, number] = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
  geo.dispose()
  return size
}

/** Vertex count of ONE copy — the shaped geometry with the cloner suppressed.
 *  Subdivision changes the count, so the deformers have to run; the cloner does
 *  not, so it is forced off and the caller multiplies by `totalClones` instead.
 *  That keeps this at the cost of a single copy on every slider tick rather than
 *  a whole clone set. Pure: builds, counts, disposes.
 *
 *  Note this is an upper bound at the extremes: `applyModifiers` shrinks the
 *  subdivision ceiling as the clone count grows, so a budget-clamped clone set
 *  can end up below the reported figure. Over-reporting is the safe direction
 *  for a cost warning. */
export function baseVertexCountFor(
  kind: PrimitiveKind,
  params?: Record<string, number>,
  modifiers?: Record<string, number>,
): number {
  const single = { ...(modifiers ?? {}), cloneCount: 1, cloneCountX: 1, cloneCountY: 1, cloneCountZ: 1 }
  const geo = buildGeometry(kind, params, single, 'smooth')
  const n = geo.getAttribute('position')?.count ?? 0
  geo.dispose()
  return n
}

/** Stable geometry signature: kind + every declared param in table order +
 *  every modifier in spec order + the shading variant. Changing any of them
 *  swaps mesh.geometry in place. */
function geoKeyFor(obj: PrimitiveObject, variant: 'smooth' | 'facet'): string {
  const vals = PRIMITIVE_PARAMS[obj.primitive].map((s) => paramValue(obj.primitive, obj.params, s.key))
  const mods = MODIFIER_SPECS.map((s) => modifierValue(obj.modifiers, s.key))
  return `${obj.primitive}|${vals.join(',')}|${mods.join(',')}|${variant}`
}

/** Bake each triangle's own bounding extent into per-vertex attributes
 *  (aFaceMin/aFaceMax, same value on all 3 verts of a face). The facet
 *  gradient program reads them to run the full ramp across each face
 *  individually (prismatic mode). Requires non-indexed geometry. */
function addFaceExtentAttributes(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  const min = new Float32Array(n * 3)
  const max = new Float32Array(n * 3)
  for (let v = 0; v < n; v += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const a = pos.getComponent(v, axis)
      const b = pos.getComponent(v + 1, axis)
      const c = pos.getComponent(v + 2, axis)
      const lo = Math.min(a, b, c)
      const hi = Math.max(a, b, c)
      for (let k = 0; k < 3; k++) {
        min[(v + k) * 3 + axis] = lo
        max[(v + k) * 3 + axis] = hi
      }
    }
  }
  geo.setAttribute('aFaceMin', new THREE.BufferAttribute(min, 3))
  geo.setAttribute('aFaceMax', new THREE.BufferAttribute(max, 3))
}

/** Geometry for a kind + params at a shading variant: the smooth factory output,
 *  or its flat-shaded form (non-indexed, per-face normals, per-face extents) for
 *  the faceted gradients. The single build step used by every geometry rebuild. */
export function buildGeometry(
  kind: PrimitiveKind,
  params: Record<string, number> | undefined,
  modifiers: Record<string, number> | undefined,
  variant: 'smooth' | 'facet',
): THREE.BufferGeometry {
  const base = geometryFor(kind, params)
  // applyModifiers returns the SAME object when nothing is set (and never
  // disposes its input), so only free the base when it produced a new one.
  const shaped = applyModifiers(base, modifiers)
  if (shaped !== base) base.dispose()
  if (variant !== 'facet') return shaped
  let geo = shaped
  if (geo.index) { const flat = geo.toNonIndexed(); geo.dispose(); geo = flat }
  geo.computeVertexNormals()
  addFaceExtentAttributes(geo)
  return geo
}

// Preset → environment intensity + sun softness. Sun angle/intensity stay
// user-controlled; presets shape the fill character around it.
const PRESETS: Record<LightingPreset, { envIntensity: number; shadow: boolean }> = {
  studio: { envIntensity: 0.9, shadow: true },
  soft: { envIntensity: 1.3, shadow: false },
  dramatic: { envIntensity: 0.35, shadow: true },
  flat: { envIntensity: 1.0, shadow: false },
}

export class SceneEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly objectRoots = new Map<string, THREE.Object3D>()
  readonly grid: THREE.GridHelper
  // Transparent shadow-catcher plane at y=0: gives objects a soft contact shadow
  // in the beauty render. Public so the bake can hide it for the depth/normal
  // passes (it must not appear as a floor in the ControlNet maps).
  readonly shadowGround: THREE.Mesh
  private sun: THREE.DirectionalLight
  private ambient: THREE.AmbientLight
  private envTarget: THREE.WebGLRenderTarget | null = null
  private glbTokens = new Map<string, number>() // id → load generation (drop stale async loads)
  private token = 0
  /** While true, syncObject skips geometry rebuilds for existing meshes (the
   *  stored geoKey is deliberately left stale, so the very next sync with the
   *  flag cleared rebuilds once at the final values). Transforms, visibility and
   *  materials keep syncing normally. The surface raises this for the duration of
   *  a slider drag on a heavy clone set, where a synchronous rebuild per tick
   *  costs hundreds of milliseconds. */
  deferGeometry = false

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    // preserveDrawingBuffer so toDataURL works for bakes (shapefx pattern).
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // Filmic tone mapping lifts the flat clay look into a studio render (applied
    // to the beauty pass only — the depth/normal passes reset this, see passes.ts).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    // RectAreaLight needs its LTC lookup textures initialized once; guarded because
    // it touches WebGL state and the engine unit tests construct without a GL context.
    try { RectAreaLightUniformsLib.init() } catch { /* no GL context (unit tests) */ }
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04)
    this.scene.environment = this.envTarget.texture
    pmrem.dispose()
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    // Fit the shadow frustum to our small scenes and soften/de-acne the shadow.
    this.sun.shadow.camera.near = 0.5
    this.sun.shadow.camera.far = 40
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -8
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 8
    this.sun.shadow.bias = -0.0002
    this.sun.shadow.normalBias = 0.02
    this.sun.shadow.radius = 3
    this.ambient = new THREE.AmbientLight(0xffffff, 0.5)
    this.grid = new THREE.GridHelper(20, 40, 0x3a3f4a, 0x262a33)
    this.shadowGround = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    )
    this.shadowGround.rotation.x = -Math.PI / 2
    this.shadowGround.position.y = -0.005 // just under y=0 so it never z-fights the grid
    this.shadowGround.receiveShadow = true
    this.scene.add(this.sun, this.ambient, this.grid, this.shadowGround)
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  applyCameraFromDoc(doc: SceneDoc): void {
    this.camera.position.set(...doc.camera.position)
    this.camera.lookAt(...doc.camera.target)
    this.camera.fov = doc.camera.fov
    this.camera.updateProjectionMatrix()
  }

  syncFromDoc(doc: SceneDoc): void {
    // Remove three-roots whose doc object is gone.
    const live = new Set(doc.objects.map((o) => o.id))
    for (const [id, root] of this.objectRoots) {
      if (!live.has(id)) {
        this.scene.remove(root)
        disposeTree(root)
        this.objectRoots.delete(id)
        this.glbTokens.delete(id)
      }
    }
    for (const obj of doc.objects) this.syncObject(obj)
    // Lighting + background.
    const preset = PRESETS[doc.lighting.preset]
    const [sx, sy, sz] = sunDirection(doc.lighting.sunAzimuth, doc.lighting.sunElevation)
    this.sun.position.set(sx * 10, sy * 10, sz * 10)
    this.sun.intensity = doc.lighting.sunIntensity
    this.sun.castShadow = preset.shadow
    this.ambient.intensity = doc.lighting.ambient
    this.scene.environmentIntensity = preset.envIntensity
    this.scene.background = doc.background === 'transparent' ? null : new THREE.Color(stripAlpha(doc.background))
    this.camera.fov = doc.camera.fov
    this.camera.updateProjectionMatrix()
  }

  private syncObject(obj: SceneObject): void {
    // Source signature: if a doc mutation retyped this id in place (kind,
    // primitive shape, or GLB url), tear down the old asset and rebuild —
    // otherwise the diff would keep rendering the stale one.
    const sourceKey = obj.kind === 'primitive' ? `primitive:${obj.primitive}`
      : obj.kind === 'glb' ? `glb:${obj.url}`
      : `light:${obj.light}`
    let root = this.objectRoots.get(obj.id)
    if (root && root.userData.sourceKey !== sourceKey) {
      this.scene.remove(root)
      disposeTree(root)
      this.objectRoots.delete(obj.id)
      this.glbTokens.delete(obj.id)
      root = undefined
    }
    if (!root) {
      if (obj.kind === 'primitive') {
        const geo = buildGeometry(obj.primitive, obj.params, obj.modifiers, 'smooth')
        const mat = materialFor(obj.material, geo)
        // Flat shapes must be visible from both sides (plane was previously
        // invisible from below; ring inherits the fix) — for every material type.
        if (obj.primitive === 'plane' || obj.primitive === 'ring') mat.side = THREE.DoubleSide
        const mesh = new THREE.Mesh(geo, mat)
        mesh.userData.geoKey = geoKeyFor(obj, 'smooth') // facet variant applied by the sync below
        mesh.castShadow = mesh.receiveShadow = true
        root = mesh
      } else if (obj.kind === 'glb') {
        root = new THREE.Group() // placeholder while the GLB loads
        const tok = ++this.token
        this.glbTokens.set(obj.id, tok)
        loadGlb(obj.url).then((g) => {
          if (this.glbTokens.get(obj.id) !== tok) return // stale (object deleted/replaced)
          g.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = c.receiveShadow = true } })
          root!.add(g)
        }).catch(() => { /* surface shows the error state; the group stays empty */ })
      } else {
        const group = new THREE.Group()
        const light = lightFor(obj)
        group.add(light)
        group.userData.light = light
        if (light instanceof THREE.SpotLight) {
          // Spot aims at a target offset along the group's local -Z; keep target in the group.
          light.target.position.set(0, 0, -1)
          group.add(light.target)
        }
        root = group
        root.userData.isLight = true
      }
      root.userData.sceneId = obj.id
      root.userData.sourceKey = sourceKey
      this.scene.add(root)
      this.objectRoots.set(obj.id, root)
    }
    root.visible = obj.visible
    root.position.set(...obj.position)
    root.rotation.set(...obj.rotation)
    root.scale.set(...obj.scale)
    if (obj.kind === 'primitive') {
      const mesh = root as THREE.Mesh
      // Faceted/prismatic gradients pair their per-facet ramps with flat-shaded
      // geometry (non-indexed + per-face normals) plus per-face extent
      // attributes (aFaceMin/aFaceMax — the facet shader's sampling range);
      // switching back restores the smooth original from the geometry factory.
      const wantFacet = obj.material.type === 'gradient' &&
        (obj.material.gradientShading ?? 'smooth') !== 'smooth'
      const variant = wantFacet ? 'facet' : 'smooth'
      const geoKey = geoKeyFor(obj, variant)
      // Geometry params and the shading variant share one key: either change
      // swaps the geometry in place, leaving the material instance (and its
      // in-place update path) and the transform untouched.
      // NB: while deferred, geoKey is intentionally NOT stamped — leaving it
      // stale is what makes the deferred rebuild happen on release.
      if (mesh.userData.geoKey !== geoKey && !this.deferGeometry) {
        mesh.geometry.dispose()
        mesh.geometry = buildGeometry(obj.primitive, obj.params, obj.modifiers, variant)
        mesh.userData.geoKey = geoKey
      }
      const current = mesh.material as THREE.Material
      if (!updateMaterial(current, obj.material)) {
        // Type or texture identity changed — rebuild, preserving double-siding.
        disposeMaterial(current)
        const fresh = materialFor(obj.material, mesh.geometry)
        if (obj.primitive === 'plane' || obj.primitive === 'ring') fresh.side = THREE.DoubleSide
        mesh.material = fresh
      }
      // A gradient bakes the geometry's bounding box into uBoxMin/uBoxMax so the
      // ramp spans the shape exactly. Parameters move those bounds (a fatter
      // tube, a longer capsule), so refresh the uniforms in place against the
      // current geometry — mutating .value never rebuilds the material.
      const gradUniforms = (mesh.material as THREE.Material).userData
        ?.gradUniforms as Record<string, { value: unknown }> | undefined
      if (gradUniforms) {
        const geo = mesh.geometry
        if (!geo.boundingBox) geo.computeBoundingBox()
        if (geo.boundingBox) {
          ;(gradUniforms.uBoxMin!.value as THREE.Vector3).copy(geo.boundingBox.min)
          ;(gradUniforms.uBoxMax!.value as THREE.Vector3).copy(geo.boundingBox.max)
        }
      }
    } else if (obj.kind === 'light') {
      const light = root.userData.light as THREE.Light
      const color = new THREE.Color(stripAlpha(obj.color))
      light.color.copy(color)
      light.intensity = obj.intensity
      if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
        light.distance = obj.distance ?? 0
        light.decay = obj.decay ?? LIGHT_DEFAULTS.decay
        light.castShadow = obj.castShadow === true
      }
      if (light instanceof THREE.SpotLight) {
        light.angle = obj.angle ?? LIGHT_DEFAULTS.angle
        light.penumbra = obj.penumbra ?? LIGHT_DEFAULTS.penumbra
      }
      if (light instanceof THREE.RectAreaLight) {
        light.width = obj.width ?? LIGHT_DEFAULTS.width
        light.height = obj.height ?? LIGHT_DEFAULTS.height
      }
    }
  }

  /** Unscaled bounding dimensions of any object, primitives and GLBs alike.
   *  Returns null while a GLB is still loading (its group is empty). */
  baseSizeOf(id: string): [number, number, number] | null {
    const root = this.objectRoots.get(id)
    if (!root) return null
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) return null
    const s = root.scale
    return [
      (box.max.x - box.min.x) / (s.x || 1),
      (box.max.y - box.min.y) / (s.y || 1),
      (box.max.z - box.min.z) / (s.z || 1),
    ]
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    // Invalidate pending GLB loads first: their .then() checks glbTokens, so
    // clearing makes any in-flight load bail instead of attaching to a
    // disposed root.
    this.glbTokens.clear()
    for (const root of this.objectRoots.values()) disposeTree(root)
    this.objectRoots.clear()
    this.grid.geometry.dispose()
    const gridMats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]
    gridMats.forEach((m) => m.dispose())
    this.shadowGround.geometry.dispose()
    ;(this.shadowGround.material as THREE.Material).dispose()
    this.envTarget?.dispose()
    this.renderer.dispose()
  }
}

// Light groups carry no geometry/material today, so this is a safe no-op for
// them — but Task 3's pick-marker/helper meshes attach here too, and those
// WILL need disposing once they land.
function disposeTree(root: THREE.Object3D): void {
  root.traverse((c) => {
    const m = c as THREE.Mesh
    if (m.isMesh) {
      m.geometry?.dispose()
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      mats.forEach((x) => {
        if (!x) return
        // GLB materials own GPU textures (map, normalMap, roughnessMap, ...).
        // Dispose every texture-valued property before the material itself.
        for (const value of Object.values(x)) {
          if (value instanceof THREE.Texture) value.dispose()
        }
        x.dispose()
      })
    }
  })
}
