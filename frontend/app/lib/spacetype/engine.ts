import * as THREE from 'three'
import type { Params, SpaceTypeEffect } from './effect'
import type { TextTextureOptions } from './textTexture'
import { makeTextTexture } from './textTexture'
import { PostChain, DEFAULT_POST, postEnabled, type PostSettings } from './post'

export interface EngineOptions {
  effect: SpaceTypeEffect
  width: number
  height: number
  fps: number
  loopDuration: number
  alpha: boolean
  bgColor: string
  projection?: 'perspective' | 'isometric'
  /** Off-centre framing, in fractions of half the frame (−1…1). Screen-space, so it pans the
   *  composition regardless of projection or scene rotation. */
  panX?: number
  panY?: number
}

// Half-height the perspective camera sees at z=14 (FOV 45°) — the ortho frustum matches it
// so Scale reads the same across projections. Isometric = ORTHOGRAPHIC looking STRAIGHT down
// the axis (parallel projection, no perspective convergence); the axonometric extrude look
// comes from the effect's own tilt (scene rotate / boost tumble), not a tilted camera.
const ORTHO_HALF_H = Math.tan((45 / 2) * Math.PI / 180) * 14
const ISO_EYE = new THREE.Vector3(0, 0, 20)

export class SpaceTypeEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  private perspCam: THREE.PerspectiveCamera
  private orthoCam: THREE.OrthographicCamera
  private effect: SpaceTypeEffect
  private root: THREE.Object3D | null = null
  private textTex: THREE.Texture | null = null
  private opts: EngineOptions
  private post: PostSettings = DEFAULT_POST
  private postChain: PostChain | null = null

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.opts = opts
    this.effect = opts.effect
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setSize(opts.width, opts.height, false)
    this.scene = new THREE.Scene()
    this.perspCam = new THREE.PerspectiveCamera(45, opts.width / opts.height, 0.1, 100)
    this.perspCam.position.set(0, 0, 14)
    const a = opts.width / opts.height
    this.orthoCam = new THREE.OrthographicCamera(-ORTHO_HALF_H * a, ORTHO_HALF_H * a, ORTHO_HALF_H, -ORTHO_HALF_H, 0.1, 200)
    this.orthoCam.position.copy(ISO_EYE)
    this.orthoCam.up.set(0, 1, 0)
    this.orthoCam.lookAt(0, 0, 0)
    this.applyBackground()
  }

  private get activeCam(): THREE.Camera {
    return this.opts.projection === 'isometric' ? this.orthoCam : this.perspCam
  }

  /** Switch projection live (perspective ↔ isometric/orthographic). */
  setProjection(mode: 'perspective' | 'isometric'): void {
    this.opts.projection = mode
  }

  /** Off-centre the framing live (−1…1 = half-frame each way). */
  setPan(panX: number, panY: number): void {
    this.opts.panX = panX
    this.opts.panY = panY
  }

  /** Apply (or clear) the screen-space pan as a camera view-offset. Called per frame after the
   *  projection is set up; positive X pans the composition right, positive Y pans it up. */
  private applyPan(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    const px = this.opts.panX ?? 0, py = this.opts.panY ?? 0
    const w = this.opts.width, h = this.opts.height
    if (px === 0 && py === 0) { cam.clearViewOffset(); return }
    // view-offset X right shifts content left; Y down shifts content up — negate X to match.
    cam.setViewOffset(w, h, -px * w * 0.5, py * h * 0.5, w, h)
  }

  /** Apply opaque-bg vs transparent based on opts.alpha. Renderer is always
   *  constructed with alpha:true; transparency is a render-time clear setting. */
  private applyBackground(): void {
    if (this.opts.alpha) {
      this.scene.background = null
      this.renderer.setClearColor(0x000000, 0)
    } else {
      const c = new THREE.Color(this.opts.bgColor)
      this.scene.background = c
      this.renderer.setClearColor(c, 1)
    }
  }

  /** Resize the render target + camera aspect (e.g. when output dimensions change). */
  setSize(width: number, height: number): void {
    this.opts.width = width
    this.opts.height = height
    this.renderer.setSize(width, height, false)
    const a = width / height
    this.perspCam.aspect = a
    this.perspCam.updateProjectionMatrix()
    this.orthoCam.left = -ORTHO_HALF_H * a
    this.orthoCam.right = ORTHO_HALF_H * a
    this.orthoCam.top = ORTHO_HALF_H
    this.orthoCam.bottom = -ORTHO_HALF_H
    this.orthoCam.updateProjectionMatrix()
    this.postChain?.setSize(width, height)
  }

  /** Toggle transparency / background color live without rebuilding the renderer. */
  setBackground(alpha: boolean, bgColor: string): void {
    this.opts.alpha = alpha
    this.opts.bgColor = bgColor
    this.applyBackground()
  }

  /** Update loop length so frameCount reflects edits made after construction. */
  setLoopDuration(loopDuration: number): void {
    this.opts.loopDuration = loopDuration
  }

  /** Update fps so frameCount (used by renderFrame/bake) reflects fps edits. */
  setFps(fps: number): void {
    this.opts.fps = fps
  }

  /** Switch the active effect (call rebuild/build afterwards). */
  setEffect(effect: SpaceTypeEffect): void {
    this.effect = effect
  }

  /** Update shared post-processing (bloom / colour / chroma / lens blur). Lazily builds the
   *  composer on first use; when everything is off, renderFrame bypasses it entirely. */
  setPost(post: PostSettings): void {
    this.post = post
    if (!postEnabled(post)) return
    if (!this.postChain) {
      this.postChain = new PostChain(this.renderer, this.scene, this.activeCam, this.opts.width, this.opts.height)
    }
    this.postChain.setSettings(post)
  }

  private disposeRoot(): void {
    if (!this.root) return
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat?.dispose()
      }
      // Lights (e.g. the shadow-casting DirectionalLight) own a shadow-map render
      // target that leaks unless disposed; Light subclasses' dispose() frees it.
      const light = obj as THREE.Light & { dispose?: () => void }
      if (light.isLight && typeof light.dispose === 'function') light.dispose()
      const tex = obj.userData?.tex as THREE.Texture | undefined
      if (tex && typeof tex.dispose === 'function') tex.dispose()
    })
    this.scene.remove(this.root)
    this.root = null
    const grad = this.textTex?.userData?.gradient as THREE.Texture | undefined
    grad?.dispose?.()
    this.textTex?.dispose()
    this.textTex = null
  }

  /** (Re)build the scene from params; call when structural params change. */
  build(params: Params, texOpts: TextTextureOptions): void {
    this.disposeRoot()
    const tex = makeTextTexture(texOpts)
    this.textTex = tex
    this.root = this.effect.buildScene(THREE, params, tex, { width: this.opts.width, height: this.opts.height, axes: texOpts.axes })
    this.scene.add(this.root)
  }

  /** Total frames in one loop. */
  get frameCount(): number { return Math.max(1, Math.round(this.opts.fps * this.opts.loopDuration)) }

  /** Render the scene at integer frame index. t01 = index / frameCount (no wall clock). */
  renderFrame(index: number, params: Params): void {
    const t01 = (index % this.frameCount) / this.frameCount
    const scale = Number(params.scale ?? 1) || 1
    // Both projections use the SAME scene tilt (rotate X/Y/Z = the iso/view angle); only the
    // lens differs — perspective (converging) vs isometric (orthographic, parallel lines).
    this.scene.rotation.set(Number(params.rotateX ?? 0), Number(params.rotateY ?? 0), Number(params.rotateZ ?? 0))
    if (this.opts.projection === 'isometric') {
      this.orthoCam.zoom = scale
      this.orthoCam.updateProjectionMatrix()
      this.applyPan(this.orthoCam)
    } else {
      this.perspCam.position.z = 14 / scale
      this.applyPan(this.perspCam)
    }
    this.effect.update(t01, params)
    if (postEnabled(this.post) && this.postChain) this.postChain.render(this.scene, this.activeCam)
    else this.renderer.render(this.scene, this.activeCam)
  }

  /** Read the current canvas back as a PNG blob (after renderFrame). */
  async frameToBlob(): Promise<Blob> {
    const canvas = this.renderer.domElement
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('space type: frame produced no blob')
    return blob
  }

  dispose(): void {
    this.disposeRoot()
    this.postChain?.dispose()
    this.renderer.dispose()
  }
}
