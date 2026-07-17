// Doc-driven Three.js engine for the 3D Studio. The editor never touches Three
// objects directly: it mutates a SceneDoc and calls syncFromDoc(), which diffs
// the document into the Three graph. (Same philosophy as shapefx/engine.ts,
// grown to a multi-object scene.)
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { SceneDoc, SceneObject, Vec3, LightingPreset, PrimitiveKind } from './config'
import { loadGlb } from './glb'

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
  }
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
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04)
    this.scene.environment = this.envTarget.texture
    pmrem.dispose()
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.ambient = new THREE.AmbientLight(0xffffff, 0.5)
    this.grid = new THREE.GridHelper(20, 40, 0x3a3f4a, 0x262a33)
    this.scene.add(this.sun, this.ambient, this.grid)
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
        const mesh = new THREE.Mesh(geometryFor(obj.primitive), new THREE.MeshStandardMaterial())
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
      const mat = (root as THREE.Mesh).material as THREE.MeshStandardMaterial
      mat.color.set(obj.material.color)
      mat.roughness = obj.material.roughness
      mat.metalness = obj.material.metalness
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
