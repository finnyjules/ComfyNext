// Doc-driven Three.js engine for the 3D Studio. The editor never touches Three
// objects directly: it mutates a SceneDoc and calls syncFromDoc(), which diffs
// the document into the Three graph. (Same philosophy as shapefx/engine.ts,
// grown to a multi-object scene.)
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { SceneDoc, SceneObject, Vec3, LightingPreset, PrimitiveKind } from './config'
import { loadGlb } from './glb'
import { materialFor, updateMaterial, disposeMaterial } from './materials'

/** Unit vector toward the sun for azimuth (deg, around Y) / elevation (deg above horizon). */
export function sunDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]
}

function geometryFor(kind: PrimitiveKind): THREE.BufferGeometry {
  switch (kind) {
    case 'box': return new THREE.BoxGeometry(1, 1, 1)
    case 'sphere': return new THREE.SphereGeometry(0.5, 48, 32)
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 48)
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 48)
    case 'torus': return new THREE.TorusGeometry(0.5, 0.18, 24, 64)
    case 'plane': return new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
    case 'capsule': return new THREE.CapsuleGeometry(0.35, 0.5, 8, 24)
    // 4-sided cone = pyramid; rotated so the square footprint is axis-aligned.
    case 'pyramid': return new THREE.ConeGeometry(0.55, 1, 4, 1).rotateY(Math.PI / 4)
    case 'prism': return new THREE.CylinderGeometry(0.5, 0.5, 1, 3)
    case 'icosahedron': return new THREE.IcosahedronGeometry(0.55)
    case 'octahedron': return new THREE.OctahedronGeometry(0.55)
    case 'dodecahedron': return new THREE.DodecahedronGeometry(0.55)
    case 'torusKnot': return new THREE.TorusKnotGeometry(0.4, 0.12, 128, 16)
    case 'ring': return new THREE.RingGeometry(0.22, 0.5, 48).rotateX(-Math.PI / 2)
  }
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
    this.scene.background = doc.background === 'transparent' ? null : new THREE.Color(doc.background)
    this.camera.fov = doc.camera.fov
    this.camera.updateProjectionMatrix()
  }

  private syncObject(obj: SceneObject): void {
    // Source signature: if a doc mutation retyped this id in place (kind,
    // primitive shape, or GLB url), tear down the old asset and rebuild —
    // otherwise the diff would keep rendering the stale one.
    const sourceKey = obj.kind === 'primitive' ? `primitive:${obj.primitive}` : `glb:${obj.url}`
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
        const geo = geometryFor(obj.primitive)
        const mat = materialFor(obj.material, geo)
        // Flat shapes must be visible from both sides (plane was previously
        // invisible from below; ring inherits the fix) — for every material type.
        if (obj.primitive === 'plane' || obj.primitive === 'ring') mat.side = THREE.DoubleSide
        const mesh = new THREE.Mesh(geo, mat)
        mesh.userData.geoVariant = 'smooth' // faceted variant applied by the sync below
        mesh.castShadow = mesh.receiveShadow = true
        root = mesh
      } else {
        root = new THREE.Group() // placeholder while the GLB loads
        const tok = ++this.token
        this.glbTokens.set(obj.id, tok)
        loadGlb(obj.url).then((g) => {
          if (this.glbTokens.get(obj.id) !== tok) return // stale (object deleted/replaced)
          g.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = c.receiveShadow = true } })
          root!.add(g)
        }).catch(() => { /* surface shows the error state; the group stays empty */ })
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
      if (mesh.userData.geoVariant !== variant) {
        mesh.geometry.dispose()
        let geo = geometryFor(obj.primitive)
        if (wantFacet) {
          if (geo.index) geo = geo.toNonIndexed()
          geo.computeVertexNormals()
          addFaceExtentAttributes(geo)
        }
        mesh.geometry = geo
        mesh.userData.geoVariant = variant
      }
      const current = mesh.material as THREE.Material
      if (!updateMaterial(current, obj.material)) {
        // Type or texture identity changed — rebuild, preserving double-siding.
        disposeMaterial(current)
        const fresh = materialFor(obj.material, mesh.geometry)
        if (obj.primitive === 'plane' || obj.primitive === 'ring') fresh.side = THREE.DoubleSide
        mesh.material = fresh
      }
    }
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
