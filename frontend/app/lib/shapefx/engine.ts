import * as THREE from 'three'
// StudioColor can emit 8-digit #rrggbbaa. THREE.Color has no alpha channel and renders
// 8-digit hex as WHITE (console warning, no throw), so picker colours are stripped to 6
// digits here — surfaces without transparency degrade to opaque rather than going white.
import { stripAlpha } from '~/lib/color/convert'
import { buildGeometry } from './geometry'
import { applyVertexColors, vertexRampT, rampHexes } from './color'
import { makeOmbreMaterial } from './ombre'
import { buildSurfaceTexture } from './surface'
import { withShaderFillContext, clearShaderFillOwner } from '~/lib/spacetype/fills'
import type { ShapeConfig } from './config'

// Ortho frustum half-height chosen so a unit-ish shape frames nicely at z=6.
const ORTHO_HALF_H = 2.6
const CAM_Z = 6

/** Source of each engine's stable `id` — see ShapeEngine.id's doc. Separate counter from
 *  SpaceTypeEngine's (different id namespace/prefix), so the two can never collide even
 *  though they share fills.ts's owner-scoped shader field cache. */
let _nextShapeEngineId = 1

export class ShapeEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  /** Stable per-instance id, never reused — scopes this engine's shader fills in fills.ts's
   *  owner-scoped cache (see SpaceTypeEngine.id's doc in ../spacetype/engine.ts for the full
   *  rationale; identical mechanism, shared cache, distinct id namespace). */
  readonly id: string = `shape${_nextShapeEngineId++}`
  private perspCam: THREE.PerspectiveCamera
  private orthoCam: THREE.OrthographicCamera
  private mesh: THREE.Mesh | null = null
  private config: ShapeConfig | null = null
  private w: number
  private h: number

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.w = width; this.h = height
    // preserveDrawingBuffer:true so frameToBlob can read pixels after render.
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(1)
    this.scene = new THREE.Scene()
    this.perspCam = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    this.perspCam.position.set(0, 0, CAM_Z)
    const a = width / height
    this.orthoCam = new THREE.OrthographicCamera(-ORTHO_HALF_H * a, ORTHO_HALF_H * a, ORTHO_HALF_H, -ORTHO_HALF_H, 0.1, 100)
    this.orthoCam.position.set(0, 0, CAM_Z)
    this.orthoCam.lookAt(0, 0, 0)
  }

  private get cam(): THREE.Camera {
    return this.config?.shape.projection === 'perspective' ? this.perspCam : this.orthoCam
  }

  setSize(width: number, height: number): void {
    this.w = width; this.h = height
    this.renderer.setSize(width, height, false)
    const a = width / height
    this.perspCam.aspect = a; this.perspCam.updateProjectionMatrix()
    this.orthoCam.left = -ORTHO_HALF_H * a; this.orthoCam.right = ORTHO_HALF_H * a
    this.orthoCam.updateProjectionMatrix()
  }

  private disposeMesh(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    const mat = this.mesh.material as THREE.Material & { map?: THREE.Texture | null }
    mat.map?.dispose()
    mat.dispose()
    this.mesh = null
  }

  /** Rebuild geometry + material for a config. Always unlit (MeshBasic or the ombré shader). */
  setConfig(config: ShapeConfig): void {
    this.config = config
    this.disposeMesh()
    const geo = buildGeometry(config)
    let mat: THREE.Material
    if (config.fillMode === 'facets') {
      if (config.palette.coloring === 'ombre') {
        // GPU dither path: per-vertex ramp position + a ShaderMaterial that speckles per pixel.
        geo.setAttribute('aT', new THREE.BufferAttribute(vertexRampT(geo, config), 1))
        mat = makeOmbreMaterial(rampHexes(config))
      } else {
        applyVertexColors(geo, config)
        mat = new THREE.MeshBasicMaterial({ vertexColors: true })
      }
    } else {
      // Scope any shader fill this resolves to THIS engine instance — see
      // SpaceTypeEngine.build()'s identical use of withShaderFillContext for the full
      // rationale. setConfig is synchronous, so this is safe.
      const tex = withShaderFillContext(
        { ownerId: this.id, w: this.w, h: this.h, bake: false },
        () => buildSurfaceTexture(config),
      )
      mat = tex
        ? new THREE.MeshBasicMaterial({ map: tex })
        : new THREE.MeshBasicMaterial({ color: new THREE.Color(stripAlpha(config.fill.a)) })
    }
    this.mesh = new THREE.Mesh(geo, mat)
    this.scene.add(this.mesh)
    // background
    if (config.style.background === 'transparent') this.scene.background = null
    else this.scene.background = new THREE.Color(stripAlpha(config.style.background))
  }

  render(orbit: { yaw: number; pitch: number; zoom: number }): void {
    if (this.mesh) {
      this.mesh.rotation.y = orbit.yaw
      this.mesh.rotation.x = orbit.pitch
      // Persisted uniform scale (config). Applied here so it survives mesh rebuilds and works
      // in orthographic mode, where moving the camera along z doesn't change apparent size.
      this.mesh.scale.setScalar(this.config?.shape.scale ?? 1)
    }
    const z = CAM_Z / Math.max(0.2, orbit.zoom)
    this.perspCam.position.z = z
    this.orthoCam.position.z = z
    this.renderer.render(this.scene, this.cam)
  }

  /** Render at an optional target size and read back a PNG blob, then restore the preview size. */
  async frameToBlob(w?: number, h?: number): Promise<Blob> {
    const ow = this.w, oh = this.h            // capture BEFORE setSize mutates this.w/this.h
    const tw = w ?? ow, th = h ?? oh
    const resized = (ow !== tw || oh !== th)
    if (resized) this.setSize(tw, th)
    this.renderer.render(this.scene, this.cam)
    const blob: Blob = await new Promise((res, rej) =>
      this.renderer.domElement.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
    if (resized) this.setSize(ow, oh)         // restore the true original preview size
    return blob
  }

  dispose(): void {
    this.disposeMesh()
    if (this.scene.background instanceof THREE.Color) this.scene.background = null
    clearShaderFillOwner(this.id)
    this.renderer.dispose()
  }
}
